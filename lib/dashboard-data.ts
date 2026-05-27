// Shared metrics layer for the new Dashboard + drill-downs + the PDF export.
// Pre-2026-05-26 these computations lived inline in /reports/page.tsx. Moving
// them here lets the new top-level Dashboard, the per-campaign / per-icp /
// per-seller drill-downs and the print page all derive from the same numbers
// (so what you see matches what you export).

import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";

export type DashboardFilters = {
  /** ISO YYYY-MM-DD (inclusive). null = no lower bound. */
  from: string | null;
  /** ISO YYYY-MM-DD (inclusive). null = no upper bound. */
  to: string | null;
  /** Restrict to specific campaign names (the wizard groups by name). */
  campaignNames?: string[];
  /** Restrict to specific seller ids. */
  sellerIds?: string[];
  /** Restrict to specific ICP profile ids. */
  icpIds?: string[];
};

type LeadRow = {
  id: string;
  status: string | null;
  lead_score: number | null;
  is_priority: boolean | null;
  icp_profile_id: string | null;
  created_at: string | null;
  company_bio_id: string | null;
  company_name: string | null;
};
type CampRow = {
  id: string;
  name: string;
  status: string | null;
  channel: string | null;
  current_step: number | null;
  sequence_steps: unknown;
  lead_id: string | null;
  seller_id: string | null;
  created_at: string | null;
  stop_reason?: string | null;
};
type ReplyRow = {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  classification: string | null;
  channel: string | null;
  received_at: string | null;
};
type MsgRow = {
  id: string;
  campaign_id: string | null;
  step_number: number | null;
  status: string | null;
  sent_at: string | null;
};

const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);
const NEGATIVE_CLASS = new Set(["negative", "not_now", "unsubscribe"]);

function inWindow(iso: string | null | undefined, fromMs: number | null, toMs: number | null) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (fromMs !== null && t < fromMs) return false;
  if (toMs !== null && t > toMs) return false;
  return true;
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? 100 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

/**
 * Pulls the full tenant-scoped dataset and computes every metric the new
 * Dashboard needs: headline KPIs (with prior-period deltas), the funnel,
 * per-channel breakdown, ICP / campaign / seller comparisons, and 30-day
 * trend sparklines.
 *
 * Super_admin (no `scope.companyBioId`) sees every tenant — that's intentional
 * for SWL ops. Scoped users (client tenants) only see their own data via the
 * `leads.company_bio_id = bioId` join.
 */
// Empty fallback returned when the main fetch throws — keeps the page
// renderable. Boss-feedback rule: live clients never see a blank 500.
const EMPTY_DASHBOARD = {
  period: { from: null as string | null, to: null as string | null, days: 30 },
  headline: { totalLeads: 0, contactedLeads: 0, connectedLeads: 0, repliedCount: 0, positiveCount: 0, negativeCount: 0, meetingCount: 0, wonCount: 0, responseRate: 0, conversionRate: 0 },
  deltas: { contacted: null as number | null, replied: null as number | null, positive: null as number | null },
  funnel: [
    { stage: "imported",          count: 0, prior: null as number | null, color: "neutral" },
    { stage: "contacted",         count: 0, prior: null as number | null, color: "info" },
    { stage: "linkedin_accepted", count: 0, prior: null as number | null, color: "info" },
    { stage: "replied",           count: 0, prior: null as number | null, color: "warning" },
    { stage: "won",               count: 0, prior: null as number | null, color: "brand" },
  ],
  channelBreakdown: [] as Array<{ channel: string; sent: number; contacted: number; replied: number; positive: number; responseRate: number; conversionRate: number }>,
  callsBreakdown: { pending: 0, completed: 0, answered: 0, positive: 0, negative: 0, total: 0 },
  linkedinConnections: { sent: 0, accepted: 0 },
  icpPerformance: [] as Array<any>,
  campaignPerformance: [] as Array<any>,
  sellerPerformance: [] as Array<any>,
  trend30d: { sent: new Array(30).fill(0) as number[], replies: new Array(30).fill(0) as number[], positive: new Array(30).fill(0) as number[] },
  trendPrior: { sent: new Array(30).fill(0) as number[], replies: new Array(30).fill(0) as number[], positive: new Array(30).fill(0) as number[] },
  replyClassCounts: { positive: 0, meeting_intent: 0 } as Record<string, number>,
  insights: [] as Array<{ tone: "positive" | "warning" | "neutral"; kind: string; vars: Record<string, string | number>; text: string }>,
  activeCampaignCount: 0,
  pausedCampaignCount: 0,
  completedCampaignCount: 0,
  leadsInActiveCampaigns: 0,
  leadsWithoutCampaign: 0,
  todayLists: {
    replies: [] as Array<{ id: string; company: string; icp: string | null; when: string | null; tag: string | null }>,
    positives: [] as Array<{ id: string; company: string; icp: string | null; when: string | null; tag: string | null }>,
    calls: [] as Array<{ id: string; company: string; icp: string | null; when: string | null; tag: string | null }>,
    unassigned: [] as Array<{ id: string; company: string; icp: string | null; when: string | null; tag: string | null }>,
  },
  velocity: { perDay: 0, winRate: 0, medianTimeToReplyMin: null as number | null, acceptanceRate: 0, forecastMonthEnd: 0 },
  matrix: { icps: [] as Array<{ id: string; name: string }>, channels: [] as string[], cells: [] as Array<any>, mean: 0, stddev: 0 },
  stepPerformance: [] as Array<any>,
  velocityDecay: { points: [] as Array<any>, cutoffDay: null as number | null, finalPct: 0 },
  health: {} as Record<string, unknown>,
  heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]),
};

export async function getDashboardData(filters: DashboardFilters) {
  try {
    return await getDashboardDataInternal(filters);
  } catch (e) {
    console.error("[dashboard-data] unrecoverable error — serving empty dashboard:", e);
    return EMPTY_DASHBOARD;
  }
}

