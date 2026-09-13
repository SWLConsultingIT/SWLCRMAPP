// Candidate discovery for LinkedIn Recovery — the CASE-1 cohort (campaign
// completed normally, invite still pending, never expire-invited). Shared by the
// cron and the shadow backfill script so both use the SAME predicate. Read-only:
// it reads and returns snapshots; enrollment (insert) is a separate step so the
// caller controls dry-run.
//
// Uses a supabase-js client (service role) — same shape the cron and the script
// each build. Mirrors expire-invites' inner-join select.

// Relative import (not @/) so this module is usable both from Next (build
// resolves relative fine) and from tsx scripts (which don't resolve @/ paths).
import { classifyCandidate, sellerUsable, type CandidateSnapshot, type EnrollDecision } from "./linkedin-recovery";

const TERMINAL_LEAD = new Set(["qualified", "closed_won", "closed_lost", "discarded"]);

export type DiscoveredCandidate = {
  snapshot: CandidateSnapshot;
  decision: EnrollDecision;
  leadId: string;
  companyBioId: string | null;
  campaignId: string | null;
  sellerId: string | null;
  originalInviteSentAt: string | null;
};

type AnyClient = any;

export async function discoverCandidates(
  svc: AnyClient,
  opts: { companyBioIds?: string[] | null; limit?: number } = {},
): Promise<DiscoveredCandidate[]> {
  const limit = opts.limit ?? 200;
  const allowlist = opts.companyBioIds && opts.companyBioIds.length > 0 ? opts.companyBioIds : null;

  // 1. Step-0 LinkedIn invites, sent, with a withdraw handle, whose campaign
  //    completed/failed (NOT invite_expired) and whose lead never connected and
  //    still allows LinkedIn and isn't archived. Inner joins like expire-invites.
  let q = svc
    .from("campaign_messages")
    .select(`
      id, campaign_id, lead_id, company_bio_id, sent_at, provider_message_id,
      campaigns!inner(id, status, stop_reason, seller_id, completed_at, company_bio_id),
      leads!inner(id, status, archived, linkedin_connected, allow_linkedin, linkedin_internal_id)
    `)
    .eq("step_number", 0)
    .eq("channel", "linkedin")
    .eq("status", "sent")
    .not("provider_message_id", "is", null)
    .in("campaigns.status", ["completed", "failed"])
    .neq("campaigns.stop_reason", "invite_expired")
    .eq("leads.allow_linkedin", true)
    .not("leads.linkedin_connected", "is", true)
    .order("sent_at", { ascending: true })
    .limit(limit * 3); // over-fetch; we filter more below

  if (allowlist) q = q.in("company_bio_id", allowlist);

  const { data: rows, error } = await q;
  if (error) throw new Error(`discovery query failed: ${error.message}`);
  const raw = (rows ?? []) as any[];
  if (raw.length === 0) return [];

  const leadIds = [...new Set(raw.map((r) => r.lead_id).filter(Boolean))] as string[];

  // 2. Exclude leads that already have a recovery row (idempotent enrollment).
  const enrolled = new Set<string>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data } = await svc.from("linkedin_recovery").select("lead_id").in("lead_id", chunk);
    for (const r of data ?? []) enrolled.add((r as any).lead_id);
  }

  // 3. Active LinkedIn suppressions.
  const suppressed = new Set<string>();
  const nowISO = new Date().toISOString();
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data } = await svc
      .from("lead_suppressions")
      .select("lead_id, active, expires_at, channel")
      .eq("channel", "linkedin")
      .eq("active", true)
      .in("lead_id", chunk);
    for (const r of data ?? []) {
      const exp = (r as any).expires_at as string | null;
      if (!exp || exp > nowISO) suppressed.add((r as any).lead_id);
    }
  }

  // 4. Later LinkedIn engagement: any reply on the linkedin channel, or a sent
  //    step≥1 LinkedIn DM (means the conversation already advanced).
  const engaged = new Set<string>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data: reps } = await svc.from("lead_replies").select("lead_id").eq("channel", "linkedin").in("lead_id", chunk);
    for (const r of reps ?? []) engaged.add((r as any).lead_id);
    const { data: dms } = await svc
      .from("campaign_messages")
      .select("lead_id")
      .eq("channel", "linkedin")
      .eq("status", "sent")
      .gte("step_number", 1)
      .in("lead_id", chunk);
    for (const r of dms ?? []) engaged.add((r as any).lead_id);
  }

  // 5. Resolve sellers.
  const sellerIds = [...new Set(raw.map((r) => {
    const c = Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns;
    return c?.seller_id as string | null;
  }).filter(Boolean))] as string[];
  const sellerById = new Map<string, { linkedin_status: string | null; unipile_account_id: string | null; active: boolean }>();
  if (sellerIds.length > 0) {
    const { data } = await svc.from("sellers").select("id, linkedin_status, unipile_account_id, active").in("id", sellerIds);
    for (const s of data ?? []) sellerById.set((s as any).id, { linkedin_status: (s as any).linkedin_status, unipile_account_id: (s as any).unipile_account_id, active: (s as any).active });
  }

  // 6. Build snapshots (dedupe per lead — keep the most recent sent invite,
  //    which raw is ordered ascending so later wins).
  const perLead = new Map<string, DiscoveredCandidate>();
  for (const r of raw) {
    const leadId = r.lead_id as string;
    if (!leadId || enrolled.has(leadId)) continue;
    const camp = Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns;
    const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
    if (!camp || !lead) continue;
    const seller = camp.seller_id ? sellerById.get(camp.seller_id) : null;
    const accountAvailable = !!seller?.unipile_account_id;
    const sellerActive = !!seller && seller.active !== false && sellerUsable(seller.linkedin_status, seller.unipile_account_id);

    const snapshot: CandidateSnapshot = {
      completedAt: camp.completed_at ?? null,
      leadConnected: lead.linkedin_connected === true,
      leadTerminal: TERMINAL_LEAD.has((lead.status ?? "").toLowerCase()),
      leadArchived: lead.archived === true,
      suppressed: suppressed.has(leadId),
      laterEngagement: engaged.has(leadId),
      originalInvitationId: r.provider_message_id ?? null,
      linkedinInternalId: lead.linkedin_internal_id ?? null,
      sellerId: camp.seller_id ?? null,
      accountAvailable,
      sellerActive,
      stopReason: camp.stop_reason ?? null,
    };
    perLead.set(leadId, {
      snapshot,
      decision: classifyCandidate(snapshot),
      leadId,
      companyBioId: (r.company_bio_id ?? camp.company_bio_id ?? null) as string | null,
      campaignId: (camp.id ?? r.campaign_id ?? null) as string | null,
      sellerId: camp.seller_id ?? null,
      originalInviteSentAt: r.sent_at ?? null,
    });
  }

  return [...perLead.values()].slice(0, limit);
}

// Build the insert row for an enrollable candidate. Returns null for non-enroll.
export function buildRecoveryRow(c: DiscoveredCandidate): Record<string, unknown> | null {
  if (!c.decision.enroll) return null;
  return {
    company_bio_id: c.companyBioId,
    lead_id: c.leadId,
    campaign_id: c.campaignId,
    seller_id: c.sellerId,
    original_invitation_id: c.snapshot.originalInvitationId,
    original_invite_sent_at: c.originalInviteSentAt,
    state: c.decision.state,
    eligible_withdraw_at: c.decision.eligibleWithdrawAt,
    attempt_count: 1,
    stop_reason: c.decision.reason === "eligible" ? null : c.decision.reason,
  };
}
