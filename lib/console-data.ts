// ─────────────────────────────────────────────────────────────────────────
// THE CONSOLE AGGREGATION — real data in the shapes the approved mock uses.
//
// The mock at /dashboard-console was built against hand-measured constants.
// This module produces the SAME shapes from production, so the components
// keep their design and only lose their fake numbers.
//
// It is a self-contained pass rather than a translation of the legacy
// dashboard payload, because the mock asks for things that payload never
// computed: reach and replies per channel per ICP, the channel of each flow
// step, per-seller daily activity. Every RULE, though, comes from
// lib/metric-defs.ts and lib/metrics/* — there is no second definition of a
// metric here, only a second shape.
//
// Calls are the canonical five: Attempted / Confirmed Connected / Confirmed
// Not Connected / Unknown / Confirmed Connect Rate. The mock's old "connect
// rate 43.6%" is gone; it was `answered`, which disagrees with the human
// outcome half the time.
// ─────────────────────────────────────────────────────────────────────────

import { getSupabaseService } from "@/lib/supabase-service";
import {
  SourceUnavailableError, resolveWindow, priorWindow, inWindow,
  businessDayKey, businessHour, businessWeekday,
  isInboundReply, isPositiveReply, roundRate, type Window,
  invitedLeadIds, linkedinAcceptance,
} from "@/lib/metric-defs";
import {
  canonicalCallGroups, callMetrics, callMatchesScope,
  emptyPhysicalCallScope, type CallGroupView,
} from "@/lib/metrics/calls-read";
import type { RawCallRow } from "@/lib/metrics/calls-identity";

/* ═══ the four things we can do to a lead ═══════════════════════════════ */
export const CH_KEYS = ["li_cr", "li_dm", "email", "call"] as const;
export type ChKey = (typeof CH_KEYS)[number];
export type Touch = Record<ChKey, number>;
export const zeroTouch = (): Touch => ({ li_cr: 0, li_dm: 0, email: 0, call: 0 });

export type Delta = { v: number; unit: "pp" | "pct" } | null;

/* ═══ rows we read ══════════════════════════════════════════════════════ */
type LeadRow = { id: string; company_bio_id: string | null; icp_profile_id: string | null; status: string | null; linkedin_connected: boolean | null; created_at: string | null };
type CampRow = { id: string; lead_id: string | null; name: string | null; status: string | null; seller_id: string | null; assigned_user_id: string | null; sequence_steps: unknown };
type MsgRow = { id: string; campaign_id: string | null; lead_id: string | null; channel: string | null; step_number: number | null; status: string | null; sent_at: string | null };
type ReplyRow = { id: string; lead_id: string | null; channel: string | null; classification: string | null; received_at: string | null };
type SellerRow = { id: string; name: string; user_id: string | null; active: boolean | null };
type IcpRowDb = { id: string; profile_name: string | null };

export type ConsoleFilters = {
  from: string | null;
  to: string | null;
  bioId: string | null;
  /**
   * Seller-tier scope: campaigns.assigned_user_id. When set, this human may
   * only see the leads assigned to them. The legacy dashboard enforces this
   * and the console must too — without it a seller sees the whole workspace.
   */
  assignedUserId?: string | null;
  campaignNames?: string[];
  icpIds?: string[];
  sellerIds?: string[];
  /** Which preset button produced this window, for the control's state. */
  preset?: string | null;
};

