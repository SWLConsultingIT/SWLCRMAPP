// Single-activity mutations: edit, reschedule (due_at), complete, cancel.
// One PATCH handles all of them. Tenant + ownership enforced in code (service
// client bypasses RLS): the caller must belong to the activity's tenant, and a
// seller may only touch activities they own (assigned_to or created_by).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import {
  ACTIVITY_SELECT,
  isActivityStatus,
  isActivityType,
  isActivityPriority,
  isValidTimeZone,
  type ActivityStatus,
} from "@/lib/activities";
import { logActivityEvent, type ActivityEventType } from "@/lib/activities-server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: existing } = await svc
    .from("activities")
    .select("id, company_bio_id, assigned_to, created_by, status, completed_at, due_at, due_tz")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ex = existing as {
    company_bio_id: string;
    assigned_to: string | null;
    created_by: string | null;
    status: ActivityStatus;
    completed_at: string | null;
    due_at: string | null;
    due_tz: string | null;
  };

  // Tenant guard.
  if (scope.isScoped && scope.companyBioId && ex.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Ownership guard — seller can only touch their own.
  const seesAll = canViewAllTenantData(scope.tier);
  const owns = ex.assigned_to === scope.userId || ex.created_by === scope.userId;
  if (!seesAll && !owns) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    if (t.length > 200) return NextResponse.json({ error: "title too long" }, { status: 400 });
    patch.title = t;
  }
  if ("description" in body) {
    patch.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if ("due_at" in body) {
    if (body.due_at === null || body.due_at === "") {
      patch.due_at = null;
    } else if (typeof body.due_at === "string" && !Number.isNaN(Date.parse(body.due_at))) {
      patch.due_at = new Date(body.due_at).toISOString();
    } else {
      return NextResponse.json({ error: "invalid due_at" }, { status: 400 });
    }
  }
  if ("due_tz" in body) {
    if (body.due_tz === null || body.due_tz === "") patch.due_tz = null;
    else if (typeof body.due_tz === "string" && isValidTimeZone(body.due_tz)) patch.due_tz = body.due_tz;
    else return NextResponse.json({ error: "invalid due_tz" }, { status: 400 });
  }
  if ("reminder_offset_minutes" in body) {
    if (body.reminder_offset_minutes === null || body.reminder_offset_minutes === "") {
      patch.reminder_offset_minutes = null;
    } else {
      const n = Number(body.reminder_offset_minutes);
      if (!Number.isFinite(n) || n < 0 || n > 10080) return NextResponse.json({ error: "invalid reminder offset" }, { status: 400 });
      patch.reminder_offset_minutes = Math.round(n);
    }
  }
  if ("type" in body) {
    if (!isActivityType(body.type)) return NextResponse.json({ error: "invalid type" }, { status: 400 });
    patch.type = body.type;
  }
  if ("priority" in body) {
    if (body.priority === null || body.priority === "") patch.priority = null;
    else if (isActivityPriority(body.priority)) patch.priority = body.priority;
    else return NextResponse.json({ error: "invalid priority" }, { status: 400 });
  }
  // Reassignment is a manager+ action only.
  if ("assigned_to" in body && seesAll) {
    patch.assigned_to = typeof body.assigned_to === "string" && body.assigned_to ? body.assigned_to : null;
  }
  if ("status" in body) {
    if (!isActivityStatus(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    patch.status = body.status;
    // completed_at is derived from the status transition, never client-set.
    if (body.status === "completed") {
      patch.completed_at = ex.completed_at ?? new Date().toISOString();
    } else {
      patch.completed_at = null;
    }
  }

  // Rescheduling re-arms the reminder: a new due time should fire again even if
  // the old one was already reminded.
  const rescheduled = "due_at" in patch && patch.due_at !== ex.due_at;
  if (rescheduled) patch.reminder_sent_at = null;

  const { data, error } = await svc
    .from("activities")
    .update(patch)
    .eq("id", id)
    .select(ACTIVITY_SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit — classify the primary event and record it (append-only, best-effort).
  let event: ActivityEventType = "edited";
  if ("status" in patch) {
    event = patch.status === "completed" ? "completed" : patch.status === "cancelled" ? "cancelled" : "reopened";
  } else if (rescheduled) {
    event = "rescheduled";
  } else if ("assigned_to" in patch) {
    event = "assigned";
  }
  const detail: Record<string, unknown> = {};
  if (rescheduled) { detail.from = ex.due_at; detail.to = patch.due_at; detail.due_tz = patch.due_tz ?? ex.due_tz; }
  if ("assigned_to" in patch) detail.assigned_to = patch.assigned_to;
  if ("status" in patch) detail.status = patch.status;
  await logActivityEvent({
    activityId: id,
    companyBioId: ex.company_bio_id,
    actorUserId: scope.userId,
    event,
    detail: Object.keys(detail).length ? detail : null,
  });

  return NextResponse.json({ activity: data });
}
