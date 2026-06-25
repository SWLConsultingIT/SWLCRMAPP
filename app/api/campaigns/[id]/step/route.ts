// Tenant-scoped manual step override for a campaign. Lets a seller drag a
// lead between Step columns on the Outreach Flow board: "skip" fakes the Nth
// DM as sent (no dispatch), "send" forces the orchestrator to send step N on
// the next cycle by setting current_step=N-1 + back-dating last_step_at.
//
// Auth: requires canCreateCampaigns (any non-viewer authenticated user in the
// tenant). Cross-tenant IDs are rejected with 403.
//
// Pre-2026-05-29 this route had NO auth gate — anyone could rewrite any
// campaign's cursor or force-send messages on any tenant.

import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canCreateCampaigns } from "@/lib/scope";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canCreateCampaigns(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseService();
  const { id } = await params;

  // Tenant gate — resolve the campaign's owning tenant via its lead.
  const { data: campRow, error: readErr } = await supabase
    .from("campaigns")
    .select("id, leads!inner(company_bio_id)")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!campRow) return NextResponse.json({ error: "not found" }, { status: 404 });
  const leadsField = (campRow as any).leads;
  const campBioId = Array.isArray(leadsField) ? leadsField[0]?.company_bio_id : leadsField?.company_bio_id;
  if (scope.isScoped && campBioId !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const step = Number(body.currentStep);
  const action: "skip" | "send" = body.action === "send" ? "send" : "skip";
  if (!Number.isFinite(step) || step < 0) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }

  // Kanban semantics: Step N col = "Nth DM sent" = current_step=N.
  // - "skip": force current_step=N (fake that the Nth DM was sent). No orchestrator send.
  // - "send": set current_step=N-1 so the orchestrator's next cycle sends step_number=N.
  //           Post-send, the orchestrator naturally advances current_step to N.
  //           Back-date last_step_at to ensure daysAfter check passes.
  const update: Record<string, any> = action === "send"
    ? {
        current_step: Math.max(0, step - 1),
        paused_until: null,
        paused_channel: null,
        last_step_at: new Date(Date.now() - 7 * 86400000).toISOString(),
      }
    : {
        current_step: step,
        last_step_at: new Date().toISOString(),
      };

  const { error } = await supabase.from("campaigns").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nowISO = new Date().toISOString();

  if (action === "skip") {
    // Clear all queued/draft messages at or before the new cursor so the lead
    // doesn't snap back to the old column on the next orchestrator cycle.
    await supabase.from("campaign_messages")
      .update({ status: "skipped", metadata: { skipped_by: "kanban-skip", skipped_at: nowISO } })
      .eq("campaign_id", id)
      .lte("step_number", step)
      .in("status", ["queued", "draft"]);
    // Queue the next step so the orchestrator picks it up.
    const { data: nextRows } = await supabase.from("campaign_messages")
      .select("id")
      .eq("campaign_id", id)
      .eq("step_number", step + 1)
      .in("status", ["draft", "queued"])
      .limit(1);
    const nextId = (nextRows ?? [])[0]?.id;
    if (nextId) {
      await supabase.from("campaign_messages")
        .update({ status: "queued", metadata: { eligible_at: nowISO, queued_by: "kanban-skip" } })
        .eq("id", nextId);
    }
  } else {
    // "send": flip the target step's message draft→queued with eligible_at=now so
    // the dispatcher picks it up on the next orchestrator cycle (≤15 min).
    // Without this the message stays in `draft` and the orchestrator never sees it
    // — the send button advanced the UI but delivered nothing.
    await supabase.from("campaign_messages")
      .update({ status: "queued", metadata: { eligible_at: nowISO, queued_by: "kanban-send" } })
      .eq("campaign_id", id)
      .eq("step_number", step)
      .in("status", ["draft", "queued"]);
  }

  return NextResponse.json({ ok: true, currentStep: step, action });
}