async function page<T>(make: () => any, source: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new SourceUnavailableError(source, error);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * The channel of a message, as the four buckets the console shows.
 * A LinkedIn message at step 0 is the connection request; step >= 1 is a DM.
 * They are different actions with different denominators and the mock has
 * always separated them.
 */
export function touchKey(m: { channel: string | null; step_number: number | null }): ChKey | null {
  const ch = (m.channel ?? "").toLowerCase();
  if (ch === "email") return "email";
  if (ch === "call") return "call";
  if (ch === "linkedin") return (m.step_number ?? 0) >= 1 ? "li_dm" : "li_cr";
  return null;
}

export type ConsoleSource = {
  leads: LeadRow[]; camps: CampRow[]; msgs: MsgRow[]; replies: ReplyRow[];
  sellers: SellerRow[]; icps: IcpRowDb[]; calls: RawCallRow[];
};

export async function loadConsoleSource(bioId: string | null): Promise<ConsoleSource> {
  const svc = getSupabaseService();
  const scoped = (q: any, col: string) => (bioId ? q.eq(col, bioId) : q);

  const [leads, camps, msgs, replies, sellers, icps, calls] = await Promise.all([
    page<LeadRow>(() => scoped(svc.from("leads").select("id, company_bio_id, icp_profile_id, status, linkedin_connected, created_at"), "company_bio_id"), "leads"),
    page<CampRow>(() => scoped(svc.from("campaigns").select("id, lead_id, name, status, seller_id, assigned_user_id, sequence_steps, leads!inner(company_bio_id)"), "leads.company_bio_id"), "campaigns"),
    page<MsgRow>(() => scoped(svc.from("campaign_messages").select("id, campaign_id, lead_id, channel, step_number, status, sent_at, leads!inner(company_bio_id)"), "leads.company_bio_id"), "campaign_messages"),
    page<ReplyRow>(() => scoped(svc.from("lead_replies").select("id, lead_id, channel, classification, received_at, leads!inner(company_bio_id)"), "leads.company_bio_id"), "lead_replies"),
    page<SellerRow>(() => scoped(svc.from("sellers").select("id, name, user_id, active"), "company_bio_id"), "sellers"),
    page<IcpRowDb>(() => scoped(svc.from("icp_profiles").select("id, profile_name"), "company_bio_id"), "icp_profiles"),
    page<RawCallRow>(() => scoped(svc.from("calls").select("id, canonical_call_id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, direction, status, duration, classification, started_at, phone_number, coach_score, created_at, leads!inner(company_bio_id)"), "leads.company_bio_id"), "calls"),
  ]);
  return { leads, camps, msgs, replies, sellers, icps, calls };
}

/* ═══ the shared index every tab reads ══════════════════════════════════ */
export type ConsoleIndex = ReturnType<typeof buildIndex>;

export function buildIndex(src: ConsoleSource, f: ConsoleFilters) {
  const win = resolveWindow(f.from, f.to);
  const prior = priorWindow(win);

  const leadById = new Map(src.leads.map(l => [l.id, l]));
  const icpName = new Map(src.icps.map(i => [i.id, i.profile_name ?? "—"]));
  const sellerById = new Map(src.sellers.map(s => [s.id, s]));
  const sellerOfUser = new Map(src.sellers.filter(s => s.user_id).map(s => [s.user_id as string, s.id]));

  // A lead belongs to one flow for reporting: the first campaign that owns it.
  const campOfLead = new Map<string, CampRow>();
  const campById = new Map(src.camps.map(c => [c.id, c]));
  for (const c of src.camps) if (c.lead_id && !campOfLead.has(c.lead_id)) campOfLead.set(c.lead_id, c);
  const leadAssignedUser = new Map<string, string>();
  for (const c of src.camps) if (c.lead_id && c.assigned_user_id && !leadAssignedUser.has(c.lead_id)) leadAssignedUser.set(c.lead_id, c.assigned_user_id);

  // campaign_id → lead_id, the map the canonical acceptance helper expects.
  const leadOfCampaign = new Map(src.camps.filter(c => c.lead_id).map(c => [c.id, c.lead_id as string]));
  const icpOfLead = (id: string | null) => (id ? leadById.get(id)?.icp_profile_id ?? null : null);
  const campNameOfLead = (id: string | null) => (id ? campOfLead.get(id)?.name ?? null : null);

  /* ── active filters, as sets ──────────────────────────────────────── */
  // Seller tier first: it is a permission, not a filter, so it applies
  // before anything the user chose on screen.
  const assignedLeadIds: Set<string> | null = f.assignedUserId
    ? new Set(src.camps.filter(c => c.assigned_user_id === f.assignedUserId && c.lead_id).map(c => c.lead_id as string))
    : null;
  const campSet = f.campaignNames?.length ? new Set(f.campaignNames) : null;
  const icpSet = f.icpIds?.length ? new Set(f.icpIds) : null;
  const sellerSet = f.sellerIds?.length ? new Set(f.sellerIds) : null;

  /** Does this LEAD survive the campaign / ICP filters? Seller is resolved
   *  per artefact (a call's seller is who dialled, a message's is the flow). */
  const leadInScope = (id: string | null): boolean => {
    if (!id) return false;
    if (assignedLeadIds && !assignedLeadIds.has(id)) return false;
    if (campSet && !campSet.has(campNameOfLead(id) ?? "")) return false;
    if (icpSet && !icpSet.has(icpOfLead(id) ?? "")) return false;
    if (sellerSet) {
      const c = campOfLead.get(id);
      const owner = c?.seller_id ?? null;
      if (!owner || !sellerSet.has(owner)) return false;
    }
    return true;
  };

  /* ── messages actually sent, in window ────────────────────────────── */
  const sentIn = (w: Window) => src.msgs.filter(m =>
    m.status === "sent" && m.sent_at && inWindow(m.sent_at, w) && leadInScope(m.lead_id));
  const msgsWin = sentIn(win);
  const msgsPrior = prior ? sentIn(prior) : [];

  /** Contacted = distinct leads that received at least one message. */
  const contactedIds = (list: MsgRow[]) => new Set(list.map(m => m.lead_id).filter((x): x is string => !!x));
  const contacted = contactedIds(msgsWin);
  const contactedPrior = contactedIds(msgsPrior);

  /* ── replies: inbound only, never a call outcome ──────────────────── */
  const inboundIn = (w: Window) => src.replies.filter(r =>
    isInboundReply(r) && r.received_at && inWindow(r.received_at, w) && leadInScope(r.lead_id));
  const inboundWin = inboundIn(win);
  const inboundPrior = prior ? inboundIn(prior) : [];

  /** COHORT: only replies from leads contacted inside the window count in a
   *  rate. The rest are inbox workload and are reported separately. */
  const cohortReplies = inboundWin.filter(r => r.lead_id && contacted.has(r.lead_id));
  const cohortRepliedLeads = new Set(cohortReplies.map(r => r.lead_id as string));
  const cohortPositiveLeads = new Set(cohortReplies.filter(isPositiveReply).map(r => r.lead_id as string));
  const outsideCohort = inboundWin.length - cohortReplies.length;

  const priorCohort = inboundPrior.filter(r => r.lead_id && contactedPrior.has(r.lead_id));
  const priorRepliedLeads = new Set(priorCohort.map(r => r.lead_id as string));
  const priorPositiveLeads = new Set(priorCohort.filter(isPositiveReply).map(r => r.lead_id as string));

  /* ── calls: group FIRST, then scope ───────────────────────────────── */
  const allGroups = canonicalCallGroups(src.calls, {
    win,
    leadToCampaignName: new Map([...campOfLead].map(([lid, c]) => [lid, c.name ?? null])),
    leadToCampaignId: new Map([...campOfLead].map(([lid, c]) => [lid, c.id])),
    leadToIcpId: new Map(src.leads.filter(l => l.icp_profile_id).map(l => [l.id, l.icp_profile_id as string])),
    sellerOfUser,
    leadAssignedUser,
    toDayKey: businessDayKey,
  });
  const callScope = {
    ...emptyPhysicalCallScope(),
    sellerIds: sellerSet, campaignNames: campSet, icpIds: icpSet, assignedLeadIds,
  };
  const callGroups = allGroups.filter(g => callMatchesScope(g, callScope));

  return {
    win, prior, src,
    leadById, icpName, sellerById, sellerOfUser, campOfLead, campById, leadOfCampaign, campNameOfLead, icpOfLead,
    campSet, icpSet, sellerSet, assignedLeadIds, leadInScope,
    msgsWin, msgsPrior, contacted, contactedPrior,
    inboundWin, cohortReplies, cohortRepliedLeads, cohortPositiveLeads, outsideCohort,
    priorRepliedLeads, priorPositiveLeads,
    callGroups, allCallGroups: allGroups,
  };
}

/** Percentage-point / percent delta, or null when there is no prior. */
export function delta(now: number, before: number | null, unit: "pp" | "pct" = "pct"): Delta {
  if (before === null || before === 0) return null;
  const v = unit === "pp" ? now - before : ((now - before) / before) * 100;
  return { v: Math.round(v * 10) / 10, unit };
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW  — the `D` shape Console.tsx and Shell.tsx read.
   ═══════════════════════════════════════════════════════════════════════ */

const fmtRange = (from: string | null, to: string | null) => {
  const m = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (!from && !to) return "All time";
  if (from && to) return `${m(from).replace(/ \d{4}$/, "")} – ${m(to)}`;
  return from ? `since ${m(from)}` : `until ${m(to!)}`;
};

export function buildOverview(ix: ConsoleIndex, f: ConsoleFilters) {
  const { src } = ix;

  /* ── funnel: one cohort, each stage a strict subset ───────────────── */
  const contacted = ix.contacted.size;
  const replied = ix.cohortRepliedLeads.size;
  const positive = ix.cohortPositiveLeads.size;

  // How many of the contacted got a follow-up. A reply STOPS the flow, so
  // this is context beside the funnel, never a stage inside it.
  const msgsPerLead = new Map<string, number>();
  for (const m of ix.msgsWin) if (m.lead_id) msgsPerLead.set(m.lead_id, (msgsPerLead.get(m.lead_id) ?? 0) + 1);
  const once = [...msgsPerLead.values()].filter(n => n === 1).length;
  const twicePlus = [...msgsPerLead.values()].filter(n => n >= 2).length;

  const funnel = {
    stages: [
      { key: "contacted", label: "Contacted", n: contacted,
        delta: delta(contacted, ix.contactedPrior.size || null),
        def: "Leads that received at least one message in this period. Deduplicated by lead." },
      { key: "replied", label: "Replied", n: replied,
        delta: delta(replied, ix.priorRepliedLeads.size || null),
        def: "Of the contacted cohort, the leads that wrote back within the period on LinkedIn, email or WhatsApp. A logged call outcome is not a reply." },
      { key: "positive", label: "Positive", n: positive,
        delta: delta(positive, ix.priorPositiveLeads.size || null),
        def: "Replies classified positive or meeting-intent, from leads inside the contacted cohort." },
    ],
    notAdvanced: [
      { n: once, text: "of the contacted received a single message" },
      { n: twicePlus, text: "received two or more" },
      { n: ix.cohortReplies.filter(r => !isPositiveReply(r)).length, text: "replies were not classified positive" },
    ],
    cohortNote: ix.outsideCohort > 0
      ? `${ix.outsideCohort} further ${ix.outsideCohort === 1 ? "reply" : "replies"} arrived in this period from leads contacted before it, so they sit outside this cohort.`
      : "",
  };

  /* ── reply rates: the SAME measurement, comparable ────────────────── */
  const perChannel = (key: ChKey) => {
    const sentMsgs = ix.msgsWin.filter(m => touchKey(m) === key);
    const reached = new Set(sentMsgs.map(m => m.lead_id).filter((x): x is string => !!x));
    // Same-channel replies only: an email reply does not validate a DM.
    const wanted = key === "email" ? "email" : "linkedin";
    const replies = new Set(ix.cohortReplies
      .filter(r => (r.channel ?? "").toLowerCase() === wanted && r.lead_id && reached.has(r.lead_id))
      .map(r => r.lead_id as string));
    return { sent: sentMsgs.length, reached: reached.size, replies: replies.size,
             rate: roundRate(reached.size ? (replies.size / reached.size) * 100 : null) };
  };
  const dm = perChannel("li_dm"), email = perChannel("email");

  const replyRates = {
    title: "Reply rates",
    note: "same measurement, comparable",
    rows: [
      { key: "dm", label: "LinkedIn DM", icon: "dm" as const, ...dm, rate: dm.rate ?? 0, delta: null as Delta },
      { key: "email", label: "Email", icon: "email" as const, ...email, rate: email.rate ?? 0, delta: null as Delta },
    ],
  };

  /* ── other channel metrics: each a DIFFERENT measurement ──────────── */
  // The canonical helpers, not a local re-derivation. Resolving the lead
  // through the CAMPAIGN (not campaign_messages.lead_id) is what makes this
  // agree with every other surface: my first pass read 14/622 where the
  // shared rule reads 10/617.
  const connectedLeads = new Set(src.leads.filter(l => l.linkedin_connected).map(l => l.id));
  const invitedIds = invitedLeadIds(
    ix.msgsWin.filter(m => ix.leadInScope(m.lead_id)) as any, ix.leadOfCampaign, ix.win);
  const acceptance = linkedinAcceptance(invitedIds, connectedLeads);
  const invited = invitedIds;
  const accepted = acceptance.accepted;
  const calls = callMetrics(ix.callGroups);

  const otherChannel = {
    title: "Other channel metrics",
    note: "different measurement each — not reply rates",
    rows: [
      { key: "invites", label: "LinkedIn invitation acceptance", icon: "in" as const,
        value: roundRate(acceptance.rate) ?? 0,
        num: accepted, den: acceptance.invited, unit: "accepted",
        basis: acceptance.caveat,
        delta: null as Delta,
        caveat: "acceptance has no timestamp, so this is anchored on the invitation date" },
      // The canonical five. Unknown is stated in the caveat and never folded
      // into the denominator.
      { key: "calls", label: "Confirmed connect rate", icon: "call" as const,
        value: calls.confirmedConnectRate == null ? 0 : Math.round(calls.confirmedConnectRate * 10) / 10,
        num: calls.confirmedConnected, den: calls.confirmedConnected + calls.confirmedNotConnected,
        unit: "confirmed connected",
        basis: "distinct physical calls with a human outcome logged",
        delta: null as Delta,
        caveat: `${calls.unknown} of the ${calls.attempted} attempted have no outcome logged and are excluded from the rate` },
    ],
  };

  const linkedinNote = {
    title: "LinkedIn invitation acceptance deserves attention",
    facts: [
      `${accepted} of ${acceptance.invited} invitations sent this period have been accepted (${roundRate(acceptance.rate) ?? 0}%).`,
      `LinkedIn DMs reached ${dm.reached} leads and ${dm.replies} of them replied (${dm.rate ?? 0}%).`,
      `Email reached ${email.reached} leads and ${email.replies} of them replied (${email.rate ?? 0}%).`,
    ],
  };

  /* ── ranked lists ─────────────────────────────────────────────────── */
  const rankBy = <K extends string>(keyOf: (leadId: string) => K | null, floor: number) => {
    const acc = new Map<K, { contacted: Set<string>; replies: Set<string> }>();
    for (const id of ix.contacted) {
      const k = keyOf(id); if (k == null) continue;
      const e = acc.get(k) ?? { contacted: new Set<string>(), replies: new Set<string>() };
      e.contacted.add(id); acc.set(k, e);
    }
    for (const id of ix.cohortRepliedLeads) {
      const k = keyOf(id); if (k == null) continue;
      acc.get(k)?.replies.add(id);
    }
    return [...acc.entries()]
      .filter(([, v]) => v.contacted.size >= floor)
      .map(([k, v]) => ({ name: String(k), contacted: v.contacted.size, replies: v.replies.size,
                          rate: roundRate((v.replies.size / v.contacted.size) * 100) ?? 0 }))
      .sort((a, b) => b.rate - a.rate || b.contacted - a.contacted);
  };

  const FLOOR = 20;
  const campaigns = rankBy(id => ix.campNameOfLead(id), FLOOR);
  const totalCampaigns = new Set([...ix.contacted].map(id => ix.campNameOfLead(id)).filter(Boolean)).size;
  const sellers = rankBy(id => {
    const sid = ix.campOfLead.get(id)?.seller_id ?? null;
    return sid ? ix.sellerById.get(sid)?.name ?? null : null;
  }, 0);

  /* ── reply quality ────────────────────────────────────────────────── */
  const cls = (c: string | null) => (c ?? "").toLowerCase();
  const q = (names: string[]) => ix.inboundWin.filter(r => names.includes(cls(r.classification))).length;
  const replyQuality = {
    events: ix.inboundWin.length,
    leads: new Set(ix.inboundWin.map(r => r.lead_id).filter(Boolean)).size,
    rows: [
      { label: "Not interested", n: q(["negative", "not_interested"]), tone: "bad" as const },
      { label: "Needs info", n: q(["needs_info"]), tone: "info" as const },
      { label: "Follow up", n: q(["follow_up"]), tone: "neutral" as const },
      { label: "Interested", n: q(["positive", "meeting_intent", "interested"]), tone: "good" as const },
      { label: "Auto-reply", n: q(["auto_reply", "ooo"]), tone: "muted" as const },
    ],
    note: "",
  };
  replyQuality.note = `${replyQuality.events} replies from ${replyQuality.leads} leads — a lead can reply more than once, so events exceed leads.`;

  /* ── daily activity, both windows ─────────────────────────────────── */
  const days: string[] = [];
  if (ix.win.fromMs !== null && ix.win.toMs !== null) {
    for (let t = ix.win.fromMs; t <= ix.win.toMs; t += 86_400_000) days.push(businessDayKey(new Date(t).toISOString()));
  }
  const series = (rows: { d: string | null }[]) => {
    const m = new Map(days.map(d => [d, 0]));
    for (const r of rows) { if (!r.d) continue; const k = businessDayKey(r.d); if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1); }
    return days.map(d => m.get(d) ?? 0);
  };
  const activity = {
    sent: series(ix.msgsWin.map(m => ({ d: m.sent_at }))),
    replies: series(ix.inboundWin.map(r => ({ d: r.received_at }))),
    prior: ix.prior ? (() => {
      const pdays: string[] = [];
      for (let t = ix.prior.fromMs!; t <= ix.prior.toMs!; t += 86_400_000) pdays.push(businessDayKey(new Date(t).toISOString()));
      const m = new Map(pdays.map(d => [d, 0]));
      for (const x of ix.msgsPrior) { const k = businessDayKey(x.sent_at); if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1); }
      return pdays.map(d => m.get(d) ?? 0);
    })() : [],
    totals: { sent: ix.msgsWin.length, replies: ix.inboundWin.length },
  };

  /* ── when replies land: 7 days × 5 blocks ─────────────────────────── */
  const BLOCKS = ["9–12", "12–15", "15–18", "18–21", "other"];
  const blockOf = (h: number | null) => {
    if (h == null) return 4;
    if (h >= 9 && h < 12) return 0;
    if (h >= 12 && h < 15) return 1;
    if (h >= 15 && h < 18) return 2;
    if (h >= 18 && h < 21) return 3;
    return 4;
  };
  const grid = Array.from({ length: 7 }, () => Array(5).fill(0) as number[]);
  for (const r of ix.inboundWin) {
    const wd = businessWeekday(r.received_at);   // 0 = Sunday
    if (wd == null) continue;
    grid[(wd + 6) % 7][blockOf(businessHour(r.received_at))]++;  // Monday-first
  }
  const timing = { tz: "America/Buenos_Aires", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], blocks: BLOCKS, grid, total: ix.inboundWin.length };

  /* ── workspace stock: the three parts PARTITION the total ─────────── */
  const visible = (id: string | null | undefined): id is string =>
    !!id && (!ix.assignedLeadIds || ix.assignedLeadIds.has(id));
  const everContacted = new Set(src.msgs.filter(m => m.status === "sent" && visible(m.lead_id)).map(m => m.lead_id as string));
  const enrolled = new Set(src.camps.map(c => c.lead_id).filter(visible));
  const total = ix.assignedLeadIds ? ix.assignedLeadIds.size : src.leads.length;
  const inFlowNeverMessaged = [...enrolled].filter(id => !everContacted.has(id)).length;
  const workspace = {
    total,
    parts: [
      { label: "contacted at some point", n: everContacted.size },
      { label: "in a flow, never messaged", n: inFlowNeverMessaged },
      { label: "never enrolled", n: total - everContacted.size - inFlowNeverMessaged },
    ],
    intake: { n: src.leads.filter(l => visible(l.id) && inWindow(l.created_at, ix.win)).length, label: "added during this period" },
  };

  return {
    period: {
      label: f.from && f.to ? "Selected period" : "All time",
      range: fmtRange(f.from, f.to),
      prior: ix.prior ? fmtRange(businessDayKey(new Date(ix.prior.fromMs!).toISOString()), businessDayKey(new Date(ix.prior.toMs!).toISOString())) : "—",
      presets: ["Today", "7 days", "30 days", "90 days", "All time"],
    },
    funnel, replyRates, otherChannel, linkedinNote,
    rankedBy: "Reply rate",
    campaigns,
    campaignsNote: `${totalCampaigns} campaigns sent in this period. Those with fewer than ${FLOOR} leads contacted are not shown — a rate off a handful of leads is noise.`,
    sellers,
    sellersNote: "Attribution is by the flow's assigned seller. Replies that arrive without a flow cannot be attributed and are excluded, not spread across the rows.",
    replyQuality, activity, timing, workspace,
    // {id, label} pairs: the dropdowns send the id the server filters on.
    // Campaigns filter by NAME (the wizard groups flows by name); ICPs and
    // sellers by id. A label-only list could not do that.
    filters: {
      campaigns: [{ id: "", label: "All campaigns" },
        ...[...new Set(src.camps.map(c => c.name).filter((x): x is string => !!x))].sort()
          .map(n => ({ id: n, label: n }))],
      icps: [{ id: "", label: "All ICPs" },
        ...src.icps.map(i => ({ id: i.id, label: i.profile_name ?? "—" }))
          .sort((a, b) => a.label.localeCompare(b.label))],
      sellers: [{ id: "", label: "All sellers" },
        ...src.sellers.filter(s => s.active !== false).map(s => ({ id: s.id, label: s.name }))
          .sort((a, b) => a.label.localeCompare(b.label))],
    },
    /** What is selected right now, so the controls can render their state. */
    active: {
      preset: f.preset ?? null,
      from: f.from, to: f.to,
      campaign: f.campaignNames?.[0] ?? "",
      icp: f.icpIds?.[0] ?? "",
      seller: f.sellerIds?.[0] ?? "",
    },
  };
}
export type OverviewData = ReturnType<typeof buildOverview>;