async function getDashboardDataInternal(filters: DashboardFilters) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const leadsQ = supabase.from("leads").select("id, status, lead_score, is_priority, icp_profile_id, created_at, company_bio_id, company_name");
  const campsQ = supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, created_at, stop_reason, leads!inner(company_bio_id)");
  const repliesQ = supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at, leads!inner(company_bio_id)");
  const msgsQ = supabase.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, campaigns!inner(leads!inner(company_bio_id))");
  const profilesQ = supabase.from("icp_profiles").select("id, profile_name, company_bio_id").eq("status", "approved");
  const sellersQ = supabase.from("sellers").select("id, name, active, company_bio_id");

  const [
    { data: allLeadsRaw },
    { data: allCampsRaw },
    { data: allRepliesRaw },
    { data: allMsgsRaw },
    { data: allProfilesRaw },
    { data: allSellersRaw },
  ] = await Promise.all([
    bioId ? leadsQ.eq("company_bio_id", bioId) : leadsQ,
    bioId ? campsQ.eq("leads.company_bio_id", bioId) : campsQ,
    bioId ? repliesQ.eq("leads.company_bio_id", bioId) : repliesQ,
    bioId ? msgsQ.eq("campaigns.leads.company_bio_id", bioId) : msgsQ,
    bioId ? profilesQ.eq("company_bio_id", bioId) : profilesQ,
    bioId ? sellersQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`) : sellersQ,
  ]);

  const allLeads = (allLeadsRaw ?? []) as LeadRow[];
  const allCampaigns = (allCampsRaw ?? []) as CampRow[];
  const allReplies = (allRepliesRaw ?? []) as ReplyRow[];
  const allMessages = (allMsgsRaw ?? []) as MsgRow[];
  const allProfiles = (allProfilesRaw ?? []) as { id: string; profile_name: string }[];
  const allSellers = (allSellersRaw ?? []) as { id: string; name: string; active: boolean }[];

  // Calls — fetched separately so any failure (RLS / missing column /
  // FK metadata mismatch) doesn't bring the whole dashboard down. Scopes
  // by lead_id IN(...) instead of relying on PostgREST relationship
  // inference; the leads list is already bio-scoped above.
  type CallRow = {
    id: string; lead_id: string | null; status: string | null;
    duration: number | null; classification: string | null; started_at: string | null;
  };
  let allCalls: CallRow[] = [];
  try {
    const cappedLeadIds = allLeads.map(l => l.id).slice(0, 5000);
    if (cappedLeadIds.length > 0) {
      const { data, error } = await supabase
        .from("calls")
        .select("id, lead_id, status, duration, classification, started_at")
        .in("lead_id", cappedLeadIds);
      if (error) throw error;
      allCalls = (data ?? []) as CallRow[];
    }
  } catch (e) {
    console.warn("[dashboard-data] calls fetch failed — degrading to empty breakdown:", e);
    allCalls = [];
  }

  // ── Apply user-supplied filters in-memory ───────────────────────────────
  const fromMs = filters.from ? new Date(`${filters.from}T00:00:00Z`).getTime() : null;
  const toMs   = filters.to   ? new Date(`${filters.to}T23:59:59Z`).getTime()   : null;
  const campSet   = filters.campaignNames && filters.campaignNames.length > 0 ? new Set(filters.campaignNames) : null;
  const sellerSet = filters.sellerIds && filters.sellerIds.length > 0 ? new Set(filters.sellerIds) : null;
  const icpSet    = filters.icpIds && filters.icpIds.length > 0 ? new Set(filters.icpIds) : null;

  const leads = allLeads.filter(l => {
    if (icpSet && !icpSet.has(l.icp_profile_id ?? "")) return false;
    if (fromMs !== null || toMs !== null) {
      if (!inWindow(l.created_at, fromMs, toMs)) return false;
    }
    return true;
  });
  const leadIdSet = new Set(leads.map(l => l.id));

  const campaigns = allCampaigns.filter(c => {
    if (campSet && !campSet.has(c.name)) return false;
    if (sellerSet && !sellerSet.has(c.seller_id ?? "")) return false;
    if (icpSet && c.lead_id && !leadIdSet.has(c.lead_id)) return false;
    return true;
  });
  const campaignIdSet = new Set(campaigns.map(c => c.id));

  const replies = allReplies.filter(r => {
    if (fromMs !== null || toMs !== null) {
      if (!inWindow(r.received_at, fromMs, toMs)) return false;
    }
    if (icpSet && r.lead_id && !leadIdSet.has(r.lead_id)) return false;
    if ((campSet || sellerSet) && r.campaign_id && !campaignIdSet.has(r.campaign_id)) return false;
    return true;
  });

  const messages = allMessages.filter(m => {
    if (m.status !== "sent") return false;
    if (fromMs !== null || toMs !== null) {
      if (!inWindow(m.sent_at, fromMs, toMs)) return false;
    }
    if ((campSet || sellerSet || icpSet) && m.campaign_id && !campaignIdSet.has(m.campaign_id)) return false;
    return true;
  });

  // Lookup maps used by every downstream block.
  const profileMap = new Map<string, string>();
  for (const p of allProfiles) profileMap.set(p.id, p.profile_name);
  const sellerMap = new Map<string, string>();
  for (const s of allSellers) sellerMap.set(s.id, s.name);
  const campByName = new Map<string, CampRow[]>();
  for (const c of campaigns) {
    const list = campByName.get(c.name) ?? [];
    list.push(c);
    campByName.set(c.name, list);
  }

  // ── Funnel sets ─────────────────────────────────────────────────────────
  //   leads imported (everything in `leads`)
  //   contacted: a campaign exists for that lead (CR sent or queued)
  //   connected: a sent message at step_number >= 1 (post-acceptance) OR a
  //              campaign with current_step >= 1
  //   replied: any inbound message
  //   positive: classification ∈ POSITIVE_CLASS
  //   meeting: lead.status = 'qualified'  (the manual cascade / odoo path)
  //   won: lead.status = 'closed_won'
  const leadsWithCampaign = new Set(campaigns.map(c => c.lead_id).filter(Boolean) as string[]);
  const connectedLeadIds = new Set<string>();
  for (const m of messages) {
    if ((m.step_number ?? 0) >= 1 && m.campaign_id) {
      const c = campaigns.find(x => x.id === m.campaign_id);
      if (c?.lead_id) connectedLeadIds.add(c.lead_id);
    }
  }
  for (const c of campaigns) if ((c.current_step ?? 0) >= 1 && c.lead_id) connectedLeadIds.add(c.lead_id);
  const repliedLeadIds = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveReplies = replies.filter(r => POSITIVE_CLASS.has(r.classification ?? ""));
  const negativeReplies = replies.filter(r => NEGATIVE_CLASS.has(r.classification ?? ""));
  const positiveLeadIds = new Set(positiveReplies.map(r => r.lead_id).filter(Boolean) as string[]);
  const meetingLeadIds = new Set(leads.filter(l => l.status === "qualified").map(l => l.id));
  const wonLeadIds = new Set(leads.filter(l => l.status === "closed_won").map(l => l.id));

  // ── Per-channel touch sets (boss-feedback 2026-05-27 funnel redefinition).
  // "Leads with ≥1 X" = leads who got at least one sent message via a
  // campaign of channel=X. Computed once for the new funnel.
  // The CR (step 0) counts as a LinkedIn "send" for the LI-Sent stage; for
  // "≥1 LinkedIn message" we want a step >= 1 (post-acceptance reach-out).
  const linkedinSentLeadIds = new Set<string>();
  const linkedinMessageLeadIds = new Set<string>();
  const emailTouchLeadIds = new Set<string>();
  const callTouchLeadIds = new Set<string>();
  const campaignChannelById = new Map<string, string>();
  const campaignLeadById = new Map<string, string>();
  for (const c of campaigns) {
    if (c.channel) campaignChannelById.set(c.id, c.channel);
    if (c.lead_id) campaignLeadById.set(c.id, c.lead_id);
  }
  for (const m of messages) {
    if (m.status !== "sent" || !m.campaign_id) continue;
    const ch = campaignChannelById.get(m.campaign_id);
    const leadId = campaignLeadById.get(m.campaign_id);
    if (!ch || !leadId) continue;
    if (ch === "linkedin") {
      linkedinSentLeadIds.add(leadId);
      if ((m.step_number ?? 0) >= 1) linkedinMessageLeadIds.add(leadId);
    } else if (ch === "email") {
      emailTouchLeadIds.add(leadId);
    } else if (ch === "call") {
      callTouchLeadIds.add(leadId);
    }
  }

  // Lost = explicit negative classification OR lead in closed_lost status.
  // The two overlap in most cases (a negative reply triggers a status flip)
  // but counting via a union covers manual closures too.
  const lostLeadIds = new Set<string>([
    ...(negativeReplies.map(r => r.lead_id).filter(Boolean) as string[]),
    ...leads.filter(l => l.status === "closed_lost").map(l => l.id),
  ]);

  const totalLeads = leads.length;
  const contactedLeads = leadsWithCampaign.size;
  const connectedLeads = connectedLeadIds.size;
  const repliedCount = repliedLeadIds.size;
  const positiveCount = positiveLeadIds.size;
  const meetingCount = meetingLeadIds.size;
  const wonCount = wonLeadIds.size;
  const negativeCount = new Set(negativeReplies.map(r => r.lead_id).filter(Boolean) as string[]).size;
  const linkedinSentCount = linkedinSentLeadIds.size;
  const linkedinMessageCount = linkedinMessageLeadIds.size;
  const emailTouchCount = emailTouchLeadIds.size;
  const callTouchCount = callTouchLeadIds.size;
  const lostCount = lostLeadIds.size;

  const responseRate = contactedLeads > 0 ? Math.round((repliedCount / contactedLeads) * 100) : 0;
  const positiveRate = repliedCount > 0 ? Math.round((positiveCount / repliedCount) * 100) : 0;
  const conversionRate = contactedLeads > 0 ? Math.round((positiveCount / contactedLeads) * 100) : 0;
  const acceptanceRate = contactedLeads > 0 ? Math.round((connectedLeads / contactedLeads) * 100) : 0;

  // ── Engine health signals ───────────────────────────────────────────────
  //
  // Saturation Index: campaigns that reached the END of their sequence
  // (current_step >= total steps) WITHOUT any reply. If this gets high, the
  // machine is burning inboxes for nothing — either the messaging or the
  // targeting is off. Floor at 5 campaigns total to avoid noise from tiny
  // tenants.
  let saturatedCount = 0;
  let evaluatedSeqCount = 0;
  for (const c of campaigns) {
    const total = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
    if (total < 1) continue;
    evaluatedSeqCount++;
    if ((c.current_step ?? 0) >= total && c.lead_id && !repliedLeadIds.has(c.lead_id)) {
      saturatedCount++;
    }
  }
  const saturationRate = evaluatedSeqCount >= 5
    ? Math.round((saturatedCount / evaluatedSeqCount) * 100)
    : null;

  // Pipeline at risk: paused campaigns + active campaigns with NO message
  // sent in the last 7 days. The 7d window is heuristic — anything stalled
  // longer than the longest typical step gap is suspicious. We compute per
  // campaign-id, so a campaign with `status='active'` but `current_step=0`
  // and no recent send counts as "at risk" (likely never dispatched).
  const SEVEN_DAYS_MS = 7 * 86_400_000;
  const nowMs = Date.now();
  const lastSentByCampaign = new Map<string, number>();
  for (const m of allMessages) {
    if (!m.campaign_id || !m.sent_at) continue;
    if (m.status !== "sent") continue;
    const t = new Date(m.sent_at).getTime();
    const prev = lastSentByCampaign.get(m.campaign_id) ?? 0;
    if (t > prev) lastSentByCampaign.set(m.campaign_id, t);
  }
  let atRiskCount = 0;
  for (const c of campaigns) {
    if (c.status === "paused") { atRiskCount++; continue; }
    if (c.status === "active") {
      const last = lastSentByCampaign.get(c.id) ?? 0;
      if (nowMs - last > SEVEN_DAYS_MS) atRiskCount++;
    }
  }

  // Channel mismatch: % of replies that arrived through a channel DIFFERENT
  // from the campaign's channel. Strong signal that the lead's preferred
  // channel doesn't match what we picked — informative for ICP-level channel
  // selection. Only counts replies that have a recorded channel AND a
  // resolvable campaign.
  let mismatchCount = 0;
  let evaluatedReplies = 0;
  for (const r of replies) {
    if (!r.channel || !r.campaign_id) continue;
    const c = campaigns.find(x => x.id === r.campaign_id);
    if (!c?.channel) continue;
    evaluatedReplies++;
    if (r.channel !== c.channel) mismatchCount++;
  }
  const channelMismatchRate = evaluatedReplies >= 10
    ? Math.round((mismatchCount / evaluatedReplies) * 100)
    : null;

  // ── Per-channel breakdown ───────────────────────────────────────────────
  const channelStats = new Map<string, { sent: number; contacted: Set<string>; replied: Set<string>; positive: Set<string> }>();
  for (const c of campaigns) {
    const ch = c.channel ?? "linkedin";
    let s = channelStats.get(ch);
    if (!s) { s = { sent: 0, contacted: new Set(), replied: new Set(), positive: new Set() }; channelStats.set(ch, s); }
    if (c.lead_id) {
      s.contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) s.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) s.positive.add(c.lead_id);
    }
  }
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const s = channelStats.get(c.channel ?? "linkedin");
    if (s) s.sent++;
  }
  // Boss-feedback 2026-05-27: the Channels chapter must always show
  // email / linkedin / call cards, even when activity is zero — a missing
  // card silently looked like "we don't have this channel" when really
  // it means "we haven't used it this period".
  for (const ch of ["linkedin", "email", "call"]) {
    if (!channelStats.has(ch)) {
      channelStats.set(ch, { sent: 0, contacted: new Set(), replied: new Set(), positive: new Set() });
    }
  }
  const channelBreakdown = Array.from(channelStats.entries()).map(([channel, s]) => ({
    channel,
    sent: s.sent,
    contacted: s.contacted.size,
    replied: s.replied.size,
    positive: s.positive.size,
    responseRate: s.contacted.size > 0 ? Math.round((s.replied.size / s.contacted.size) * 100) : 0,
    conversionRate: s.contacted.size > 0 ? Math.round((s.positive.size / s.contacted.size) * 100) : 0,
  })).sort((a, b) => b.responseRate - a.responseRate);

  // ── Calls breakdown (boss feedback 2026-05-27) ─────────────────────────
  // 5 sub-counts: pending / completed / answered / positive / negative.
  // Pending = queued/pending call-channel messages (state, not period).
  // Completed/Answered/Positive/Negative come from the calls table,
  // period-filtered by started_at.
  const callsInPeriod = allCalls.filter(c => {
    if (fromMs !== null || toMs !== null) {
      if (!inWindow(c.started_at, fromMs, toMs)) return false;
    }
    return true;
  });
  const callsBreakdown = {
    pending: (() => {
      let n = 0;
      for (const m of allMessages) {
        if (m.status !== "queued" && m.status !== "pending") continue;
        if (!m.campaign_id) continue;
        if (campaignChannelById.get(m.campaign_id) === "call") n++;
      }
      return n;
    })(),
    completed: callsInPeriod.filter(c => c.status === "completed").length,
    answered:  callsInPeriod.filter(c => (c.duration ?? 0) > 0).length,
    positive:  callsInPeriod.filter(c => POSITIVE_CLASS.has(c.classification ?? "")).length,
    negative:  callsInPeriod.filter(c => NEGATIVE_CLASS.has(c.classification ?? "")).length,
    total:     callsInPeriod.length,
  };

  // ── Sequence step performance ────────────────────────────────────────
  //
  // For each step in the sequence (step_number 0 = CR/intro, step 1+ = DM/email
  // follow-ups), what's the reply rate? Today the dashboard reports aggregate
  // reply rates per campaign or per channel — that hides which SPECIFIC step
  // is killing the funnel. If step 2 has 0% reply and step 3 has 6%, you
  // know to rewrite step 2.
  //
  // Reply attribution: for each reply, the "responsible step" is the
  // step_number of the LAST sent message before the reply timestamp. This is
  // the right proxy — the lead is reacting to that message.
  type StepAgg = { sent: number; replied: number };
  const stepAgg = new Map<number, StepAgg>();
  const ensureStep = (n: number): StepAgg => {
    let g = stepAgg.get(n);
    if (!g) { g = { sent: 0, replied: 0 }; stepAgg.set(n, g); }
    return g;
  };
  for (const m of messages) {
    if (m.status !== "sent") continue;
    const step = m.step_number ?? 0;
    ensureStep(step).sent++;
  }
  // Index messages by campaign_id for fast last-sent lookup per reply.
  const sentByCampaign = new Map<string, MsgRow[]>();
  for (const m of messages) {
    if (m.status !== "sent" || !m.sent_at || !m.campaign_id) continue;
    const list = sentByCampaign.get(m.campaign_id) ?? [];
    list.push(m);
    sentByCampaign.set(m.campaign_id, list);
  }
  for (const [, list] of sentByCampaign) list.sort((a, b) => (a.sent_at && b.sent_at ? new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime() : 0));

  for (const r of replies) {
    if (!r.campaign_id || !r.received_at) continue;
    const list = sentByCampaign.get(r.campaign_id);
    if (!list || list.length === 0) continue;
    const replyT = new Date(r.received_at).getTime();
    let attributedStep: number | null = null;
    for (const m of list) {
      if (!m.sent_at) continue;
      const t = new Date(m.sent_at).getTime();
      if (t <= replyT) attributedStep = m.step_number ?? 0;
      else break;
    }
    if (attributedStep !== null) ensureStep(attributedStep).replied++;
  }

  const stepPerformance = Array.from(stepAgg.entries())
    .map(([step, g]) => ({
      step,
      sent: g.sent,
      replied: g.replied,
      replyRate: g.sent >= 5 ? Math.round((g.replied / g.sent) * 100) : null,
    }))
    .sort((a, b) => a.step - b.step);

  // ── ICP × Channel matrix ─────────────────────────────────────────────
  //
  // The single highest-leverage question for SWL operators: which (ICP,
  // channel) combination is producing the best response rate? Today's
  // dashboard answers ICP and channel separately — you have to cross-
  // reference mentally. This grid is the answer.
  //
  // Cell color is driven by z-score against the matrix's own distribution,
  // not absolute thresholds, so the visualization self-scales whether your
  // average reply rate is 5% or 25%. Cells with contacted < CELL_MIN are
  // rendered as "n insuf." in the UI (we return rate=null here).
  const CELL_MIN = 10;
  type CellKey = string;
  type CellAgg = { contacted: Set<string>; replied: Set<string> };
  const matrixGrid = new Map<CellKey, CellAgg>();
  const keyOf = (icp: string, ch: string): CellKey => `${icp}|${ch}`;
  const ensureCell = (k: CellKey): CellAgg => {
    let cell = matrixGrid.get(k);
    if (!cell) { cell = { contacted: new Set(), replied: new Set() }; matrixGrid.set(k, cell); }
    return cell;
  };
  // Lookup: lead_id → icp_profile_id (filtered set only).
  const leadIcpMap = new Map<string, string>();
  for (const l of leads) leadIcpMap.set(l.id, l.icp_profile_id ?? "_unknown");

  for (const c of campaigns) {
    if (!c.lead_id) continue;
    const icpId = leadIcpMap.get(c.lead_id);
    if (!icpId) continue; // lead was filtered out
    const cell = ensureCell(keyOf(icpId, c.channel ?? "linkedin"));
    cell.contacted.add(c.lead_id);
    if (repliedLeadIds.has(c.lead_id)) cell.replied.add(c.lead_id);
  }

  const matrixIcps = new Set<string>();
  const matrixChannels = new Set<string>();
  for (const k of matrixGrid.keys()) {
    const [icp, ch] = k.split("|");
    matrixIcps.add(icp);
    matrixChannels.add(ch);
  }
  // Boss-feedback 2026-05-27: matrix must always include email (and the
  // other canonical outreach channels) even when zero leads have been
  // contacted via them — the empty cells render as "—" and tell the
  // operator "this channel exists, you just haven't used it for this ICP".
  // Without this, missing channels invisibly disappear from the matrix.
  for (const ch of ["linkedin", "email", "call"]) matrixChannels.add(ch);

  const channelOrder = ["linkedin", "email", "call", "whatsapp", "sms"];
  const orderedChannels = Array.from(matrixChannels).sort((a, b) => {
    const ai = channelOrder.indexOf(a); const bi = channelOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const orderedIcps = Array.from(matrixIcps)
    .map(id => ({ id, name: profileMap.get(id) ?? "Sin ICP" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  type MatrixCell = {
    icpId: string;
    channel: string;
    contacted: number;
    replied: number;
    /** Reply rate (0..1). null when contacted < CELL_MIN. */
    replyRate: number | null;
    /** Z-score vs the matrix's own non-null distribution. null when rate is null. */
    zScore: number | null;
  };
  const matrixCells: MatrixCell[] = [];
  for (const icp of orderedIcps) {
    for (const ch of orderedChannels) {
      const cell = matrixGrid.get(keyOf(icp.id, ch));
      const contacted = cell?.contacted.size ?? 0;
      const replied = cell?.replied.size ?? 0;
      const replyRate = contacted >= CELL_MIN ? replied / contacted : null;
      matrixCells.push({ icpId: icp.id, channel: ch, contacted, replied, replyRate, zScore: null });
    }
  }
  const rateValues = matrixCells.map(c => c.replyRate).filter((v): v is number => v !== null);
  const matrixMean = rateValues.length > 0 ? rateValues.reduce((a, b) => a + b, 0) / rateValues.length : 0;
  const matrixVariance = rateValues.length > 0 ? rateValues.reduce((a, b) => a + (b - matrixMean) ** 2, 0) / rateValues.length : 0;
  const matrixStddev = Math.sqrt(matrixVariance);
  for (const c of matrixCells) {
    if (c.replyRate === null) continue;
    c.zScore = matrixStddev > 0 ? (c.replyRate - matrixMean) / matrixStddev : 0;
  }

  // ── ICP performance ─────────────────────────────────────────────────────
  // Per-ICP channel-usage columns (boss-feedback 2026-05-27): lets the
  // operator compare which ICP rides which channel. The four channels
  // mirror the funnel stages (LI sent, LI msg post-accept, email, call).
  type IcpAgg = {
    id: string; name: string;
    leads: number; contacted: number; replied: number; positive: number;
    linkedinSent: number; linkedinMsg: number; emailTouch: number; callTouch: number;
  };
  const icpAgg = new Map<string, IcpAgg>();
  for (const l of leads) {
    const id = l.icp_profile_id ?? "_unknown";
    let g = icpAgg.get(id);
    if (!g) {
      g = {
        id,
        name: profileMap.get(id) ?? "Sin ICP",
        leads: 0, contacted: 0, replied: 0, positive: 0,
        linkedinSent: 0, linkedinMsg: 0, emailTouch: 0, callTouch: 0,
      };
      icpAgg.set(id, g);
    }
    g.leads++;
    if (leadsWithCampaign.has(l.id)) g.contacted++;
    if (repliedLeadIds.has(l.id)) g.replied++;
    if (positiveLeadIds.has(l.id)) g.positive++;
    if (linkedinSentLeadIds.has(l.id)) g.linkedinSent++;
    if (linkedinMessageLeadIds.has(l.id)) g.linkedinMsg++;
    if (emailTouchLeadIds.has(l.id)) g.emailTouch++;
    if (callTouchLeadIds.has(l.id)) g.callTouch++;
  }
  const icpPerformance = Array.from(icpAgg.values()).map(g => ({
    ...g,
    responseRate: g.contacted > 0 ? Math.round((g.replied / g.contacted) * 100) : 0,
    conversionRate: g.contacted > 0 ? Math.round((g.positive / g.contacted) * 100) : 0,
  })).sort((a, b) => b.conversionRate - a.conversionRate || b.leads - a.leads);

  // ── Campaign performance (grouped by name) ─────────────────────────────
  // Per-campaign channel breakdown (boss feedback 2026-05-27): each
  // campaign row now carries the per-channel send count + the count of
  // its leads that haven't received any send yet ("leads sin contactar").
  type CampAgg = {
    name: string; channels: Set<string>;
    leads: Set<string>; replied: Set<string>; positive: Set<string>; negative: Set<string>;
    sent: number; status: string;
    statuses: Set<string>;
    totalSteps: number;
    stepSum: number;
    stepCount: number;
    sentLinkedin: number; sentEmail: number; sentCall: number;
    contactedLeads: Set<string>;
  };
  const campAgg = new Map<string, CampAgg>();
  const negativeLeadSet = new Set(negativeReplies.map(r => r.lead_id).filter(Boolean) as string[]);
  for (const c of campaigns) {
    let g = campAgg.get(c.name);
    if (!g) {
      g = {
        name: c.name, channels: new Set(), leads: new Set(), replied: new Set(), positive: new Set(), negative: new Set(),
        sent: 0, status: c.status ?? "active", statuses: new Set(), totalSteps: 0, stepSum: 0, stepCount: 0,
        sentLinkedin: 0, sentEmail: 0, sentCall: 0,
        contactedLeads: new Set(),
      };
      campAgg.set(c.name, g);
    }
    g.channels.add(c.channel ?? "linkedin");
    g.statuses.add(c.status ?? "active");
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
      if (negativeLeadSet.has(c.lead_id)) g.negative.add(c.lead_id);
    }
    const ts = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
    g.totalSteps = Math.max(g.totalSteps, ts);
    g.stepSum += c.current_step ?? 0;
    g.stepCount++;
  }
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const g = campAgg.get(c.name);
    if (!g) continue;
    if (m.status === "sent") {
      g.sent++;
      const ch = c.channel ?? "linkedin";
      if (ch === "linkedin") g.sentLinkedin++;
      else if (ch === "email") g.sentEmail++;
      else if (ch === "call") g.sentCall++;
      if (c.lead_id) g.contactedLeads.add(c.lead_id);
    }
  }
  const campaignPerformance = Array.from(campAgg.values()).map(g => {
    let status = "completed";
    if (g.statuses.has("active")) status = "active";
    else if (g.statuses.has("paused")) status = "paused";
    return {
      name: g.name,
      channels: Array.from(g.channels),
      leads: g.leads.size,
      sent: g.sent,
      sentLinkedin: g.sentLinkedin,
      sentEmail: g.sentEmail,
      sentCall: g.sentCall,
      uncontactedLeads: Math.max(0, g.leads.size - g.contactedLeads.size),
      replied: g.replied.size,
      positive: g.positive.size,
      negative: g.negative.size,
      avgStep: g.stepCount > 0 ? Math.round((g.stepSum / g.stepCount) * 10) / 10 : 0,
      totalSteps: g.totalSteps,
      responseRate: g.leads.size > 0 ? Math.round((g.replied.size / g.leads.size) * 100) : 0,
      conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
      status,
    };
  }).sort((a, b) => b.conversionRate - a.conversionRate || b.leads - a.leads);

  // ── Seller leaderboard ─────────────────────────────────────────────────
  type SellerAgg = { id: string; name: string; contacted: Set<string>; replied: Set<string>; positive: Set<string>; active: number; sent: number };
  const sellerAgg = new Map<string, SellerAgg>();
  for (const c of campaigns) {
    if (!c.seller_id) continue;
    let g = sellerAgg.get(c.seller_id);
    if (!g) { g = { id: c.seller_id, name: sellerMap.get(c.seller_id) ?? "Sin asignar", contacted: new Set(), replied: new Set(), positive: new Set(), active: 0, sent: 0 }; sellerAgg.set(c.seller_id, g); }
    if (c.lead_id) {
      g.contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
    }
    if (c.status === "active") g.active++;
  }
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c?.seller_id) continue;
    const g = sellerAgg.get(c.seller_id);
    if (g) g.sent++;
  }
  const sellerPerformance = Array.from(sellerAgg.values()).map(g => ({
    id: g.id,
    name: g.name,
    contacted: g.contacted.size,
    sent: g.sent,
    replied: g.replied.size,
    positive: g.positive.size,
    active: g.active,
    responseRate: g.contacted.size > 0 ? Math.round((g.replied.size / g.contacted.size) * 100) : 0,
    conversionRate: g.contacted.size > 0 ? Math.round((g.positive.size / g.contacted.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive || b.sent - a.sent);

  // Shared "now" anchor — used by the spark14d helpers below AND the 30-day
  // trend block further down. Hoisting it here also dodges the TDZ crash
  // where the original spark14d arrow function referenced `today` before
  // it was declared in the 30d-trend section (Fran caught the resulting
  // 500 on 2026-05-26).
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // ── Per-entity sparklines (last 14d, for inline use in tables) ─────────
  // 14 instead of 30 keeps the rendered SVG narrow enough to fit beside
  // numbers without crowding the row. Stripe/Linear use the same pattern.
  const spark14d = (entries: { at: string | null | undefined }[]): number[] => {
    const buckets = new Array(14).fill(0) as number[];
    for (const e of entries) {
      if (!e.at) continue;
      const idx = 13 - Math.floor((today.getTime() - new Date(e.at).getTime()) / 86_400_000);
      if (idx >= 0 && idx < 14) buckets[idx]++;
    }
    return buckets;
  };
  const sparkByCampaign = new Map<string, number[]>();
  for (const c of campaigns) {
    const msgsForC = messages.filter(m => m.campaign_id === c.id).map(m => ({ at: m.sent_at }));
    const existing = sparkByCampaign.get(c.name) ?? new Array(14).fill(0);
    const next = spark14d(msgsForC);
    for (let i = 0; i < 14; i++) existing[i] += next[i];
    sparkByCampaign.set(c.name, existing);
  }
  const sparkByIcp = new Map<string, number[]>();
  for (const l of leads) {
    const id = l.icp_profile_id ?? "_unknown";
    if (!sparkByIcp.has(id)) sparkByIcp.set(id, new Array(14).fill(0));
  }
  for (const r of replies) {
    if (!r.lead_id) continue;
    const l = leads.find(x => x.id === r.lead_id);
    if (!l) continue;
    const id = l.icp_profile_id ?? "_unknown";
    const arr = sparkByIcp.get(id);
    if (!arr || !r.received_at) continue;
    const idx = 13 - Math.floor((today.getTime() - new Date(r.received_at).getTime()) / 86_400_000);
    if (idx >= 0 && idx < 14) arr[idx]++;
  }
  const sparkBySeller = new Map<string, number[]>();
  for (const c of campaigns) {
    if (!c.seller_id) continue;
    const msgsForC = messages.filter(m => m.campaign_id === c.id).map(m => ({ at: m.sent_at }));
    const existing = sparkBySeller.get(c.seller_id) ?? new Array(14).fill(0);
    const next = spark14d(msgsForC);
    for (let i = 0; i < 14; i++) existing[i] += next[i];
    sparkBySeller.set(c.seller_id, existing);
  }

  // ── Activity heatmap — day-of-week × hour-of-day ───────────────────────
  // Sundays (0) → Saturday (6); 0–23 hour bands. Same data Mixpanel /
  // Amplitude show as a heatmap — answers "when do leads actually reply?".
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const r of replies) {
    if (!r.received_at) continue;
    const d = new Date(r.received_at);
    heatmap[d.getDay()][d.getHours()]++;
  }

  // ── Time-to-first-reply (median minutes) ────────────────────────────────
  // For every lead that replied, how many minutes elapsed between the lead's
  // FIRST sent campaign_message and the lead's FIRST reply? Median is more
  // useful than mean because a handful of slow replies skew the average.
  const firstMsgAt = new Map<string, number>();
  for (const m of messages) {
    if (!m.sent_at || !m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c?.lead_id) continue;
    const t = new Date(m.sent_at).getTime();
    const prev = firstMsgAt.get(c.lead_id);
    if (prev === undefined || t < prev) firstMsgAt.set(c.lead_id, t);
  }
  const firstReplyAt = new Map<string, number>();
  for (const r of replies) {
    if (!r.lead_id || !r.received_at) continue;
    const t = new Date(r.received_at).getTime();
    const prev = firstReplyAt.get(r.lead_id);
    if (prev === undefined || t < prev) firstReplyAt.set(r.lead_id, t);
  }
  const timesToReply: number[] = [];
  for (const [leadId, msgT] of firstMsgAt.entries()) {
    const replyT = firstReplyAt.get(leadId);
    if (replyT && replyT > msgT) timesToReply.push(Math.round((replyT - msgT) / 60_000));
  }
  timesToReply.sort((a, b) => a - b);
  const medianTimeToReply = timesToReply.length > 0
    ? timesToReply[Math.floor(timesToReply.length / 2)]
    : null;

  // ── Pipeline velocity ──────────────────────────────────────────────────
  // Industry formula: (deals × avg deal size × win rate) / sales cycle days.
  // We don't have deal size on the CRM yet, so we expose the COMPONENTS the
  // seller can reason about + a velocity-of-positive-replies-per-day proxy.
  const periodDays = Math.max(1, Math.round((toMs ?? Date.now()) - (fromMs ?? Date.now() - 30 * 86_400_000)) / 86_400_000);
  const velocityPerDay = positiveCount / periodDays;
  const winRate = contactedLeads > 0 ? Math.round((wonCount / contactedLeads) * 100) : 0;

  // ── Daily trend (period-aware) ─────────────────────────────────────────
  // Buckets each metric by day. The trend used to be hardcoded at 30
  // buckets ending today — fine for the default "last 30 days" view but
  // wrong any time the user picked a different period. Now the trend
  // tracks the *active period filter*:
  //   - Bucket count = number of days in the period (clamped 7..180 so
  //     we don't blow up the chart for "all time" or shrink it useless
  //     for very tight ranges).
  //   - Anchor = period end (toMs). When no period is set, end = today.
  // Kept as `trend30d` for backwards-compat with detail page consumers;
  // the name is a historical artifact, the length is now dynamic.
  const trendEndMs = toMs ?? Date.now();
  const trendStartMsRaw = fromMs ?? (trendEndMs - 30 * 86_400_000);
  const rawDays = Math.round((trendEndMs - trendStartMsRaw) / 86_400_000);
  const trendDays = Math.max(7, Math.min(180, rawDays || 30));
  const trendSent: number[] = new Array(trendDays).fill(0);
  const trendReplies: number[] = new Array(trendDays).fill(0);
  const trendPositive: number[] = new Array(trendDays).fill(0);
  const trendBucket = (iso: string): number => {
    const tMs = new Date(iso).getTime();
    return trendDays - 1 - Math.floor((trendEndMs - tMs) / 86_400_000);
  };
  for (const m of messages) {
    if (!m.sent_at) continue;
    const idx = trendBucket(m.sent_at);
    if (idx >= 0 && idx < trendDays) trendSent[idx]++;
  }
  for (const r of replies) {
    if (!r.received_at) continue;
    const idx = trendBucket(r.received_at);
    if (idx >= 0 && idx < trendDays) {
      trendReplies[idx]++;
      if (POSITIVE_CLASS.has(r.classification ?? "")) trendPositive[idx]++;
    }
  }
  const trend30d = { sent: trendSent, replies: trendReplies, positive: trendPositive };

  // ── Prior-period deltas (same window, immediately before) ──────────────
  const periodMs = (fromMs !== null && toMs !== null)
    ? toMs - fromMs
    : 30 * 86_400_000;
  const priorTo = fromMs !== null ? fromMs : (Date.now() - 30 * 86_400_000);
  const priorFrom = priorTo - periodMs;
  const priorReplies = allReplies.filter(r => {
    if (!r.received_at) return false;
    const t = new Date(r.received_at).getTime();
    return t >= priorFrom && t < priorTo;
  });

  // ── Prior-period trend (ghost line on the 30-day chart) ────────────────
  // Same shape and length as trend30d, but anchored at priorTo (= the
  // period's `from`) and walking backwards trendDays days. Lets the
  // chart overlay the previous period as a dashed reference line.
  const priorTrendSent: number[] = new Array(trendDays).fill(0);
  const priorTrendReplies: number[] = new Array(trendDays).fill(0);
  const priorTrendPositive: number[] = new Array(trendDays).fill(0);
  const priorTrendBucket = (iso: string): number => {
    const tMs = new Date(iso).getTime();
    return trendDays - 1 - Math.floor((priorTo - tMs) / 86_400_000);
  };
  for (const m of allMessages) {
    if (m.status !== "sent" || !m.sent_at) continue;
    const tMs = new Date(m.sent_at).getTime();
    if (tMs < priorFrom || tMs >= priorTo) continue;
    const idx = priorTrendBucket(m.sent_at);
    if (idx >= 0 && idx < trendDays) priorTrendSent[idx]++;
  }
  for (const r of priorReplies) {
    if (!r.received_at) continue;
    const idx = priorTrendBucket(r.received_at);
    if (idx >= 0 && idx < trendDays) {
      priorTrendReplies[idx]++;
      if (POSITIVE_CLASS.has(r.classification ?? "")) priorTrendPositive[idx]++;
    }
  }
  const trendPrior = { sent: priorTrendSent, replies: priorTrendReplies, positive: priorTrendPositive };
  const priorContactedLeads = new Set(
    allCampaigns
      .filter(c => c.created_at && new Date(c.created_at).getTime() >= priorFrom && new Date(c.created_at).getTime() < priorTo)
      .map(c => c.lead_id)
      .filter(Boolean) as string[],
  ).size;
  const priorRepliedSize = new Set(priorReplies.map(r => r.lead_id).filter(Boolean) as string[]).size;
  const priorPositiveSize = new Set(priorReplies.filter(r => POSITIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]).size;

  const deltas = {
    contacted: pctDelta(contactedLeads, priorContactedLeads),
    replied:   pctDelta(repliedCount, priorRepliedSize),
    positive:  pctDelta(positiveCount, priorPositiveSize),
  };

  // ── Prior-period funnel — for the comparative overlay on the main Funnel.
  // Computes the same 7 stages but for the period immediately preceding the
  // current one. Allows the funnel to render "ghost bars" behind each
  // current stage so the operator sees where the period got better/worse.
  const priorCampaigns = allCampaigns.filter(c => c.created_at && new Date(c.created_at).getTime() >= priorFrom && new Date(c.created_at).getTime() < priorTo);
  const priorContactedLeadIds = new Set(priorCampaigns.map(c => c.lead_id).filter(Boolean) as string[]);
  const priorRepliedLeadIds = new Set(priorReplies.map(r => r.lead_id).filter(Boolean) as string[]);
  const priorPositiveLeadIds = new Set(priorReplies.filter(r => POSITIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]);
  const priorConnectedLeadIds = new Set<string>();
  for (const m of allMessages) {
    if (m.status !== "sent" || !m.sent_at || !m.campaign_id) continue;
    const t = new Date(m.sent_at).getTime();
    if (t < priorFrom || t >= priorTo) continue;
    if ((m.step_number ?? 0) < 1) continue;
    const c = priorCampaigns.find(x => x.id === m.campaign_id);
    if (c?.lead_id) priorConnectedLeadIds.add(c.lead_id);
  }
  for (const c of priorCampaigns) if ((c.current_step ?? 0) >= 1 && c.lead_id) priorConnectedLeadIds.add(c.lead_id);
  // Imported in prior window = leads created in prior window.
  const priorImported = allLeads.filter(l => l.created_at && new Date(l.created_at).getTime() >= priorFrom && new Date(l.created_at).getTime() < priorTo).length;
  // "Meeting" + "Won" are status-based and don't have a created_at on the status change,
  // so we omit them from the prior funnel comparison (the comparison would be misleading).
  const priorFunnel = {
    imported: priorImported,
    contacted: priorContactedLeadIds.size,
    connected: priorConnectedLeadIds.size,
    replied: priorRepliedLeadIds.size,
    positive: priorPositiveLeadIds.size,
  };

  // ── Reply velocity decay curve ─────────────────────────────────────────
  // For every lead that received at least one message, did they reply, and
  // if so, on what day relative to their FIRST sent message? Result is a
  // cumulative curve from day 0 to day 30 showing what % of all leads have
  // replied by day D. Two operational uses:
  //   1) See the day at which the curve plateaus — past that, sending more
  //      messages mostly burns inboxes without yielding new replies.
  //   2) Pin a stop-sending policy at, e.g., the day the curve hits 95% of
  //      its final value.
  // Uses ALL-TIME data (not the filtered window) because the decay shape
  // is a structural property of the messaging program, not a function of
  // any specific period.
  const firstMsgAtAll = new Map<string, number>();
  for (const m of allMessages) {
    if (m.status !== "sent" || !m.sent_at || !m.campaign_id) continue;
    const c = allCampaigns.find(x => x.id === m.campaign_id);
    if (!c?.lead_id) continue;
    const t = new Date(m.sent_at).getTime();
    const prev = firstMsgAtAll.get(c.lead_id);
    if (prev === undefined || t < prev) firstMsgAtAll.set(c.lead_id, t);
  }
  const firstReplyAtAll = new Map<string, number>();
  for (const r of allReplies) {
    if (!r.lead_id || !r.received_at) continue;
    const t = new Date(r.received_at).getTime();
    const prev = firstReplyAtAll.get(r.lead_id);
    if (prev === undefined || t < prev) firstReplyAtAll.set(r.lead_id, t);
  }
  const daysToReplyList: number[] = [];
  for (const [leadId, msgT] of firstMsgAtAll) {
    const replyT = firstReplyAtAll.get(leadId);
    if (replyT && replyT > msgT) {
      daysToReplyList.push(Math.floor((replyT - msgT) / 86_400_000));
    }
  }
  daysToReplyList.sort((a, b) => a - b);
  const totalMessaged = firstMsgAtAll.size;
  const decayCurve = new Array(31).fill(0) as number[];
  if (totalMessaged > 0) {
    let cursor = 0;
    for (let d = 0; d <= 30; d++) {
      while (cursor < daysToReplyList.length && daysToReplyList[cursor] <= d) cursor++;
      decayCurve[d] = (cursor / totalMessaged) * 100;
    }
  }
  // Find the day at which the curve has captured 95% of its final value —
  // that's the operational "cutoff" suggestion.
  const finalPct = decayCurve[30];
  let cutoffDay: number | null = null;
  if (finalPct > 0.5 && totalMessaged >= 30) {
    for (let d = 0; d <= 30; d++) {
      if (decayCurve[d] >= finalPct * 0.95) { cutoffDay = d; break; }
    }
  }
  const velocityDecay = {
    curve: decayCurve.map(v => Math.round(v * 10) / 10),
    totalMessaged,
    cutoffDay,
    finalPct: Math.round(finalPct * 10) / 10,
  };

  // ── Reply classification breakdown (donut data) ─────────────────────────
  // Seed positive/meeting_intent at 0 so the donut/legend always shows
  // them — boss-feedback 2026-05-27: "positives debería aparecer aunque
  // sean 0". The render layer relies on these keys being present.
  const replyClassCounts: Record<string, number> = { positive: 0, meeting_intent: 0 };
  for (const r of replies) {
    const k = r.classification ?? "unclassified";
    replyClassCounts[k] = (replyClassCounts[k] ?? 0) + 1;
  }

  // ── Auto insights ───────────────────────────────────────────────────────
  // Insights are returned as STRUCTURED objects (kind + vars) instead of
  // pre-formatted strings. The UI layer translates them via i18n. This
  // separation lets the same data layer serve EN and ES without duplicate
  // string templates in two places. The legacy `text` field is kept as a
  // best-effort English render for any caller still expecting a string,
  // but the dashboard reads `kind` + `vars` and looks up the locale copy.
  type Insight = {
    tone: "positive" | "warning" | "neutral";
    /** Stable identifier for the locale lookup ("insight.positivesUp" → translated template). */
    kind: string;
    /** Placeholder values substituted into the translated template. */
    vars: Record<string, string | number>;
    /** Legacy English fallback so existing string consumers don't blow up. */
    text: string;
  };
  const insights: Insight[] = [];
  if (deltas.positive !== null && deltas.positive >= 15) {
    insights.push({
      tone: "positive",
      kind: "positivesUp",
      vars: { n: deltas.positive },
      text: `Positive replies ↑${deltas.positive}% vs prior period — the flow is gaining traction.`,
    });
  } else if (deltas.positive !== null && deltas.positive <= -15) {
    insights.push({
      tone: "warning",
      kind: "positivesDown",
      vars: { n: Math.abs(deltas.positive) },
      text: `Positive replies ↓${Math.abs(deltas.positive)}% vs prior period — check what cooled off.`,
    });
  }
  if (channelBreakdown.length >= 2) {
    const best = channelBreakdown[0];
    const worst = channelBreakdown[channelBreakdown.length - 1];
    const gap = best.responseRate - worst.responseRate;
    if (gap >= 15) insights.push({
      tone: "neutral",
      kind: "channelGap",
      vars: { best: best.channel, worst: worst.channel, gap },
      text: `${best.channel} replies ${gap}pp better than ${worst.channel} — consider rebalancing the mix.`,
    });
  }
  if (sellerPerformance.length >= 2 && sellerPerformance[0].positive >= sellerPerformance[1].positive + 3) {
    const lead = sellerPerformance[0].positive - sellerPerformance[1].positive;
    insights.push({
      tone: "positive",
      kind: "topSeller",
      vars: { name: sellerPerformance[0].name, n: sellerPerformance[0].positive, lead },
      text: `${sellerPerformance[0].name} leads with ${sellerPerformance[0].positive} positives (+${lead} over #2).`,
    });
  }
  const stagnant = campaignPerformance.filter(c => c.leads >= 10 && c.conversionRate === 0 && c.status === "active");
  if (stagnant.length > 0) {
    insights.push({
      tone: "warning",
      kind: stagnant.length === 1 ? "stagnantSingle" : "stagnantMany",
      vars: { n: stagnant.length },
      text: `${stagnant.length} campaign${stagnant.length === 1 ? "" : "s"} with 0% conversion and ≥10 leads — review or pause.`,
    });
  }

  return {
    period: { from: filters.from, to: filters.to, days: Math.round(periodMs / 86_400_000) },
    headline: {
      totalLeads, contactedLeads, connectedLeads,
      repliedCount, positiveCount, negativeCount, meetingCount, wonCount,
      responseRate, positiveRate, conversionRate, acceptanceRate,
    },
    deltas,
    // Funnel — boss feedback 2026-05-27 round 3 ("too many bars, pongamos
    // lo más importante"). Trimmed from 9 to 5 stages: the classic journey
    // an operator scans (Imported → Contactados → LinkedIn Accepted →
    // Respondieron → Ganados). Per-channel touch breakdowns live in the
    // Channels tab as separate cards now.
    funnel: [
      { stage: "imported",          count: totalLeads,     prior: priorFunnel.imported,  color: "neutral" },
      { stage: "contacted",         count: contactedLeads, prior: priorFunnel.contacted, color: "info" },
      { stage: "linkedin_accepted", count: connectedLeads, prior: priorFunnel.connected, color: "info" },
      { stage: "replied",           count: repliedCount,   prior: priorFunnel.replied,   color: "warning" },
      { stage: "won",               count: wonCount,       prior: null as number | null, color: "brand" },
    ],
    channelBreakdown,
    callsBreakdown,
    // Exposed even after the funnel trim, so the LinkedIn Connections
    // card on the Channels tab can keep showing Sent → Accepted → rate
    // (those stages disappeared from the funnel proper).
    linkedinConnections: { sent: linkedinSentCount, accepted: connectedLeads },
    icpPerformance: icpPerformance.map(p => ({ ...p, spark: sparkByIcp.get(p.id) ?? new Array(14).fill(0) })),
    campaignPerformance: campaignPerformance.map(c => ({ ...c, spark: sparkByCampaign.get(c.name) ?? new Array(14).fill(0) })),
    sellerPerformance: sellerPerformance.map(s => ({ ...s, spark: sparkBySeller.get(s.id) ?? new Array(14).fill(0) })),
    trend30d,
    trendPrior,
    replyClassCounts,
    insights: insights.slice(0, 4),
    activeCampaignCount: campaigns.filter(c => c.status === "active").length,
    pausedCampaignCount: campaigns.filter(c => c.status === "paused").length,
    completedCampaignCount: campaigns.filter(c => c.status === "completed").length,
    // Lead-state cohort counts (boss-feedback 2026-05-27).
    // - leadsInActiveCampaigns: of the period's leads, how many currently
    //   sit inside at least one active or paused campaign? Uses *all*
    //   campaigns (not period-filtered) because campaign activity is
    //   stateful, not period-bound.
    // - leadsWithoutCampaign: of the period's leads, how many have zero
    //   campaigns at all (regardless of status). Tells the operator how
    //   much of the bucket is untouched.
    leadsInActiveCampaigns: (() => {
      const activeIds = new Set<string>();
      for (const c of allCampaigns) {
        if (!c.lead_id) continue;
        if (c.status === "active" || c.status === "paused") activeIds.add(c.lead_id);
      }
      return leads.filter(l => activeIds.has(l.id)).length;
    })(),
    leadsWithoutCampaign: (() => {
      const withCampaign = new Set<string>();
      for (const c of allCampaigns) {
        if (c.lead_id) withCampaign.add(c.lead_id);
      }
      return leads.filter(l => !withCampaign.has(l.id)).length;
    })(),
    // Actionable lead lists for the "What to do today" hero. Capped at 8
    // each so the expanded panels stay scannable; full lists live on the
    // deep-linked views. Uses non-encrypted company_name only (no
    // decryption needed). Calls list intentionally omitted in this commit
    // — re-introduced separately once the calls fetch is stabilized.
    todayLists: (() => {
      const leadById = new Map(leads.map(l => [l.id, l]));
      const profileById = new Map(allProfiles.map(p => [p.id, p.profile_name]));
      type TodayLead = { id: string; company: string; icp: string | null; when: string | null; tag: string | null };
      const summarize = (leadId: string, extra: { when?: string | null; tag?: string | null } = {}): TodayLead | null => {
        const l = leadById.get(leadId);
        if (!l) return null;
        return {
          id: l.id,
          company: l.company_name ?? "—",
          icp: l.icp_profile_id ? (profileById.get(l.icp_profile_id) ?? null) : null,
          when: extra.when ?? l.created_at ?? null,
          tag: extra.tag ?? null,
        };
      };
      const repliesSorted = [...replies]
        .filter(r => r.lead_id && repliedLeadIds.has(r.lead_id))
        .sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
      const repliesList: TodayLead[] = [];
      const seenReplied = new Set<string>();
      for (const r of repliesSorted) {
        if (!r.lead_id || seenReplied.has(r.lead_id)) continue;
        seenReplied.add(r.lead_id);
        const s = summarize(r.lead_id, { when: r.received_at, tag: r.classification });
        if (s) repliesList.push(s);
        if (repliesList.length >= 8) break;
      }
      const positivesList: TodayLead[] = [];
      const seenPos = new Set<string>();
      for (const r of repliesSorted) {
        if (!r.lead_id || !POSITIVE_CLASS.has(r.classification ?? "")) continue;
        if (seenPos.has(r.lead_id)) continue;
        seenPos.add(r.lead_id);
        const s = summarize(r.lead_id, { when: r.received_at, tag: r.classification });
        if (s) positivesList.push(s);
        if (positivesList.length >= 8) break;
      }
      const withCampaignSet = new Set<string>();
      for (const c of allCampaigns) if (c.lead_id) withCampaignSet.add(c.lead_id);
      const unassignedList: TodayLead[] = leads
        .filter(l => !withCampaignSet.has(l.id))
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 8)
        .map(l => summarize(l.id))
        .filter((x): x is TodayLead => x !== null);
      return {
        replies: repliesList,
        positives: positivesList,
        calls: [] as TodayLead[],
        unassigned: unassignedList,
      };
    })(),
    velocity: {
      perDay: Math.round(velocityPerDay * 10) / 10,
      winRate,
      medianTimeToReplyMin: medianTimeToReply,
      acceptanceRate,
      // Forecast positives for the rest of the month at current velocity.
      forecastMonthEnd: (() => {
        const now = new Date();
        const remainingDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
        return Math.round(velocityPerDay * remainingDays);
      })(),
    },
    matrix: {
      icps: orderedIcps,
      channels: orderedChannels,
      cells: matrixCells,
      mean: matrixMean,
      stddev: matrixStddev,
    },
    stepPerformance,
    velocityDecay,
    health: {
      /** % of campaigns that finished their sequence with 0 replies. null when <5 evaluated. */
      saturationRate,
      /** Absolute count of saturated campaigns (sequences finished, 0 replies). */
      saturatedCount,
      /** Campaigns paused OR active without any send in the last 7 days. */
      atRiskCount,
      /** % of replies that arrived on a channel different from the campaign's. null when <10 evaluated. */
      channelMismatchRate,
      /** Absolute count of mismatched-channel replies. */
      mismatchCount,
    },
    heatmap, // [7][24] — Sun..Sat × 0..23h
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
