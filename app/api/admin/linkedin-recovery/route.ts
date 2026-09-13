// LinkedIn Recovery — minimal copy-approval surface for the pilot.
//
// GET  → list recoveries awaiting copy approval (state WAITING_REINVITE with a
//        generated second copy but no approval yet), including attempt-#1 copy
//        for side-by-side review. Optional ?state=<state> to inspect any bucket.
// POST → { id, action: "approve" | "reject" }. Approve stamps copy_approved_at/by
//        (unblocks the reinvite gate). Reject sends the row to MANUAL_REVIEW.
//
// No second invite ever goes out without an approval here (the cron's reinvite
// gate requires copy_approved_at). Service-role reads, admin-tier gated.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { RECOVERY_STATES } from "@/lib/linkedin-recovery";
import { computeRecoveryKpis, kpisByDimension } from "@/lib/linkedin-recovery-metrics";

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!canViewAllTenantData(scope.tier)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const svc = getSupabaseService();

  // ?metrics=1 → recovery KPIs (from linkedin_recovery only; never inflates
  // campaign stats). Overall + by tenant + by seller.
  if (url.searchParams.get("metrics") === "1") {
    const { data, error } = await svc.from("linkedin_recovery")
      .select("state, withdrawn_at, second_invite_sent_at, second_message_sent_at, company_bio_id, seller_id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as any[];
    return NextResponse.json({
      ok: true,
      overall: computeRecoveryKpis(rows),
      byTenant: kpisByDimension(rows, "company_bio_id"),
      bySeller: kpisByDimension(rows, "seller_id"),
    });
  }

  let qy = svc.from("linkedin_recovery")
    .select("id, lead_id, campaign_id, company_bio_id, seller_id, state, stop_reason, original_invitation_id, original_invite_sent_at, withdrawn_at, reinvite_after, second_connection_note, second_dm, second_invite_sent_at, copy_approved_at, attempt_count, last_error, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (state) qy = qy.eq("state", state);
  else qy = qy.eq("state", RECOVERY_STATES.WAITING_REINVITE).not("second_connection_note", "is", null).is("copy_approved_at", null);

  const { data: rows, error } = await qy;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach attempt-#1 copy + lead label for side-by-side review (batched).
  const leadIds = [...new Set((rows ?? []).map((r: any) => r.lead_id))];
  const originalByLead = new Map<string, { note: string | null; dm: string | null }>();
  const labelByLead = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data: msgs } = await svc.from("campaign_messages").select("lead_id, step_number, content").eq("channel", "linkedin").in("lead_id", chunk);
    for (const m of msgs ?? []) {
      const cur = originalByLead.get((m as any).lead_id) ?? { note: null, dm: null };
      if ((m as any).step_number === 0 && !cur.note) cur.note = (m as any).content ?? null;
      if ((m as any).step_number >= 1 && !cur.dm) cur.dm = (m as any).content ?? null;
      originalByLead.set((m as any).lead_id, cur);
    }
    const { data: leads } = await svc.from("leads").select("id, primary_first_name, primary_last_name, company_name").in("id", chunk);
    for (const l of leads ?? []) labelByLead.set((l as any).id, `${(l as any).primary_first_name ?? ""} ${(l as any).primary_last_name ?? ""}`.trim() + ((l as any).company_name ? ` · ${(l as any).company_name}` : ""));
  }

  const items = (rows ?? []).map((r: any) => ({
    ...r,
    lead_label: labelByLead.get(r.lead_id) ?? r.lead_id,
    original_connection_note: originalByLead.get(r.lead_id)?.note ?? null,
    original_dm: originalByLead.get(r.lead_id)?.dm ?? null,
  }));

  return NextResponse.json({ ok: true, count: items.length, items });
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!canViewAllTenantData(scope.tier)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, action } = await req.json().catch(() => ({}));
  if (!id || (action !== "approve" && action !== "reject" && action !== "promote")) {
    return NextResponse.json({ error: "expected { id, action: 'approve'|'reject'|'promote' }" }, { status: 400 });
  }
  const svc = getSupabaseService();

  // promote: manual authorization to start recovery on a historical SHADOW row
  // (no completed_at anchor). Sets eligible_withdraw_at=now so the withdraw can
  // run immediately once enabled — the operator's promote IS the authorization,
  // replacing the completed_at+5d wait that only applies to NEW campaigns. The
  // 21-day post-withdrawal cooldown is unchanged (enforced at reinvite). This is
  // an internal state write only; the withdraw itself still needs the feature
  // flag + cron. Only from SHADOW, one at a time (max-5 pilot enforced by the
  // operator, not here).
  if (action === "promote") {
    const { data, error } = await svc.from("linkedin_recovery")
      .update({ state: RECOVERY_STATES.WAITING_WITHDRAWAL, eligible_withdraw_at: new Date().toISOString(), stop_reason: "manual_promote" })
      .eq("id", id).eq("state", RECOVERY_STATES.SHADOW).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "not promotable (not in SHADOW)" }, { status: 409 });
    return NextResponse.json({ ok: true, id, promoted: true });
  }

  if (action === "approve") {
    // Only approvable while still awaiting reinvite with generated copy.
    const { data, error } = await svc.from("linkedin_recovery")
      .update({ copy_approved_at: new Date().toISOString(), copy_approved_by: scope.userId })
      .eq("id", id).eq("state", RECOVERY_STATES.WAITING_REINVITE).not("second_connection_note", "is", null)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "not approvable (wrong state or no copy)" }, { status: 409 });
    return NextResponse.json({ ok: true, id, approved: true });
  }

  const { data, error } = await svc.from("linkedin_recovery")
    .update({ state: RECOVERY_STATES.MANUAL_REVIEW, stop_reason: "copy_rejected" })
    .eq("id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id, rejected: (data?.length ?? 0) > 0 });
}