/* ═══════════════════════════════════════════════════════════════════════
   THE FIVE OTHER TABS — the `T` shape.
   ═══════════════════════════════════════════════════════════════════════ */

const rate = (num: number, den: number) => (den > 0 ? roundRate((num / den) * 100) ?? 0 : 0);

/** touch = contact points that went out · reach = distinct leads they hit. */
function touchAndReach(msgs: MsgRow[], groups: CallGroupView[]) {
  const touch = zeroTouch();
  const reach: Record<ChKey, Set<string>> = { li_cr: new Set(), li_dm: new Set(), email: new Set(), call: new Set() };
  for (const m of msgs) {
    const k = touchKey(m); if (!k || k === "call") continue;
    touch[k]++; if (m.lead_id) reach[k].add(m.lead_id);
  }
  // Calls come from `calls`, never from the sequence — which is why a flow
  // can show calls without owning a call step.
  for (const g of groups) { touch.call++; if (g.leadId) reach.call.add(g.leadId); }
  return { touch, reach: { li_cr: reach.li_cr.size, li_dm: reach.li_dm.size, email: reach.email.size, call: reach.call.size } as Touch, reachSets: reach };
}

/* ── the row types and constants components import at module scope ────── */
export type IcpRow = TabsData["icps"][number];
export type CampaignRow = TabsData["campaigns"][number];
export type Step = CampaignRow["steps"][number];
export type ChannelCard = TabsData["channelCards"][number];
export type Seller = TabsData["sellers"][number];
export type SellerCall = TabsData["sellerCalls"][number];
export type FlowDetail = TabsData["flowDetail"][string];

