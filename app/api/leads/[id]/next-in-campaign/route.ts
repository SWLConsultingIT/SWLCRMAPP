import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Returns the next lead in the SAME outreach flow whose current step is a
// call. Used by the "Next call →" button on the lead detail page so a
// seller can chain calls without bouncing back to /queue or /campaigns to
// pick the next one manually.
//
// A "flow" in this app is the (campaign.name, icp_profile_id) pair —
// every lead in a flow has its own `campaigns` row, but they all share
// the same name and ICP. We join lead.icp_profile_id to identify them.
//
// Ordering: oldest last_step_at first. The lead that hit the call step
// longest ago is the one most overdue, so sellers naturally clear the
// queue from the bottom up.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: currentLeadId } = await params;
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const svc = getSupabaseService();

  // 1) Identify the current lead's active campaign + flow grouping (name + ICP).
  const { data: currentRow } = await svc.from("leads")
    .select("id, icp_profile_id, company_bio_id, campaigns!inner(id, name, status, current_step, sequence_steps, seller_id)")
    .eq("id", currentLeadId)
    .eq("campaigns.status", "active")
    .maybeSingle();

  if (!currentRow) return NextResponse.json({ next: null, total: 0, reason: "no_active_campaign" });

  const camp = Array.isArray((currentRow as any).campaigns) ? (currentRow as any).campaigns[0] : (currentRow as any).campaigns;
  const flowName: string | null = camp?.name ?? null;
  const icpId: string | null = (currentRow as any).icp_profile_id ?? null;
  const tenantBioId: string | null = (currentRow as any).company_bio_id ?? null;
  if (!flowName || !icpId) return NextResponse.json({ next: null, total: 0, reason: "missing_flow_metadata" });

  // Tenant gate: scoped users only see their own tenant; super_admin
  // scoped via the switcher only sees the active tenant. Without this an
  // SWL admin chaining calls could accidentally jump to a Pathway lead.
  if (scope.isScoped && scope.companyBioId && tenantBioId && scope.companyBioId !== tenantBioId) {
    return NextResponse.json({ error: "lead not in your tenant" }, { status: 403 });
  }

  // 2) Pull every active campaign in the same flow (same name + icp).
  let q = svc.from("campaigns")
    .select("id, lead_id, current_step, sequence_steps, last_step_at, leads!inner(id, icp_profile_id)")
    .eq("status", "active")
    .eq("name", flowName)
    .eq("leads.icp_profile_id", icpId)
    .neq("lead_id", currentLeadId)
    .order("last_step_at", { ascending: true });

  if (scope.isScoped && scope.companyBioId) {
    q = q.eq("leads.company_bio_id", scope.companyBioId);
  }

  const { data: peers } = await q;

  // 3) Filter to peers whose current_step in their sequence_steps points
  // at a "call" channel. The sequence is per-campaign so we can't assume
  // step indices match across rows — read each one's own steps[idx].
  const candidates = (peers ?? []).filter((c: any) => {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const idx = (c.current_step ?? 0);
    const stepConfig = steps[idx];
    return stepConfig?.channel === "call";
  });

  if (candidates.length === 0) return NextResponse.json({ next: null, total: 0, reason: "no_more_calls" });

  return NextResponse.json({
    next: { leadId: candidates[0].lead_id as string, campaignId: candidates[0].id as string },
    total: candidates.length,
  });
}
