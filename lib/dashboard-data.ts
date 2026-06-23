// Shared metrics layer for the new Dashboard + drill-downs + the PDF export.
// Pre-2026-05-26 these computations lived inline in /reports/page.tsx. Moving
// them here lets the new top-level Dashboard, the per-campaign / per-icp /
// per-seller drill-downs and the print page all derive from the same numbers
// (so what you see matches what you export).

import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

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
  primary_first_name?: string | null;
  primary_last_name?: string | null;
  primary_phone?: string | null;
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
  requires_human_review: boolean | null;
  review_status: string | null;
};
type MsgRow = {
  id: string;
  campaign_id: string | null;
  step_number: number | null;
  status: string | null;
  sent_at: string | null;
  /** The message's OWN channel (dispatcher-stamped). Authoritative for
   * per-channel attribution — a campaign.channel='linkedin' multichannel flow
   * still stamps email/call on those steps' messages. */
  channel: string | null;
};

const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);
// "not_now" (bad timing) is a follow-up, NOT a negative/lost outcome — excluded.
const NEGATIVE_CLASS = new Set(["negative", "unsubscribe"]);

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
  callsBreakdown: { pending: 0, made: 0, completed: 0, answered: 0, positive: 0, negative: 0, total: 0 },
  callOutcomesBySeller: [] as Array<{ sellerId: string; sellerName: string; made: number; answered: number; interested: number; badTiming: number; voicemail: number; notInterested: number; wrongNumber: number; byDay: Record<string, { made: number; answered: number; interested: number; badTiming: number; voicemail: number; notInterested: number; wrongNumber: number }> }>,
  linkedinConnections: { sent: 0, accepted: 0 },
  icpPerformance: [] as Array<any>,
  campaignPerformance: [] as Array<any>,
  sellerPerformance: [] as Array<any>,
  trend30d: { sent: new Array(30).fill(0) as number[], replies: new Array(30).fill(0) as number[], positive: new Array(30).fill(0) as number[] },
  trendPrior: { sent: new Array(30).fill(0) as number[], replies: new Array(30).fill(0) as number[], positive: new Array(30).fill(0) as number[] },
  replyClassCounts: { positive: 0, meeting_intent: 0 } as Record<string, number>,
  replyClassCountsPrior: {} as Record<string, number>,
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
    stale: [] as Array<{ id: string; company: string; icp: string | null; when: string | null; tag: string | null }>,
    counts: { replies: 0, positives: 0, calls: 0, unassigned: 0, stale: 0 },
  },
  velocity: { perDay: 0, winRate: 0, medianTimeToReplyMin: null as number | null, acceptanceRate: 0, forecastMonthEnd: 0 },
  matrix: { icps: [] as Array<{ id: string; name: string; totalLeads: number }>, channels: [] as string[], cells: [] as Array<any>, mean: 0, stddev: 0 },
  stepPerformance: [] as Array<any>,
  stepPerformanceByFlow: {} as Record<string, Array<any>>,
  velocityDecay: { points: [] as Array<any>, cutoffDay: null as number | null, finalPct: 0 },
  health: {} as Record<string, unknown>,
  heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]),
  heatmapByChannel: {
    all: Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]),
    linkedin: Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]),
    email: Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]),
    call: Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]),
  } as Record<string, number[][]>,
};