/** Below this many contacted leads a flow shows counts but no percentage. */
export const RATE_FLOOR = 25;
/** A rate is only ranked above this many contacted leads. */
export const MIN_SAMPLE = 100;

export function buildTabs(ix: ConsoleIndex) {
  const { src } = ix;
  const repliedLeads = ix.cohortRepliedLeads;
  const positiveLeads = ix.cohortPositiveLeads;

  /* ── ICPs ──────────────────────────────────────────────────────────── */
  const icpKey = (leadId: string) => ix.icpOfLead(leadId) ?? "_none";
  const icpBuckets = new Map<string, { leads: Set<string>; msgs: MsgRow[]; calls: CallGroupView[] }>();
  const bucket = (m: Map<string, any>, k: string) => m.get(k) ?? m.set(k, { leads: new Set<string>(), msgs: [], calls: [] }).get(k);
  for (const id of ix.contacted) bucket(icpBuckets, icpKey(id)).leads.add(id);
  for (const m of ix.msgsWin) if (m.lead_id) bucket(icpBuckets, icpKey(m.lead_id)).msgs.push(m);
  for (const g of ix.callGroups) if (g.leadId) bucket(icpBuckets, icpKey(g.leadId)).calls.push(g);

  const icpRows = [...icpBuckets.entries()].map(([id, b]) => {
    const { touch, reach, reachSets } = touchAndReach(b.msgs, b.calls);
    const replies = [...b.leads].filter(l => repliedLeads.has(l)).length;
    // Of the leads reached on that channel, how many replied AT ALL. A lead
    // reached on two channels counts in both, so columns do not add up.
    const replied = zeroTouch();
    for (const k of CH_KEYS) for (const l of reachSets[k]) if (repliedLeads.has(l)) replied[k]++;
    return {
      name: id === "_none" ? "No ICP" : ix.icpName.get(id) ?? id.slice(0, 8),
      contacted: b.leads.size, replies, positive: [...b.leads].filter(l => positiveLeads.has(l)).length,
      rate: rate(replies, b.leads.size), touch, reach, replied,
    };
  }).filter(r => r.contacted > 0).sort((a, b) => b.rate - a.rate || b.contacted - a.contacted);

  const icpsTotals = {
    contacted: ix.contacted.size, replies: repliedLeads.size, positive: positiveLeads.size,
    rate: rate(repliedLeads.size, ix.contacted.size),
    touch: icpRows.reduce((a, r) => { for (const k of CH_KEYS) a[k] += r.touch[k]; return a; }, zeroTouch()),
  };

  /* ── Campaigns, grouped by ICP ─────────────────────────────────────── */
  const campBuckets = new Map<string, { camp: CampRow; leads: Set<string>; enrolled: Set<string>; msgs: MsgRow[]; calls: CallGroupView[] }>();
  for (const c of src.camps) {
    if (!c.name) continue;
    const e = campBuckets.get(c.name) ?? { camp: c, leads: new Set<string>(), enrolled: new Set<string>(), msgs: [], calls: [] };
    if (c.lead_id) e.enrolled.add(c.lead_id);
    campBuckets.set(c.name, e);
  }
  for (const id of ix.contacted) { const n = ix.campNameOfLead(id); if (n && campBuckets.has(n)) campBuckets.get(n)!.leads.add(id); }
  for (const m of ix.msgsWin) { const n = m.lead_id ? ix.campNameOfLead(m.lead_id) : null; if (n && campBuckets.has(n)) campBuckets.get(n)!.msgs.push(m); }
  for (const g of ix.callGroups) { const n = g.campaignName; if (n && campBuckets.has(n)) campBuckets.get(n)!.calls.push(g); }

  const campaignRows = [...campBuckets.entries()].filter(([, b]) => b.leads.size > 0).map(([name, b]) => {
    const { touch } = touchAndReach(b.msgs, b.calls);
    const replies = [...b.leads].filter(l => repliedLeads.has(l)).length;
    const perLead = new Map<string, number>();
    for (const m of b.msgs) if (m.lead_id) perLead.set(m.lead_id, (perLead.get(m.lead_id) ?? 0) + 1);
    // Steps carry the CHANNEL, not just the number: "replied at step 2" is
    // meaningless until you know step 2 was a DM.
    const stepAgg = new Map<string, { step: number; ch: ChKey; sent: number; leads: Set<string>; replied: Set<string> }>();
    for (const m of b.msgs) {
      const ch = touchKey(m); if (!ch) continue;
      const step = m.step_number ?? 0;
      const k = `${step}|${ch}`;
      const e = stepAgg.get(k) ?? { step, ch, sent: 0, leads: new Set<string>(), replied: new Set<string>() };
      e.sent++; if (m.lead_id) { e.leads.add(m.lead_id); if (repliedLeads.has(m.lead_id)) e.replied.add(m.lead_id); }
      stepAgg.set(k, e);
    }
    const calls = callMetrics(b.calls);
    return {
      name, icp: ix.icpName.get(ix.icpOfLead([...b.leads][0] ?? "") ?? "") ?? "No ICP",
      status: (b.camp.status === "paused" ? "paused" : b.camp.status === "completed" ? "completed" : "active") as "active" | "paused" | "completed",
      enrolled: b.enrolled.size, contacted: b.leads.size,
      followed: [...perLead.values()].filter(n => n >= 2).length,
      replies, positive: [...b.leads].filter(l => positiveLeads.has(l)).length,
      calls: calls.attempted, connected: calls.confirmedConnected,
      rate: rate(replies, b.leads.size), touch,
      steps: [...stepAgg.values()].sort((a, b2) => a.step - b2.step)
        .map(s => ({ step: s.step, ch: s.ch, sent: s.sent, leads: s.leads.size, replied: s.replied.size })),
    };
  }).sort((a, b) => b.rate - a.rate || b.contacted - a.contacted);

  // Grouped by ICP: comparing a PE flow with an Odoo flow compares two
  // different markets. Inside a group the rates are like-for-like.
  const campaignGroups = [...new Set(campaignRows.map(c => c.icp))].map(icp => {
    const flows = campaignRows.filter(c => c.icp === icp);
    const contacted = flows.reduce((a, f) => a + f.contacted, 0);
    const replies = flows.reduce((a, f) => a + f.replies, 0);
    return {
      icp, flows, contacted, replies,
      calls: flows.reduce((a, f) => a + f.calls, 0),
      touch: flows.reduce((a, f) => { for (const k of CH_KEYS) a[k] += f.touch[k]; return a; }, zeroTouch()),
      rate: rate(replies, contacted),
    };
  }).sort((a, b) => b.rate - a.rate);

  /* ── Channels ──────────────────────────────────────────────────────── */
  const chStats = (k: ChKey) => {
    const msgs = ix.msgsWin.filter(m => touchKey(m) === k);
    const reach = new Set(msgs.map(m => m.lead_id).filter((x): x is string => !!x));
    const wanted = k === "email" ? "email" : "linkedin";
    const replies = new Set(ix.cohortReplies.filter(r => (r.channel ?? "").toLowerCase() === wanted && r.lead_id && reach.has(r.lead_id)).map(r => r.lead_id as string));
    return { sent: msgs.length, reach: reach.size, replies: replies.size, reachSet: reach };
  };
  const cr = chStats("li_cr"), dmS = chStats("li_dm"), em = chStats("email");
  const connectedLeads = new Set(src.leads.filter(l => l.linkedin_connected).map(l => l.id));
  const crAccepted = [...cr.reachSet].filter(id => connectedLeads.has(id)).length;
  const callTotals = callMetrics(ix.callGroups);
  const outcomeCount = (names: string[]) => ix.callGroups.filter(g => names.includes((g.classification ?? "").toLowerCase())).length;

  const channelCards = [
    { key: "li_cr" as ChKey, label: "LinkedIn invitation", icon: "in" as const,
      sent: cr.sent, sentLabel: "invitations sent", reach: cr.reach, reachLabel: "leads invited",
      result: crAccepted, resultLabel: "accepted", rate: rate(crAccepted, cr.reach), rateLabel: "accept rate",
      delta: null as Delta, comparable: false,
      outcomes: [{ label: "Accepted", n: crAccepted, tone: "good" as const },
                 { label: "Still pending", n: Math.max(0, cr.reach - crAccepted), tone: "muted" as const }],
      caveat: "acceptance has no timestamp; anchored on the invitation date" },
    { key: "li_dm" as ChKey, label: "LinkedIn DM", icon: "dm" as const,
      sent: dmS.sent, sentLabel: "messages sent", reach: dmS.reach, reachLabel: "leads reached",
      result: dmS.replies, resultLabel: "replied", rate: rate(dmS.replies, dmS.reach), rateLabel: "reply rate",
      delta: null as Delta, comparable: true, outcomes: [], caveat: "" },
    { key: "email" as ChKey, label: "Email", icon: "email" as const,
      sent: em.sent, sentLabel: "emails sent", reach: em.reach, reachLabel: "leads reached",
      result: em.replies, resultLabel: "replied", rate: rate(em.replies, em.reach), rateLabel: "reply rate",
      delta: null as Delta, comparable: true, outcomes: [], caveat: "" },
    // Calls: the canonical five. Never "connect rate" without Unknown beside it.
    { key: "call" as ChKey, label: "Calls", icon: "call" as const,
      sent: callTotals.attempted, sentLabel: "calls attempted", reach: new Set(ix.callGroups.map(g => g.leadId).filter(Boolean)).size, reachLabel: "leads dialled",
      result: callTotals.confirmedConnected, resultLabel: "confirmed connected",
      rate: callTotals.confirmedConnectRate == null ? null : Math.round(callTotals.confirmedConnectRate * 10) / 10,
      rateLabel: "confirmed connect rate", delta: null as Delta, comparable: false,
      outcomes: [
        { label: "Interested", n: outcomeCount(["positive", "meeting_intent", "interested"]), tone: "good" as const },
        { label: "Follow up", n: outcomeCount(["follow_up", "callback", "needs_info"]), tone: "neutral" as const },
        { label: "Not interested", n: outcomeCount(["negative", "not_interested"]), tone: "bad" as const },
        { label: "Voicemail", n: outcomeCount(["voicemail"]), tone: "muted" as const },
        { label: "Wrong number", n: outcomeCount(["wrong_number"]), tone: "muted" as const },
        { label: "Unknown", n: callTotals.unknown, tone: "muted" as const },
      ],
      caveat: `${callTotals.unknown} of ${callTotals.attempted} have no human outcome and are excluded from the rate` },
  ];

  /* ── Sellers ───────────────────────────────────────────────────────── */
  const sellerRows = src.sellers.filter(s => s.active !== false).map(s => {
    const leads = new Set([...ix.contacted].filter(id => ix.campOfLead.get(id)?.seller_id === s.id));
    const msgs = ix.msgsWin.filter(m => m.lead_id && ix.campOfLead.get(m.lead_id)?.seller_id === s.id);
    const t = zeroTouch();
    for (const m of msgs) { const k = touchKey(m); if (k) t[k]++; }
    const replies = [...leads].filter(l => repliedLeads.has(l)).length;
    const myCalls = ix.callGroups.filter(g => g.sellerId === s.id);
    const queue = src.msgs.filter(m => (m.status === "queued" || m.status === "pending")
      && m.lead_id && ix.campOfLead.get(m.lead_id)?.seller_id === s.id).length;
    const last = msgs.map(m => m.sent_at).filter(Boolean).sort().pop() ?? null;
    return {
      name: s.name, contacted: leads.size,
      li: t.li_cr + t.li_dm, cr: t.li_cr, dm: t.li_dm, email: t.email,
      sent: msgs.length, calls: myCalls.length,
      replies, replyRate: rate(replies, leads.size),
      positive: [...leads].filter(l => positiveLeads.has(l)).length,
      queue,
      lastActive: last ? new Date(last).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
    };
  }).sort((a, b) => b.contacted - a.contacted);

  // Calls by seller — the canonical split, with Unknown as its own column.
  //
  // Built from the CALLS, not from the seller list: a call owned by an
  // inactive seller, or by nobody, must still appear. Iterating active
  // sellers dropped one call and the team row read 409 against a workspace
  // of 410 — Unattributed is a row, never a rounding error.
  const callOwners = new Map<string, string>();
  for (const s of src.sellers) callOwners.set(s.id, s.name);
  const ownerKeys = [...new Set(ix.callGroups.map(g => g.sellerId ?? "UNATTRIBUTED"))];
  for (const s of src.sellers) if (s.active !== false && !ownerKeys.includes(s.id)) ownerKeys.push(s.id);
  const sellerCalls = ownerKeys.map(key => {
    const s = { id: key, name: key === "UNATTRIBUTED" ? "Unattributed" : callOwners.get(key) ?? key.slice(0, 8) };
    const mine = ix.callGroups.filter(g => (g.sellerId ?? "UNATTRIBUTED") === key);
    const m = callMetrics(mine);
    const c = (names: string[]) => mine.filter(g => names.includes((g.classification ?? "").toLowerCase())).length;
    const withDur = mine.filter(g => g.duration > 0);
    return {
      name: s.name,
      attempted: m.attempted, connected: m.confirmedConnected,
      // null, not 0: nobody with zero classified calls "connected 0% of the
      // time" — there is simply nothing to divide.
      connectRate: m.confirmedConnectRate == null ? null : Math.round(m.confirmedConnectRate),
      interested: c(["positive", "meeting_intent", "interested"]),
      followUp: c(["follow_up", "callback", "needs_info"]),
      negative: c(["negative", "not_interested"]),
      noAnswer: m.confirmedNotConnected,
      unclassified: m.unknown,
      voicemail: c(["voicemail"]), wrongNumber: c(["wrong_number"]),
      recorded: withDur.length,
      avgSecs: withDur.length ? Math.round(withDur.reduce((a, g) => a + g.duration, 0) / withDur.length) : 0,
      activeDays: new Set(mine.map(g => g.day)).size,
    };
  }).sort((a, b) => b.attempted - a.attempted);

  const sct = sellerCalls.reduce((a, s) => {
    for (const k of ["attempted", "connected", "interested", "followUp", "negative", "noAnswer", "unclassified"] as const) a[k] += s[k];
    return a;
  }, { attempted: 0, connected: 0, interested: 0, followUp: 0, negative: 0, noAnswer: 0, unclassified: 0 });
  const sellerCallsTotal = { ...sct, name: "Team",
    connectRate: sct.connected + sct.noAnswer > 0 ? rate(sct.connected, sct.connected + sct.noAnswer) : null };

  // Daily activity per seller: messages and calls, per business day.
  const dayKeys = [...new Set([...ix.msgsWin.map(m => businessDayKey(m.sent_at)), ...ix.callGroups.map(g => g.day)])].filter(Boolean).sort();

  // Two parallel series per seller, one slot per day of the window — the
  // shape the activity strip reads. Built from every day in the window, not
  // only the days with traffic, so a silent day is a visible gap.
  const windowDays: string[] = [];
  if (ix.win.fromMs !== null && ix.win.toMs !== null) {
    for (let t = ix.win.fromMs; t <= ix.win.toMs; t += 86_400_000) windowDays.push(businessDayKey(new Date(t).toISOString()));
  }
  const sellerDaily: Record<string, { sent: number[]; calls: number[] }> = {};
  for (const s of src.sellers.filter(x => x.active !== false)) {
    const sent = new Map(windowDays.map(d => [d, 0]));
    const calls = new Map(windowDays.map(d => [d, 0]));
    for (const m of ix.msgsWin) {
      if (!m.lead_id || ix.campOfLead.get(m.lead_id)?.seller_id !== s.id) continue;
      const d = businessDayKey(m.sent_at); if (sent.has(d)) sent.set(d, sent.get(d)! + 1);
    }
    for (const g of ix.callGroups) {
      if (g.sellerId !== s.id) continue;
      if (calls.has(g.day)) calls.set(g.day, calls.get(g.day)! + 1);
    }
    sellerDaily[s.name] = { sent: windowDays.map(d => sent.get(d) ?? 0), calls: windowDays.map(d => calls.get(d) ?? 0) };
  }

  const teamHealth = {
    activeSellers: sellerRows.filter(s => s.contacted > 0 || s.calls > 0).length,
    totalSellers: sellerRows.length,
    contacted: ix.contacted.size,
    sent: ix.msgsWin.length,
    calls: callTotals.attempted,
    replies: repliedLeads.size,
    positive: positiveLeads.size,
    replyRate: rate(repliedLeads.size, ix.contacted.size),
    // The canonical five, never "connect rate" on its own.
    confirmedConnected: callTotals.confirmedConnected,
    confirmedNotConnected: callTotals.confirmedNotConnected,
    unknown: callTotals.unknown,
    connectRate: callTotals.confirmedConnectRate == null ? null : Math.round(callTotals.confirmedConnectRate * 10) / 10,
    queue: sellerRows.reduce((a, s) => a + s.queue, 0),
    /** replies in the window no flow can be tied to — never redistributed */
    unattributedReplies: ix.cohortReplies.filter(r => !r.lead_id || !ix.campOfLead.get(r.lead_id)).length,
  };

  /* ── flow drilldown, on THAT FLOW'S OWN cohort ─────────────────────── */
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return Math.round((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) * 10) / 10;
  };
  const flowDetail: Record<string, {
    replyCh: { linkedin: number; email: number };
    replyCls: { positive: number; needsInfo: number; followUp: number; negative: number };
    replyLeads: number; replyEvents: number; medianDays: number | null;
    calls: number; connected: number;
    callCls: { positive: number; needsInfo: number; followUp: number; negative: number; voicemail: number; wrongNumber: number; unclassified: number };
    status: { active: number; completed: number; closedLost: number };
  }> = {};
  for (const [name, b] of campBuckets) {
    if (b.leads.size === 0) continue;
    const events = ix.inboundWin.filter(r => r.lead_id && b.leads.has(r.lead_id));
    const cl = (c: string | null) => (c ?? "").toLowerCase();
    const firstMsg = new Map<string, number>();
    for (const m of b.msgs) {
      if (!m.lead_id || !m.sent_at) continue;
      const t = Date.parse(m.sent_at);
      if (!firstMsg.has(m.lead_id) || t < firstMsg.get(m.lead_id)!) firstMsg.set(m.lead_id, t);
    }
    const lags: number[] = [];
    const firstReply = new Map<string, number>();
    for (const r of events) {
      if (!r.lead_id || !r.received_at) continue;
      const t = Date.parse(r.received_at);
      if (!firstReply.has(r.lead_id) || t < firstReply.get(r.lead_id)!) firstReply.set(r.lead_id, t);
    }
    for (const [lid, t] of firstReply) { const f = firstMsg.get(lid); if (f && t >= f) lags.push((t - f) / 86_400_000); }
    const cc = (names: string[]) => b.calls.filter(g => names.includes(cl(g.classification))).length;
    const m = callMetrics(b.calls);
    const statusOf = (lid: string) => ix.campOfLead.get(lid)?.status ?? "active";
    flowDetail[name] = {
      replyCh: {
        linkedin: events.filter(r => cl(r.channel) === "linkedin").length,
        email: events.filter(r => cl(r.channel) === "email").length,
      },
      replyCls: {
        positive: events.filter(r => ["positive", "meeting_intent"].includes(cl(r.classification))).length,
        needsInfo: events.filter(r => cl(r.classification) === "needs_info").length,
        followUp: events.filter(r => cl(r.classification) === "follow_up").length,
        negative: events.filter(r => ["negative", "not_interested"].includes(cl(r.classification))).length,
      },
      replyLeads: new Set(events.map(r => r.lead_id)).size,
      replyEvents: events.length,
      medianDays: median(lags),
      calls: m.attempted, connected: m.confirmedConnected,
      callCls: {
        positive: cc(["positive", "meeting_intent", "interested"]), needsInfo: cc(["needs_info"]),
        followUp: cc(["follow_up", "callback"]), negative: cc(["negative", "not_interested"]),
        voicemail: cc(["voicemail"]), wrongNumber: cc(["wrong_number"]), unclassified: m.unknown,
      },
      status: {
        active: [...b.leads].filter(l => statusOf(l) === "active").length,
        completed: [...b.leads].filter(l => statusOf(l) === "completed").length,
        closedLost: [...b.leads].filter(l => statusOf(l) === "closed_lost").length,
      },
    };
  }

  /* ── alerts and insights, derived — never hand-written ─────────────── */
  const totalQueue = sellerRows.reduce((a, s) => a + s.queue, 0);
  const topQueue = [...sellerRows].sort((a, b) => b.queue - a.queue)[0];
  const noCalls = sellerCalls.filter(s => s.attempted === 0 && s.name !== "Unattributed").length;
  const teamAlerts: { level: "warn" | "info"; text: string }[] = [];
  if (callTotals.attempted > 0 && callTotals.unknown > 0)
    teamAlerts.push({ level: "warn", text: `${callTotals.unknown} of ${callTotals.attempted} calls have no outcome logged (${rate(callTotals.unknown, callTotals.attempted)}%)` });
  if (noCalls > 0) teamAlerts.push({ level: "warn", text: `${noCalls} of ${sellerCalls.length - 1} sellers made no calls` });
  if (topQueue && totalQueue > 0 && topQueue.queue / totalQueue > 0.5)
    teamAlerts.push({ level: "warn", text: `${topQueue.name} holds ${topQueue.queue.toLocaleString()} of ${totalQueue.toLocaleString()} queued messages (${rate(topQueue.queue, totalQueue)}%)` });
  const unattributedCalls = sellerCalls.find(s => s.name === "Unattributed")?.attempted ?? 0;
  if (unattributedCalls > 0) teamAlerts.push({ level: "info", text: `${unattributedCalls} call${unattributedCalls === 1 ? "" : "s"} could not be attributed to a seller` });
  if (ix.outsideCohort > 0) teamAlerts.push({ level: "info", text: `${ix.outsideCohort} replies came from leads contacted before this period` });

  const ranked = sellerRows.filter(s => s.contacted >= MIN_SAMPLE).sort((a, b) => b.replyRate - a.replyRate)[0];
  const byVolume = [...sellerRows].sort((a, b) => b.contacted - a.contacted)[0];
  const byCalls = [...sellerCalls].sort((a, b) => b.attempted - a.attempted)[0];
  const byUnknown = [...sellerCalls].sort((a, b) => b.unclassified - a.unclassified)[0];
  const sellerInsights: { label: string; who: string; value: string; note: string; tone?: "warn" }[] = [];
  if (ranked) sellerInsights.push({ label: "Highest reply rate", who: ranked.name, value: `${ranked.replyRate}%`, note: `${ranked.replies} of ${ranked.contacted} contacted · min ${MIN_SAMPLE} to rank` });
  if (byVolume) sellerInsights.push({ label: "Highest volume", who: byVolume.name, value: byVolume.contacted.toLocaleString(), note: `contacted · ${rate(byVolume.contacted, ix.contacted.size)}% of the team` });
  if (byCalls && byCalls.attempted > 0) sellerInsights.push({ label: "Most calls", who: byCalls.name, value: String(byCalls.attempted), note: `of ${callTotals.attempted} team dials` });
  if (byUnknown && byUnknown.unclassified > 0) sellerInsights.push({ label: "Needs attention", who: byUnknown.name, value: String(byUnknown.unclassified), note: "calls with no outcome logged", tone: "warn" as const });

  // toMs is the END of the last day, so the span already includes it.
  // Rounding up and then adding one produced 31 days for a 30-day window,
  // one more slot than the activity strip actually draws.
  const nDays = ix.win.fromMs !== null && ix.win.toMs !== null
    ? Math.round((ix.win.toMs - ix.win.fromMs) / 86_400_000) : dayKeys.length;
  const fmtShort = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return {
    icps: icpRows, icpsTotals,
    icpsNote: `${icpRows.length} ICPs sent in this period and all ${icpRows.length} are listed — none is hidden behind a volume floor. The cohort is the ${ix.contacted.size.toLocaleString()} leads contacted in the window, so an ICP whose leads were loaded months ago still appears.`,
    icpTouchNote: "Contact points, not leads: the large number is how many went out, the small one how many distinct people received them. Calls come from the calls table rather than the sequence, which is why a flow can show calls without having a call step.",
    icpMatrixNote: "Read a cell as: of the leads this ICP reached on that channel, how many replied at all. A lead reached on two channels is counted in both, so the columns do not add up to the ICP total.",
    icpWorthALook: {
      title: icpRows.length ? `${icpRows[0].name} has the highest reply rate` : "No ICP sent in this period",
      facts: icpRows.slice(0, 3).map(r => `${r.name}: ${r.replies} of ${r.contacted} contacted replied (${r.rate}%), on ${(r.touch.li_cr + r.touch.li_dm + r.touch.email + r.touch.call).toLocaleString()} contact points.`),
    },
    campaigns: campaignRows, campaignGroups, flowDetail,
    campaignsNote: `${campaignRows.length} flows sent in this period, grouped by ICP so the rates inside a group are like-for-like. Below ${RATE_FLOOR} leads contacted a flow shows counts but no percentage.`,
    flowDetailNote: "Everything here is measured on this flow's own cohort — the leads it contacted in the window — so the detail reconciles with the row above. Median days is from the flow's first message to that lead to their first reply. Calls attach through the lead, not through a step.",
    stepsNote: "Each step shows the channel it actually used. 'Replied at step 2' means nothing until you know step 2 was a DM.",
    campaignsRemoved: "Won and Lost are not shown. The won status has never been set on any flow, and lost mixes a negative reply with a manually closed lead — two different events under one number.",
    channelCards,
    channelWhatsApp: "WhatsApp is wired end-to-end but sent nothing in this period, so it has no card rather than a card of zeros.",
    headToHeadNote: "Only LinkedIn DM and Email are ranked head to head: same measurement, same window, same unit — leads that replied over leads reached. Invitation acceptance and the confirmed connect rate are real numbers with real bases, but they measure different events.",
    channelWorthALook: {
      title: "The two comparable channels are far apart",
      facts: [
        `LinkedIn DM reached ${dmS.reach} leads and ${dmS.replies} replied (${rate(dmS.replies, dmS.reach)}%).`,
        `Email reached ${em.reach.toLocaleString()} leads and ${em.replies} replied (${rate(em.replies, em.reach)}%).`,
        `Calls: ${callTotals.attempted} attempted, ${callTotals.confirmedConnected} confirmed connected, ${callTotals.unknown} with no outcome logged.`,
      ],
    },
    sellers: sellerRows, sellerCalls, sellerCallsTotal, sellerDaily, teamHealth, teamAlerts, sellerInsights,
    WINDOW_DAYS: nDays,
    WINDOW_START: ix.win.fromMs !== null ? fmtShort(ix.win.fromMs) : "—",
    WINDOW_END: ix.win.toMs !== null ? fmtShort(ix.win.toMs) : "—",
    dayKeys,
  };
}
export type TabsData = ReturnType<typeof buildTabs>;
