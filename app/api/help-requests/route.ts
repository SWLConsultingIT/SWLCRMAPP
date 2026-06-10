// Help / Support requests. Any authenticated user can POST a request from the
// in-app Help menu; it lands in /admin/support for super_admins to triage. GET
// and PATCH are super_admin-only (cross-tenant triage). Writes use the
// service-role client and the API enforces the gates (RLS is a backstop).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { requireAdminApi } from "@/lib/auth-admin";
import { createNotifications } from "@/lib/notify";

export const dynamic = "force-dynamic";

const CATEGORIES = ["general", "bug", "feature", "question", "billing"];

// POST — create a request (any signed-in user). Notifies all super_admins.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const subject = String(b?.subject ?? "").trim();
  const body = String(b?.body ?? "").trim();
  const category = CATEGORIES.includes(b?.category) ? b.category : "general";
  if (!subject) return NextResponse.json({ error: "Subject required" }, { status: 400 });
  if (!body) return NextResponse.json({ error: "Message required" }, { status: 400 });
  if (subject.length > 200) return NextResponse.json({ error: "Subject too long (max 200)" }, { status: 400 });
  if (body.length > 4000) return NextResponse.json({ error: "Message too long (max 4000)" }, { status: 400 });

  const svc = getSupabaseService();

  // Author + company context (denormalized for the admin list). Name/email live
  // on the auth user (user_profiles has neither).
  let authorName: string | null = null;
  let authorEmail: string | null = null;
  try {
    const { data: u } = await svc.auth.admin.getUserById(scope.userId);
    authorEmail = u?.user?.email ?? null;
    const meta = (u?.user?.user_metadata ?? {}) as Record<string, unknown>;
    authorName = (meta.full_name as string) || (meta.name as string) || null;
  } catch { /* fall through with nulls */ }

  let companyName: string | null = null;
  if (scope.companyBioId) {
    const { data: cb } = await svc.from("company_bios").select("name").eq("id", scope.companyBioId).maybeSingle();
    companyName = (cb as any)?.name ?? null;
  }

  const { data: inserted, error } = await svc
    .from("help_requests")
    .insert({
      company_bio_id: scope.companyBioId,
      company_name: companyName,
      created_by: scope.userId,
      author_name: authorName,
      author_email: authorEmail,
      author_tier: scope.tier,
      category,
      subject,
      body,
      status: "open",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify every super_admin (they see all notifications when unscoped).
  try {
    const { data: admins } = await svc.from("user_profiles").select("user_id").eq("tier", "super_admin");
    const recipients = (admins ?? []).map(a => (a as any).user_id as string);
    if (recipients.length && scope.companyBioId) {
      await createNotifications({
        companyBioId: scope.companyBioId,
        recipientUserIds: recipients,
        actorUserId: scope.userId,
        actorName: authorName,
        type: "request",
        body: `New ${category} request${companyName ? ` from ${companyName}` : ""}: ${subject}`,
        link: "/admin/support",
      });
    }
  } catch { /* best-effort — the /admin/support inbox is the source of truth */ }

  return NextResponse.json({ ok: true, id: (inserted as any)?.id });
}

const CLOSED_STATUSES = ["resolved", "rejected"];
const ALL_STATUSES = ["open", "in_progress", "resolved", "rejected"];

// GET — ?mine=1 → the caller's own requests (any signed-in user, for the Help
// menu "Your requests" list). Otherwise super_admin only:
// ?status=open|in_progress|resolved|rejected|all
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const svc = getSupabaseService();

  if (url.searchParams.get("mine") === "1") {
    const scope = await getUserScope();
    if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await svc
      .from("help_requests")
      .select("id, category, subject, body, status, admin_notes, created_at, resolved_at")
      .eq("created_by", scope.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ requests: data ?? [] });
  }

  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const status = url.searchParams.get("status") ?? "all";
  let q = svc
    .from("help_requests")
    .select("id, company_name, company_bio_id, author_name, author_email, author_tier, category, subject, body, status, admin_notes, created_at, resolved_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

// PATCH — update status / admin notes (super_admin only). The admin_notes double
// as the reply/rejection reason the requester sees in their "Your requests" list.
export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const b = await req.json().catch(() => ({}));
  const id = String(b?.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (typeof b?.status === "string" && ALL_STATUSES.includes(b.status)) {
    const closed = CLOSED_STATUSES.includes(b.status);
    update.status = b.status;
    update.resolved_at = closed ? new Date().toISOString() : null;
    update.resolved_by = closed ? (guard as { user: { id: string } }).user.id : null;
  }
  if (typeof b?.admin_notes === "string") update.admin_notes = b.admin_notes.slice(0, 4000);
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await getSupabaseService().from("help_requests").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