// Pages through a PostgREST query 1000 rows at a time until the tail is
// short. `makeQuery` MUST return a fresh builder each call — .range()
// configures a builder in place, so a reused builder would only ever
// fetch one page. On error we log and return what we gathered so far,
// matching the prior "degrade this source to empty, keep the dashboard
// alive" behaviour (one bad source must not blank every tab).
async function fetchAllRows<T = Record<string, unknown>>(
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }> },
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) {
      console.warn("[dashboard-data] paginated fetch error — degrading source to partial:", error);
      break;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

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

  // primary_first_name/last_name/phone surface in TodayCard rows (boss
  // 2026-05-29 asked for name + dial in Replies/Calls). Also `source` +
  // `encrypted_payload` so we can decrypt client-uploaded leads below —
  // without that pass the plain columns are NULL for tenants like De Vera
  // Grill / Pathway client-source, and the Today rows fall back to ICP.
  // PostgREST caps every response at 1000 rows by default. The dashboard
  // aggregates the ENTIRE workspace (SWL alone has >1.2k leads and >3k
  // messages), so an un-paginated fetch silently truncated every headline:
  // "TOTAL LEADS" froze at exactly 1000, "Leads to assign"/"Stale" were
  // wrong, and numbers disagreed across tabs. fetchAllRows pages through
  // .range() until the tail is short, so every derived figure is real.
  // Each source uses a query FACTORY (fresh builder per page) because
  // .range() can only be applied to a builder once.
  const makeLeadsQ = () => {
    const q = supabase.from("leads").select("id, status, lead_score, is_priority, icp_profile_id, created_at, company_bio_id, company_name, primary_first_name, primary_last_name, primary_phone, source, encrypted_payload");
    return bioId ? q.eq("company_bio_id", bioId) : q;
  };
  const makeCampsQ = () => {
    const q = supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, created_at, stop_reason, leads!inner(company_bio_id)");
    return bioId ? q.eq("leads.company_bio_id", bioId) : q;
  };
  const makeRepliesQ = () => {
    const q = supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at, requires_human_review, review_status, leads!inner(company_bio_id)");
    return bioId ? q.eq("leads.company_bio_id", bioId) : q;
  };
  const makeMsgsQ = () => {
    const q = supabase.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, channel, campaigns!inner(leads!inner(company_bio_id))");
    return bioId ? q.eq("campaigns.leads.company_bio_id", bioId) : q;
  };
  const makeProfilesQ = () => {
    const q = supabase.from("icp_profiles").select("id, profile_name, company_bio_id").eq("status", "approved");
    return bioId ? q.eq("company_bio_id", bioId) : q;
  };
  const makeSellersQ = () => {
    const q = supabase.from("sellers").select("id, name, active, company_bio_id, user_id");
    return bioId ? q.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`) : q;
  };

  const [
    allLeadsRaw,
    allCampsRaw,
    allRepliesRaw,
    allMsgsRaw,
    allProfilesRaw,
    allSellersRaw,
  ] = await Promise.all([
    fetchAllRows(makeLeadsQ),
    fetchAllRows(makeCampsQ),
    fetchAllRows(makeRepliesQ),
    fetchAllRows(makeMsgsQ),
    fetchAllRows(makeProfilesQ),
    fetchAllRows(makeSellersQ),
  ]);

  const allLeadsRawTyped = (allLeadsRaw ?? []) as Array<LeadRow & { source?: string | null; encrypted_payload?: unknown }>;

  // Client-source leads keep PII in `encrypted_payload`; the plain
  // `primary_first_name` / `primary_last_name` / `primary_phone` columns
  // are NULL on those rows. The dashboard surfaces names in the Today
  // card (Replies / Calls rows asked for by boss 2026-05-29), so without
  // this decrypt pass De Vera Grill / Pathway client-source tenants saw
  // ICP labels where the lead's name should be. Same pattern as
  // /leads/page.tsx — resolve the tenant key once, decrypt every
  // client-source row, merge.
  const allLeads: LeadRow[] = await (async () => {
    if (!bioId || allLeadsRawTyped.length === 0) return allLeadsRawTyped as LeadRow[];
    const hasClient = allLeadsRawTyped.some(l => l.source === "client" && l.encrypted_payload);
    if (!hasClient) return allLeadsRawTyped as LeadRow[];
    try {
      const { key } = await resolveTenantKey(bioId);
      return allLeadsRawTyped.map(l => {
        if (l.source !== "client" || !l.encrypted_payload) return l as LeadRow;
        try {
          const blob = bufferFromSupabaseBytea(l.encrypted_payload);
          const decrypted = decryptWithResolvedKey(blob, key);
          return { ...l, ...decrypted, encrypted_payload: undefined } as LeadRow;
        } catch (err) {
          console.error("[dashboard-data] decrypt failed for lead", l.id, err);
          return l as LeadRow;
        }
      });
    } catch (err) {
      console.error("[dashboard-data] tenant key resolution failed", err);
      return allLeadsRawTyped as LeadRow[];
    }
  })();
  const allCampaigns = (allCampsRaw ?? []) as CampRow[];
  const allReplies = (allRepliesRaw ?? []) as ReplyRow[];
  const allMessages = (allMsgsRaw ?? []) as MsgRow[];
  const allProfiles = (allProfilesRaw ?? []) as { id: string; profile_name: string }[];
  const allSellers = (allSellersRaw ?? []) as { id: string; name: string; active: boolean; user_id: string | null }[];

  // Calls — fetched separately so any failure (RLS / missing column /
  // FK metadata mismatch) doesn't bring the whole dashboard down. Scopes
  // through the `leads!inner(company_bio_id)` embed instead of a
  // `lead_id=in.(…)` filter.
  //
  // The old `.in("lead_id", cappedLeadIds)` approach broke silently for any
  // large tenant: SWL has 1264 leads, so the generated PostgREST URL was
  // ~47 KB of comma-joined UUIDs → the server rejected it with HTTP 400 →
  // the catch below swallowed it → `allCalls = []` → the "Calls by user"
  // panel rendered "No calls yet" even though 361 SWL calls existed. The
  // embed join is bio-scoped server-side, so the URL stays tiny regardless
  // of lead count (verified 2026-06-10).
  type CallRow = {
    id: string; lead_id: string | null; status: string | null;
    duration: number | null; classification: string | null; started_at: string | null;
    dialed_by_user_id: string | null; phone_number: string | null;
  };
  let allCalls: CallRow[] = [];
  try {
    const makeCallsQ = () => {
      const q = supabase
        .from("calls")
        .select("id, lead_id, status, duration, classification, started_at, dialed_by_user_id, phone_number, leads!inner(company_bio_id)");
      return bioId ? q.eq("leads.company_bio_id", bioId) : q;
    };
    allCalls = await fetchAllRows<CallRow>(makeCallsQ);
    console.log(`[dashboard-data] loaded ${allCalls.length} calls (bio: ${bioId ?? "all"})`);
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
  // Per-channel attribution uses the MESSAGE's own channel, not the
  // campaign's. A multichannel flow is stored as campaign.channel='linkedin'
  // but each step's sent message carries its real channel (email/call/...),
  // so keying off campaign.channel made every email/call touch vanish into
  // "linkedin" — the ICP × Channel matrix and the per-ICP channel columns
  // both showed 0 emails/calls (boss 2026-06-08). `touchByChannel` is reused
  // by the matrix below so the two ICP views agree.
  const touchByChannel = new Map<string, Set<string>>();
  const linkedinMessageLeadIds = new Set<string>();
  const campaignChannelById = new Map<string, string>();
  const campaignLeadById = new Map<string, string>();
  for (const c of campaigns) {
    if (c.channel) campaignChannelById.set(c.id, c.channel);
    if (c.lead_id) campaignLeadById.set(c.id, c.lead_id);
  }
  for (const m of messages) {
    if (m.status !== "sent" || !m.campaign_id) continue;
    const leadId = campaignLeadById.get(m.campaign_id);
    if (!leadId) continue;
    const ch = (m.channel || campaignChannelById.get(m.campaign_id) || "linkedin");
    let set = touchByChannel.get(ch);
    if (!set) { set = new Set(); touchByChannel.set(ch, set); }
    set.add(leadId);
    if (ch === "linkedin" && (m.step_number ?? 0) >= 1) linkedinMessageLeadIds.add(leadId);
  }
  const linkedinSentLeadIds = touchByChannel.get("linkedin") ?? new Set<string>();
  const emailTouchLeadIds = touchByChannel.get("email") ?? new Set<string>();
  const callTouchLeadIds = touchByChannel.get("call") ?? new Set<string>();

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
  // Uses m.channel (message-level) not c.channel (campaign-level). Multi-channel
  // flows are stored as campaign.channel='linkedin' but each step carries its real
  // channel stamp — keying off campaign.channel made every email/call vanish into
  // "linkedin" (same root cause as the ICP matrix fix in 2026-06-08).
  // touchByChannel (built above) is the single source of truth for per-channel leads.
  const sentCountByChannel = new Map<string, number>();
  const repliedByChannel = new Map<string, Set<string>>();
  const positiveByChannel = new Map<string, Set<string>>();
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const leadId = campaignLeadById.get(m.campaign_id);
    const ch = (m.channel || campaignChannelById.get(m.campaign_id) || "linkedin");
    sentCountByChannel.set(ch, (sentCountByChannel.get(ch) ?? 0) + 1);
    if (!leadId) continue;
    if (repliedLeadIds.has(leadId)) {
      let s = repliedByChannel.get(ch); if (!s) { s = new Set(); repliedByChannel.set(ch, s); } s.add(leadId);
    }
    if (positiveLeadIds.has(leadId)) {
      let s = positiveByChannel.get(ch); if (!s) { s = new Set(); positiveByChannel.set(ch, s); } s.add(leadId);
    }
  }
  // Always emit all three cards even when activity is zero.
  for (const ch of ["linkedin", "email", "call"]) {
    if (!touchByChannel.has(ch)) touchByChannel.set(ch, new Set());
  }
  const channelBreakdown = Array.from(touchByChannel.entries())
    .filter(([ch]) => ["linkedin", "email", "call"].includes(ch))
    .map(([channel, contactedSet]) => {
      const sent      = sentCountByChannel.get(channel) ?? 0;
      const replied   = repliedByChannel.get(channel)?.size ?? 0;
      const positive  = positiveByChannel.get(channel)?.size ?? 0;
      const contacted = contactedSet.size;
      return {
        channel, sent, contacted, replied, positive,
        responseRate:  contacted > 0 ? Math.round((replied  / contacted) * 100) : 0,
        conversionRate: contacted > 0 ? Math.round((positive / contacted) * 100) : 0,
      };
    }).sort((a, b) => b.responseRate - a.responseRate);

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
  console.log(`[dashboard-data] filtered to ${callsInPeriod.length} calls in period (from: ${filters.from}, to: ${filters.to})`);
  // "Made" = one row per physical dial. Each call can surface as up to TWO
  // rows — a dial-marker (status 'initiated', no aircall_call_id) plus an
  // Aircall webhook record once it connects (status 'answered'…). Collapse by
  // lead + minute so we count each call once. The old `completed` field keyed
  // off status === 'completed', which the calls table NEVER emits (real
  // statuses: answered / initiated / missed / voicemail) → it was always 0,
  // which is why "Phones made" read 0 for Graeme/Pathway (boss 2026-06-08).
  const madeKeys = new Set<string>();
  for (const c of callsInPeriod) {
    const minute = (c.started_at ?? "").slice(0, 16); // yyyy-mm-ddThh:mm
    // Use phone suffix when available to deduplicate across phone-format variants
    // (e.g. "+54 9 261..." vs "+54 261...") that land as separate rows.
    const phoneSfx = (c.phone_number ?? "").replace(/\D/g, "").slice(-9);
    const key = phoneSfx.length >= 7 ? `phone:${phoneSfx}|${minute}` : `${c.lead_id ?? "?"}|${minute}`;
    madeKeys.add(key);
  }
  const callsMadeCount = madeKeys.size;
  const callsBreakdown = {
    pending: (() => {
      let n = 0;
      for (const m of allMessages) {
        if (m.status !== "queued" && m.status !== "pending") continue;
        if (!m.campaign_id) continue;
        if ((m.channel ?? campaignChannelById.get(m.campaign_id)) === "call") n++;
      }
      return n;
    })(),
    made:      callsMadeCount,
    completed: callsMadeCount, // repurposed: real dials made (status 'completed' never exists)
    answered:  callsInPeriod.filter(c => (c.duration ?? 0) > 0).length,
    positive:  callsInPeriod.filter(c => POSITIVE_CLASS.has(c.classification ?? "")).length,
    negative:  callsInPeriod.filter(c => NEGATIVE_CLASS.has(c.classification ?? "")).length,
    total:     callsMadeCount,
  };

  // ── Call outcomes by seller (boss 2026-06-08) ─────────────────────────
  // Per-seller call monitoring with the outcome breakdown the boss asked for
  // (made / answered / interested / bad timing / not interested / wrong
  // number), plus a per-day drill. Attribution: a call is attributed to the
  // seller who OWNS the lead's flow (campaign.seller_id) — that's what the boss
  // means by "Graeme's calls". calls.seller_id is always null and sellers.user_id
  // is mostly unset (e.g. Graeme's is null), so dialed_by_user_id → sellers.user_id
  // is only a fallback. Each call surfaces as up to two rows (dial-marker +
  // Aircall record); collapse by lead+minute and coalesce the dialer +
  // classification across both. Respects the period + seller filters.
  const leadToSellerId = new Map<string, string>();
  for (const c of allCampaigns) {
    if (c.lead_id && c.seller_id && !leadToSellerId.has(c.lead_id)) leadToSellerId.set(c.lead_id, c.seller_id);
  }
  const userToSeller = new Map<string, { id: string; name: string }>();
  for (const s of allSellers) if (s.user_id) userToSeller.set(s.user_id, { id: s.id, name: s.name });

  // For dialers that have no seller record in this tenant (e.g. super_admin
  // dialing cross-tenant), fetch their auth identity so calls still show the
  // real caller name instead of silently falling back to the flow owner.
  const dialerIdentityMap = new Map<string, string>(); // user_id → display name
  {
    const svc = getSupabaseService();
    const unknownDialerIds = [...new Set(
      allCalls.map(c => c.dialed_by_user_id).filter((id): id is string => !!id && !userToSeller.has(id))
    )];
    for (const uid of unknownDialerIds) {
      try {
        const { data } = await svc.auth.admin.getUserById(uid);
        const meta = data?.user?.user_metadata as Record<string, unknown> | undefined;
        const name = (meta?.full_name as string | undefined)
          ?? (meta?.name as string | undefined)
          ?? data?.user?.email
          ?? uid.slice(0, 8);
        dialerIdentityMap.set(uid, name);
      } catch { dialerIdentityMap.set(uid, uid.slice(0, 8)); }
    }
  }

  type CallGroup = { leadId: string | null; dialer: string | null; classification: string | null; answered: boolean; day: string; phone: string | null };
  const callGroups = new Map<string, CallGroup>();
  for (const c of callsInPeriod) {
    const key = `${c.lead_id ?? "?"}|${(c.started_at ?? "").slice(0, 16)}`;
    const g = callGroups.get(key) ?? { leadId: c.lead_id, dialer: null, classification: null, answered: false, day: (c.started_at ?? "").slice(0, 10), phone: c.phone_number ?? null };
    if (!g.dialer && c.dialed_by_user_id) g.dialer = c.dialed_by_user_id;
    if (!g.classification && c.classification) g.classification = c.classification;
    if ((c.duration ?? 0) > 0) g.answered = true;
    if (!g.day && c.started_at) g.day = c.started_at.slice(0, 10);
    if (!g.phone && c.phone_number) g.phone = c.phone_number;
    callGroups.set(key, g);
  }
  // Secondary merge: webhook reconciliation sometimes creates an answered row for a
  // slightly different lead (e.g. Argentine mobile +54 9 2614... vs +54 261...) which
  // causes duplicate groups. Detect by phone suffix (last 9 digits) + same minute and
  // merge — coalescing dialer + answered from whichever row has them.
  {
    const getPhoneSuffix = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-9);
    const phoneMinuteIndex = new Map<string, string>(); // `${suffix}|${minute}` → group key
    const toRemove = new Set<string>();
    for (const [key, g] of callGroups) {
      const suffix = getPhoneSuffix(g.phone);
      if (suffix.length < 7) continue;
      const minute = key.split("|")[1] ?? "";
      const pmKey = `${suffix}|${minute}`;
      const existing = phoneMinuteIndex.get(pmKey);
      if (existing && existing !== key) {
        const master = callGroups.get(existing)!;
        if (!master.dialer && g.dialer) master.dialer = g.dialer;
        if (!master.phone && g.phone) master.phone = g.phone;
        if (!master.classification && g.classification) master.classification = g.classification;
        if (g.answered) master.answered = true;
        toRemove.add(key);
      } else if (!existing) {
        phoneMinuteIndex.set(pmKey, key);
      }
    }
    for (const k of toRemove) callGroups.delete(k);
  }
  type CallOutcomeCounts = { made: number; answered: number; interested: number; badTiming: number; voicemail: number; notInterested: number; wrongNumber: number };
  type SellerCallStats = CallOutcomeCounts & { sellerId: string; sellerName: string; byDay: Record<string, CallOutcomeCounts> };
  const blankCounts = (): CallOutcomeCounts => ({ made: 0, answered: 0, interested: 0, badTiming: 0, voicemail: 0, notInterested: 0, wrongNumber: 0 });
  const callSellerAgg = new Map<string, SellerCallStats>();
  for (const g of callGroups.values()) {
    // Attribution rule: if we know who clicked "Call" (dialed_by_user_id),
    // ALWAYS show that person — never fall back to the flow owner just because
    // the dialer has no seller record in this tenant. Only use the flow owner
    // when dialed_by_user_id is null (call came from outside the app or before
    // this field was tracked).
    const dialerSeller = g.dialer ? userToSeller.get(g.dialer) : null;
    const ownerSellerId = g.leadId ? leadToSellerId.get(g.leadId) : null;
    const sid   = dialerSeller?.id   ?? (g.dialer ? g.dialer                                          : (ownerSellerId ?? "unassigned"));
    const sname = dialerSeller?.name ?? (g.dialer ? (dialerIdentityMap.get(g.dialer) ?? "Unknown")   : (ownerSellerId ? sellerMap.get(ownerSellerId) : null) ?? "Unassigned");
    if (sellerSet && !sellerSet.has(sid)) continue; // seller filter (by sellers.id)
    let agg = callSellerAgg.get(sid);
    if (!agg) { agg = { sellerId: sid, sellerName: sname, ...blankCounts(), byDay: {} }; callSellerAgg.set(sid, agg); }
    const day = agg.byDay[g.day] ?? (agg.byDay[g.day] = blankCounts());
    const cl = g.classification ?? "";
    const bump = (k: keyof CallOutcomeCounts) => { agg![k]++; day[k]++; };
    bump("made");
    if (g.answered) bump("answered");
    if (cl === "positive" || cl === "meeting_intent") bump("interested");
    else if (cl === "follow_up") bump("badTiming");
    else if (cl === "voicemail") bump("voicemail");
    else if (cl === "negative") bump("notInterested");
    else if (cl === "wrong_number") bump("wrongNumber");
  }
  const callOutcomesBySeller = Array.from(callSellerAgg.values())
    .sort((a, b) => b.made - a.made || a.sellerName.localeCompare(b.sellerName));

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
  // Boss 2026-05-28: an aggregate step curve doesn't tell the operator
  // which flow's step 2 is leaking. We also build a per-flow step agg
  // (keyed by flow NAME, which is how the dashboard groups campaigns)
  // so each row in the new ICP accordion can expand to show its own
  // step performance.
  const campaignIdToFlowName = new Map<string, string>();
  for (const c of campaigns) campaignIdToFlowName.set(c.id, c.name);
  const stepAggByFlow = new Map<string, Map<number, StepAgg>>();
  const ensureFlowStep = (flow: string, n: number): StepAgg => {
    let m = stepAggByFlow.get(flow);
    if (!m) { m = new Map(); stepAggByFlow.set(flow, m); }
    let g = m.get(n);
    if (!g) { g = { sent: 0, replied: 0 }; m.set(n, g); }
    return g;
  };
  for (const m of messages) {
    if (m.status !== "sent") continue;
    const step = m.step_number ?? 0;
    ensureStep(step).sent++;
    if (m.campaign_id) {
      const flow = campaignIdToFlowName.get(m.campaign_id);
      if (flow) ensureFlowStep(flow, step).sent++;
    }
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
    if (attributedStep !== null) {
      ensureStep(attributedStep).replied++;
      const flow = campaignIdToFlowName.get(r.campaign_id);
      if (flow) ensureFlowStep(flow, attributedStep).replied++;
    }
  }

  const toStepPerf = (m: Map<number, StepAgg>) => Array.from(m.entries())
    .map(([step, g]) => ({
      step,
      sent: g.sent,
      replied: g.replied,
      // Per-flow floor stays at 5 — under 5 sends the rate is noise.
      replyRate: g.sent >= 5 ? Math.round((g.replied / g.sent) * 100) : null,
    }))
    .sort((a, b) => a.step - b.step);

  const stepPerformance = toStepPerf(stepAgg);
  const stepPerformanceByFlow: Record<string, ReturnType<typeof toStepPerf>> = {};
  for (const [flow, m] of stepAggByFlow) stepPerformanceByFlow[flow] = toStepPerf(m);

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

  // Cells bucket by the ACTUAL message channel (touchByChannel), not the
  // campaign's primary channel — so a multichannel flow's email/call sends
  // land in the right column instead of all under "linkedin".
  for (const [ch, leadSet] of touchByChannel.entries()) {
    for (const leadId of leadSet) {
      const icpId = leadIcpMap.get(leadId);
      if (!icpId) continue; // lead was filtered out
      const cell = ensureCell(keyOf(icpId, ch));
      cell.contacted.add(leadId);
      if (repliedLeadIds.has(leadId)) cell.replied.add(leadId);
    }
  }

  // ICP rows must match the "ICP Comparison" leaderboard exactly (boss
  // 2026-06-08: the two views listed different ICPs). Both derive from the
  // filtered `leads` set, so build the matrix ICP universe the same way.
  const matrixIcps = new Set<string>();
  for (const l of leads) matrixIcps.add(l.icp_profile_id ?? "_unknown");
  const matrixChannels = new Set<string>();
  for (const k of matrixGrid.keys()) {
    const [, ch] = k.split("|");
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
  // Per-ICP total leads (filtered set). Drives the "Leads" column the boss
  // wanted at the start of each matrix row — gives context for what
  // "contacted" in each cell means as a share of the pool.
  const totalLeadsByIcp = new Map<string, number>();
  for (const l of leads) {
    const id = l.icp_profile_id ?? "_unknown";
    totalLeadsByIcp.set(id, (totalLeadsByIcp.get(id) ?? 0) + 1);
  }
  const orderedIcps = Array.from(matrixIcps)
    .map(id => ({ id, name: profileMap.get(id) ?? "Sin ICP", totalLeads: totalLeadsByIcp.get(id) ?? 0 }))
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
  // Flow-name → most common ICP across the flow's leads. A wizard-created
  // flow has every lead under the same ICP, so the mode is trivially the
  // ICP. Manual edits can mix ICPs into one flow name; we still pick the
  // dominant one for display rather than splitting the row.
  const icpCountByFlow = new Map<string, Map<string, number>>();
  // Flow-name → campaign_id set. Lets us aggregate the per-campaign_id
  // step buckets back to the flow-name level the dashboard renders by.
  const campaignIdsByFlow = new Map<string, Set<string>>();
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
      const leadIcp = leadIcpMap.get(c.lead_id);
      if (leadIcp && leadIcp !== "_unknown") {
        let bucket = icpCountByFlow.get(c.name);
        if (!bucket) { bucket = new Map(); icpCountByFlow.set(c.name, bucket); }
        bucket.set(leadIcp, (bucket.get(leadIcp) ?? 0) + 1);
      }
    }
    let idSet = campaignIdsByFlow.get(c.name);
    if (!idSet) { idSet = new Set(); campaignIdsByFlow.set(c.name, idSet); }
    idSet.add(c.id);
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
  const profileNameById = new Map(allProfiles.map(p => [p.id, p.profile_name]));
  const campaignPerformance = Array.from(campAgg.values()).map(g => {
    let status = "completed";
    if (g.statuses.has("active")) status = "active";
    else if (g.statuses.has("paused")) status = "paused";
    // Pick the dominant ICP for this flow. A flow rarely mixes ICPs;
    // when it does (manual edits), the mode is the honest representation
    // — we don't want to invent a "Mixed" bucket because it would split
    // the row across the accordion sections.
    let dominantIcp: string | null = null;
    const icpBucket = icpCountByFlow.get(g.name);
    if (icpBucket) {
      let bestCount = 0;
      for (const [icpId, count] of icpBucket) {
        if (count > bestCount) { bestCount = count; dominantIcp = icpId; }
      }
    }
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
      icp_profile_id: dominantIcp,
      icp_profile_name: dominantIcp ? (profileNameById.get(dominantIcp) ?? null) : null,
    };
  }).sort((a, b) => b.conversionRate - a.conversionRate || b.leads - a.leads);

  // Count flows per ICP — boss 2026-05-28: the ICP comparison table needs
  // a "Flows" column next to Leads so the operator sees how many distinct
  // sequences each Lead Miner Profile is running. campaignPerformance is
  // already keyed by flow name with a dominant ICP attribution, so we just
  // bucket-count.
  const flowsByIcp = new Map<string, number>();
  for (const c of campaignPerformance) {
    const key = c.icp_profile_id ?? "_unknown";
    flowsByIcp.set(key, (flowsByIcp.get(key) ?? 0) + 1);
  }

  // ── Seller leaderboard ─────────────────────────────────────────────────
  // Boss feedback 2026-05-27: per-seller breakdown should expose the actual
  // channel volume (connections sent, LinkedIn messages, emails, calls) so
  // the operator can spot who's doing what — the prior version only showed
  // the aggregated counts. Follow-up 2026-05-28: also "de qué campaña o
  // ticket vienen esas métricas" → top-3 campaign + ICP attribution per
  // seller is computed below so the row can expand to show provenance.
  type SellerAgg = {
    id: string; name: string;
    contacted: Set<string>; replied: Set<string>; positive: Set<string>;
    active: number; sent: number;
    sentLinkedinConn: number; sentLinkedinMsg: number; sentEmail: number; sentCall: number;
    /** Per-channel reply tracking — boss 2026-05-28: see reply rate per
     * channel for each seller, not just aggregated. */
    contactedLinkedin: Set<string>; repliedLinkedin: Set<string>;
    contactedEmail: Set<string>;    repliedEmail: Set<string>;
    contactedCall: Set<string>;     repliedCall: Set<string>;
    /** Connection acceptance leg — accepted = leads who got past step 0
     * after a CR. Uses linkedinSentLeadIds vs connectedLeadIds. */
    connectionsSent: Set<string>; connectionsAccepted: Set<string>;
    /** Pending calls = call-channel messages still queued for this seller. */
    pendingCalls: number;
    byCampaign: Map<string, { name: string; sent: number; replied: Set<string>; positive: Set<string> }>;
    byIcp: Map<string, { id: string; name: string; sent: number; replied: Set<string>; positive: Set<string> }>;
  };
  const sellerAgg = new Map<string, SellerAgg>();
  for (const c of campaigns) {
    if (!c.seller_id) continue;
    let g = sellerAgg.get(c.seller_id);
    if (!g) {
      g = {
        id: c.seller_id,
        name: sellerMap.get(c.seller_id) ?? "Sin asignar",
        contacted: new Set(), replied: new Set(), positive: new Set(),
        active: 0, sent: 0,
        sentLinkedinConn: 0, sentLinkedinMsg: 0, sentEmail: 0, sentCall: 0,
        contactedLinkedin: new Set(), repliedLinkedin: new Set(),
        contactedEmail: new Set(),    repliedEmail: new Set(),
        contactedCall: new Set(),     repliedCall: new Set(),
        connectionsSent: new Set(), connectionsAccepted: new Set(),
        pendingCalls: 0,
        byCampaign: new Map(),
        byIcp: new Map(),
      };
      sellerAgg.set(c.seller_id, g);
    }
    if (c.lead_id) {
      g.contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
      // Connection invite leg — LinkedIn campaigns send a CR as step 0.
      // This is campaign-channel-specific (only linkedin campaigns send CRs).
      if ((c.channel ?? "linkedin") === "linkedin") {
        if (linkedinSentLeadIds.has(c.lead_id)) g.connectionsSent.add(c.lead_id);
        if (connectedLeadIds.has(c.lead_id)) g.connectionsAccepted.add(c.lead_id);
      }
      // Per-channel contacted/replied are built in the messages loop below
      // using m.channel (dispatcher-stamped), NOT c.channel. Using the
      // campaign's top-level channel made all email/call steps inside a
      // "linkedin" multi-channel flow vanish from Email/Call stats.
    }
    if (c.status === "active") g.active++;
    // Per-campaign attribution
    let camp = g.byCampaign.get(c.name);
    if (!camp) { camp = { name: c.name, sent: 0, replied: new Set(), positive: new Set() }; g.byCampaign.set(c.name, camp); }
    if (c.lead_id) {
      if (repliedLeadIds.has(c.lead_id)) camp.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) camp.positive.add(c.lead_id);
    }
    // Per-ICP attribution (via the lead's icp_profile_id)
    if (c.lead_id) {
      const lead = leads.find(l => l.id === c.lead_id);
      const icpId = lead?.icp_profile_id ?? "_unknown";
      let icp = g.byIcp.get(icpId);
      if (!icp) {
        icp = {
          id: icpId,
          name: icpId === "_unknown" ? "—" : (profileMap.get(icpId) ?? icpId),
          sent: 0, replied: new Set(), positive: new Set(),
        };
        g.byIcp.set(icpId, icp);
      }
      if (repliedLeadIds.has(c.lead_id)) icp.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) icp.positive.add(c.lead_id);
    }
  }
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c?.seller_id) continue;
    const g = sellerAgg.get(c.seller_id);
    if (!g) continue;
    g.sent++;
    // Use the MESSAGE's own channel (dispatcher-stamped) — not the campaign's
    // top-level channel — so multi-channel flows count email/call steps correctly.
    const ch = m.channel ?? c.channel ?? "linkedin";
    if (ch === "linkedin") {
      if ((m.step_number ?? 0) === 0) g.sentLinkedinConn++;
      else g.sentLinkedinMsg++;
    } else if (ch === "email") g.sentEmail++;
    else if (ch === "call") g.sentCall++;
    // Per-channel contacted/replied: keyed by message channel so a lead in a
    // "linkedin" campaign that also got an email step shows up under Email too.
    if (c.lead_id) {
      if (ch === "linkedin") {
        g.contactedLinkedin.add(c.lead_id);
        if (repliedLeadIds.has(c.lead_id)) g.repliedLinkedin.add(c.lead_id);
      } else if (ch === "email") {
        g.contactedEmail.add(c.lead_id);
        if (repliedLeadIds.has(c.lead_id)) g.repliedEmail.add(c.lead_id);
      } else if (ch === "call") {
        g.contactedCall.add(c.lead_id);
        if (repliedLeadIds.has(c.lead_id)) g.repliedCall.add(c.lead_id);
      }
    }
    // Send attribution to per-campaign + per-ICP aggregates
    const camp = g.byCampaign.get(c.name);
    if (camp) camp.sent++;
    if (c.lead_id) {
      const lead = leads.find(l => l.id === c.lead_id);
      const icpId = lead?.icp_profile_id ?? "_unknown";
      const icp = g.byIcp.get(icpId);
      if (icp) icp.sent++;
    }
  }
  // Pending calls per seller — call-channel campaign messages still
  // queued/pending. Uses the same source as the Channels callsBreakdown
  // so the numbers match across the dashboard.
  for (const m of allMessages) {
    if (m.status !== "queued" && m.status !== "pending") continue;
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c?.seller_id) continue;
    if (m.channel !== "call") continue; // use message-level channel, not campaign's
    const g = sellerAgg.get(c.seller_id);
    if (g) g.pendingCalls++;
  }
  const sellerPerformance = Array.from(sellerAgg.values()).map(g => {
    const topCampaigns = Array.from(g.byCampaign.values())
      .map(c => ({ name: c.name, sent: c.sent, replied: c.replied.size, positive: c.positive.size }))
      .sort((a, b) => b.positive - a.positive || b.sent - a.sent)
      .slice(0, 3);
    const topIcps = Array.from(g.byIcp.values())
      .map(i => ({ id: i.id, name: i.name, sent: i.sent, replied: i.replied.size, positive: i.positive.size }))
      .sort((a, b) => b.positive - a.positive || b.sent - a.sent)
      .slice(0, 3);
    return {
      id: g.id,
      name: g.name,
      contacted: g.contacted.size,
      sent: g.sent,
      replied: g.replied.size,
      positive: g.positive.size,
      active: g.active,
      sentLinkedinConn: g.sentLinkedinConn,
      sentLinkedinMsg: g.sentLinkedinMsg,
      sentEmail: g.sentEmail,
      sentCall: g.sentCall,
      // Per-channel reply rates — boss 2026-05-28 wanted to see which
      // channel works for each seller specifically.
      replyRateLinkedin: g.contactedLinkedin.size > 0 ? Math.round((g.repliedLinkedin.size / g.contactedLinkedin.size) * 100) : 0,
      replyRateEmail:    g.contactedEmail.size > 0    ? Math.round((g.repliedEmail.size    / g.contactedEmail.size) * 100)    : 0,
      replyRateCall:     g.contactedCall.size > 0     ? Math.round((g.repliedCall.size     / g.contactedCall.size) * 100)     : 0,
      contactedLinkedin: g.contactedLinkedin.size,
      contactedEmail:    g.contactedEmail.size,
      contactedCall:     g.contactedCall.size,
      repliedLinkedin:   g.repliedLinkedin.size,
      repliedEmail:      g.repliedEmail.size,
      repliedCall:       g.repliedCall.size,
      // Connection invite leg
      connectionsSent: g.connectionsSent.size,
      connectionsAccepted: g.connectionsAccepted.size,
      acceptanceRate: g.connectionsSent.size > 0 ? Math.round((g.connectionsAccepted.size / g.connectionsSent.size) * 100) : 0,
      pendingCalls: g.pendingCalls,
      responseRate: g.contacted.size > 0 ? Math.round((g.replied.size / g.contacted.size) * 100) : 0,
      conversionRate: g.contacted.size > 0 ? Math.round((g.positive.size / g.contacted.size) * 100) : 0,
      topCampaigns,
      topIcps,
    };
  }).sort((a, b) => b.positive - a.positive || b.sent - a.sent);

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
  // Sundays (0) → Saturday (6); 0–23 hour bands. Round 5 boss feedback
  // #3: per-channel heatmaps so the operator can see "LinkedIn replies
  // come Tue morning, email comes Thu night" instead of an averaged
  // mush. We compute one matrix per canonical channel + "all" so the
  // chart can filter without a server roundtrip.
  const blank = () => Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  const heatmap = blank(); // backward-compat: aggregate matrix
  const heatmapByChannel: Record<string, number[][]> = {
    all: heatmap,
    linkedin: blank(),
    email: blank(),
    call: blank(),
  };
  for (const r of replies) {
    if (!r.received_at) continue;
    const d = new Date(r.received_at);
    const day = d.getDay();
    const hour = d.getHours();
    heatmap[day][hour]++;
    // Reply has its own channel field (recorded at receipt time); falls
    // back to the campaign's channel when the reply row is bare.
    let ch: string | null = r.channel ?? null;
    if (!ch && r.campaign_id) {
      ch = campaignChannelById.get(r.campaign_id) ?? null;
    }
    if (ch && (ch === "linkedin" || ch === "email" || ch === "call")) {
      heatmapByChannel[ch][day][hour]++;
    }
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
  // Prior-period reply class counts — used by the Donut to render a
  // +/- delta chip per classification (boss feedback round 5 #2).
  const replyClassCountsPrior: Record<string, number> = { positive: 0, meeting_intent: 0 };
  for (const r of priorReplies) {
    const k = r.classification ?? "unclassified";
    replyClassCountsPrior[k] = (replyClassCountsPrior[k] ?? 0) + 1;
  }
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
    callOutcomesBySeller,
    // Exposed even after the funnel trim, so the LinkedIn Connections
    // card on the Channels tab can keep showing Sent → Accepted → rate
    // (those stages disappeared from the funnel proper).
    linkedinConnections: { sent: linkedinSentCount, accepted: connectedLeads },
    icpPerformance: icpPerformance.map(p => ({ ...p, spark: sparkByIcp.get(p.id) ?? new Array(14).fill(0), flows: flowsByIcp.get(p.id) ?? 0 })),
    campaignPerformance: campaignPerformance.map(c => ({ ...c, spark: sparkByCampaign.get(c.name) ?? new Array(14).fill(0) })),
    sellerPerformance: sellerPerformance.map(s => ({ ...s, spark: sparkBySeller.get(s.id) ?? new Array(14).fill(0) })),
    trend30d,
    trendPrior,
    replyClassCounts,
    replyClassCountsPrior,
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
      // "What to do today" is a LIVE action hero — it must reflect the current
      // actionable state of the workspace, NOT the analytics period selector.
      // So every bucket reads the UNFILTERED sources (allLeads/allReplies/
      // allCampaigns/allMessages); binding it to from/to made replies on
      // older leads silently vanish (leadById miss) and stale buckets jump
      // around when the operator changed the period. (Fixed 2026-06-02.)
      const leadById = new Map(allLeads.map(l => [l.id, l]));
      const allRepliedLeadIds = new Set(allReplies.map(r => r.lead_id).filter(Boolean) as string[]);
      const profileById = new Map(allProfiles.map(p => [p.id, p.profile_name]));
      type TodayLead = {
        id: string;
        company: string;
        icp: string | null;
        when: string | null;
        tag: string | null;
        name: string | null;
        channel: string | null;
        phone: string | null;
      };
      const summarize = (leadId: string, extra: { when?: string | null; tag?: string | null; channel?: string | null } = {}): TodayLead | null => {
        const l = leadById.get(leadId);
        if (!l) return null;
        const first = l.primary_first_name ?? "";
        const last  = l.primary_last_name ?? "";
        const name = `${first} ${last}`.trim() || null;
        return {
          id: l.id,
          company: l.company_name ?? "—",
          icp: l.icp_profile_id ? (profileById.get(l.icp_profile_id) ?? null) : null,
          when: extra.when ?? l.created_at ?? null,
          tag: extra.tag ?? null,
          name,
          channel: extra.channel ?? null,
          phone: l.primary_phone ?? null,
        };
      };
      const allRepliesSorted = [...allReplies]
        .sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
      // Each section keeps a full distinct-lead COUNT (the real number shown
      // in the header) and a top-N preview list (rendered when expanded).
      // Decoupling the two is the whole point of this pass: the header used
      // to show `list.length`, which was capped at 8 and lied. The preview
      // stays bounded so the panel is scannable; the count never lies.
      const TODAY_PREVIEW = 8;

      // Replies bucket = what the seller has to TRIAGE now. Mirrors the inbox
      // "Pending review" definition (requires_human_review OR review_status
      // pending). EXCLUDES synthetic call-outcome rows (channel='call'): the
      // call-outcome route logs those into lead_replies, but they're NOT
      // inbound messages and belong in Calls/Results, not "Replies to review"
      // (boss 2026-06-04 — Replies must show replies only, never call results).
      const repliesIds = new Set<string>();
      const repliesList: TodayLead[] = [];
      for (const r of allRepliesSorted) {
        if (!r.lead_id || r.channel === "call") continue;
        if (!(r.requires_human_review === true || r.review_status === "pending")) continue;
        if (!leadById.has(r.lead_id) || repliesIds.has(r.lead_id)) continue;
        repliesIds.add(r.lead_id);
        if (repliesList.length < TODAY_PREVIEW) {
          const s = summarize(r.lead_id, { when: r.received_at, tag: r.classification, channel: r.channel });
          if (s) repliesList.push(s);
        }
      }

      const positivesIds = new Set<string>();
      const positivesList: TodayLead[] = [];
      for (const r of allRepliesSorted) {
        if (!r.lead_id || !POSITIVE_CLASS.has(r.classification ?? "")) continue;
        if (!leadById.has(r.lead_id) || positivesIds.has(r.lead_id)) continue;
        positivesIds.add(r.lead_id);
        if (positivesList.length < TODAY_PREVIEW) {
          const s = summarize(r.lead_id, { when: r.received_at, tag: r.classification });
          if (s) positivesList.push(s);
        }
      }

      const withCampaignSet = new Set<string>();
      for (const c of allCampaigns) if (c.lead_id) withCampaignSet.add(c.lead_id);
      const unassignedAll = allLeads.filter(l => !withCampaignSet.has(l.id));
      const unassignedList: TodayLead[] = [...unassignedAll]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, TODAY_PREVIEW)
        .map(l => summarize(l.id))
        .filter((x): x is TodayLead => x !== null);

      // Today's pending calls — call-channel campaign messages queued/pending
      // for sellers to dial. Distinct-lead count + top-N preview.
      const campaignById = new Map(allCampaigns.map(c => [c.id, c]));
      const callsIds = new Set<string>();
      const callsList: TodayLead[] = [];
      for (const m of allMessages) {
        if (m.status !== "queued" && m.status !== "pending") continue;
        if (!m.campaign_id) continue;
        // Use the MESSAGE's own channel (dispatcher-stamped), not the campaign's
        // top-level channel. Multi-channel flows (linkedin/email) have call steps
        // whose m.channel="call" while camp.channel="linkedin" — the old check
        // against camp.channel silently excluded all those calls.
        if (m.channel !== "call") continue;
        const camp = campaignById.get(m.campaign_id);
        if (!camp) continue;
        const leadId = camp.lead_id;
        if (!leadId || !leadById.has(leadId) || callsIds.has(leadId)) continue;
        callsIds.add(leadId);
        if (callsList.length < TODAY_PREVIEW) {
          const s = summarize(leadId, { when: null, tag: null });
          if (s) callsList.push(s);
        }
      }

      // Stale leads — contacted ≥7d ago, never replied. Bleeding-momentum
      // bucket. Per-lead latest sent_at comes from allMessages; we exclude
      // any lead that ever replied. Sorted by oldest-touch-first so the
      // operator works the riskiest cohort first.
      const STALE_DAYS = 7;
      const staleCutoffMs = Date.now() - STALE_DAYS * 86_400_000;
      const lastSentByLead = new Map<string, number>();
      for (const m of allMessages) {
        if (m.status !== "sent" || !m.sent_at || !m.campaign_id) continue;
        const camp = campaignById.get(m.campaign_id);
        if (!camp?.lead_id) continue;
        const tMs = new Date(m.sent_at).getTime();
        const prev = lastSentByLead.get(camp.lead_id);
        if (prev === undefined || tMs > prev) lastSentByLead.set(camp.lead_id, tMs);
      }
      const staleCandidates: Array<{ leadId: string; lastSentIso: string; tMs: number }> = [];
      for (const [leadId, tMs] of lastSentByLead.entries()) {
        if (tMs > staleCutoffMs) continue;            // touched recently — not stale
        if (allRepliedLeadIds.has(leadId)) continue;  // replied — not stale
        if (!leadById.has(leadId)) continue;          // lead must still exist
        staleCandidates.push({ leadId, lastSentIso: new Date(tMs).toISOString(), tMs });
      }
      staleCandidates.sort((a, b) => a.tMs - b.tMs); // oldest first
      const staleList: TodayLead[] = staleCandidates
        .slice(0, TODAY_PREVIEW)
        .map(s => summarize(s.leadId, { when: s.lastSentIso, tag: null }))
        .filter((x): x is TodayLead => x !== null);

      return {
        replies: repliesList,
        positives: positivesList,
        calls: callsList,
        unassigned: unassignedList,
        stale: staleList,
        // Real, un-capped distinct-lead counts for each section header.
        counts: {
          replies: repliesIds.size,
          positives: positivesIds.size,
          calls: callsIds.size,
          unassigned: unassignedAll.length,
          stale: staleCandidates.length,
        },
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
    stepPerformanceByFlow,
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
    heatmap, // [7][24] — Sun..Sat × 0..23h (aggregate across channels)
    heatmapByChannel,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

/** Lightweight headline query for the "My metrics" card period picker.
 *  Only fetches sent messages + replies in the requested window — no full
 *  dashboard aggregation — so it runs in parallel without doubling DB load. */
export async function getMyMetricsHeadline(myp: "today" | "7d" | "30d") {
  try {
    const supabase = await getSupabaseServer();
    const scope = await getUserScope();
    const bioId = scope.isScoped ? scope.companyBioId! : null;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    let fromStr: string;
    if (myp === "today") {
      fromStr = todayStr;
    } else if (myp === "7d") {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      fromStr = d.toISOString().slice(0, 10);
    } else {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      fromStr = d.toISOString().slice(0, 10);
    }
    const fromIso = `${fromStr}T00:00:00.000Z`;
    const toIso   = `${todayStr}T23:59:59.999Z`;

    let msgQ = supabase
      .from("campaign_messages")
      .select("campaigns!inner(lead_id, leads!inner(company_bio_id))")
      .eq("status", "sent")
      .gte("sent_at", fromIso)
      .lte("sent_at", toIso)
      .limit(5000);
    if (bioId) msgQ = (msgQ as any).eq("campaigns.leads.company_bio_id", bioId);

    let replyQ = supabase
      .from("lead_replies")
      .select("lead_id, classification, leads!inner(company_bio_id)")
      .gte("received_at", fromIso)
      .lte("received_at", toIso)
      .limit(5000);
    if (bioId) replyQ = (replyQ as any).eq("leads.company_bio_id", bioId);

    const [{ data: msgs }, { data: repls }] = await Promise.all([msgQ, replyQ]);

    const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);
    const contactedLeads = new Set(
      (msgs ?? []).map((m: any) => m.campaigns?.lead_id).filter(Boolean)
    ).size;
    const repliedCount = new Set(
      (repls ?? []).map((r: any) => r.lead_id).filter(Boolean)
    ).size;
    const positiveCount = new Set(
      (repls ?? [])
        .filter((r: any) => POSITIVE_CLASS.has(r.classification ?? ""))
        .map((r: any) => r.lead_id)
        .filter(Boolean)
    ).size;
    const responseRate =
      contactedLeads > 0 ? Math.round((repliedCount / contactedLeads) * 100) : 0;

    return { contactedLeads, repliedCount, positiveCount, responseRate };
  } catch (e) {
    console.error("[my-metrics] headline error:", e);
    return { contactedLeads: 0, repliedCount: 0, positiveCount: 0, responseRate: 0 };
  }
}

// ── Seller activity — last_seen_at per seller via sellers.user_id ────────────
// Used by SellerPulseTable. Server-side join avoids the client-side name-match
// hack (which breaks when auth display_name ≠ seller name).
// Returns a map of sellerId → { userId, lastSeenAt }.
export async function getSellerActivity(bioId: string | null): Promise<Map<string, { userId: string | null; lastSeenAt: string | null; displayName: string | null }>> {
  try {
    const supabase = await getSupabaseServer();
    const svc = getSupabaseService();

    // Fetch ALL active sellers across companies. sellerPerformance is
    // already company-scoped via campaigns, so we use that as the display
    // filter — this lookup is just for user_id + last_seen_at enrichment.
    // Filtering by company_bio_id here would exclude shared sellers (e.g.
    // Simone/Sara who have seller records under other companies but work for SWL).
    const { data: sellers } = await supabase
      .from("sellers")
      .select("id, user_id")
      .eq("active", true);

    const userIds = ((sellers ?? []).map(s => (s as { user_id: string | null }).user_id).filter(Boolean)) as string[];

    let profileMap: Record<string, string | null> = {};
    let displayNameMap: Record<string, string | null> = {};

    if (userIds.length > 0) {
      const [profilesResult, authResult] = await Promise.allSettled([
        svc
          .from("user_profiles")
          .select("user_id, last_seen_at")
          .in("user_id", userIds),
        svc.auth.admin.listUsers({ page: 1, perPage: 200 }),
      ]);

      if (profilesResult.status === "fulfilled") {
        for (const p of profilesResult.value.data ?? []) {
          profileMap[(p as { user_id: string }).user_id] = (p as { last_seen_at: string | null }).last_seen_at;
        }
      }

      if (authResult.status === "fulfilled") {
        const authUsers = (authResult.value.data as { users?: unknown[] })?.users ?? [];
        for (const u of authUsers as Array<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>) {
          if (userIds.includes(u.id)) {
            displayNameMap[u.id] =
              (u.user_metadata?.name as string | undefined) ||
              (u.user_metadata?.display_name as string | undefined) ||
              (u.user_metadata?.full_name as string | undefined) ||
              u.email?.split("@")[0] ||
              null;
          }
        }
      }
    }

    return new Map(
      (sellers ?? []).map(s => {
        const row = s as { id: string; user_id: string | null };
        return [row.id, {
          userId: row.user_id ?? null,
          lastSeenAt: row.user_id ? (profileMap[row.user_id] ?? null) : null,
          displayName: row.user_id ? (displayNameMap[row.user_id] ?? null) : null,
        }];
      })
    );
  } catch (e) {
    console.error("[seller-activity] error:", e);
    return new Map();
  }
}
