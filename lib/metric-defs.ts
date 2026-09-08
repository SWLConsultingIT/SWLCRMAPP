// ─────────────────────────────────────────────────────────────────────────
// CANONICAL METRIC DEFINITIONS for Growth Engine.
//
// One place for the rules that the Phase 2 audit found duplicated, drifted
// or simply wrong across lib/dashboard-data.ts, lib/portfolio.ts and the
// dashboard components. Anything that answers "what counts as X" belongs
// here, so a definition can only be changed in one place.
//
// Call rules are NOT redefined here — they live in lib/flow-metrics-lib.ts
// and are re-exported below so callers have a single import.
// ─────────────────────────────────────────────────────────────────────────

import { isRealCall, isConnected, callOutcomeGroup, isPositiveOutcome, type CallRow } from "@/lib/flow-metrics-lib";

export { isRealCall, isConnected, callOutcomeGroup, isPositiveOutcome };
export type { CallRow };

/* ═══════════════════════════════════════════════════════════════════════
   BUSINESS TIMEZONE  (audit Block 6)

   The dashboard had four conventions at once: `T00:00:00Z` date presets,
   a `toArgDay` helper at UTC−3, raw `new Date(iso)` day buckets, and
   client-side `toISOString().slice(0,10)`. 95 sent messages landed in a
   different period depending on which one ran.

   One convention now: America/Argentina/Buenos_Aires. Argentina has not
   observed DST since 2009, so the offset is a constant −180 minutes and we
   can do the arithmetic without Intl on every row (this runs over ~30k
   rows per dashboard load). `BUSINESS_TZ` is exported for display code.
   ═══════════════════════════════════════════════════════════════════════ */

export const BUSINESS_TZ = "America/Argentina/Buenos_Aires";
export const BUSINESS_UTC_OFFSET_MINUTES = -180;
const OFFSET_MS = BUSINESS_UTC_OFFSET_MINUTES * 60_000;

/** The business-local calendar day an instant falls on, as `YYYY-MM-DD`. */
export function businessDayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + OFFSET_MS).toISOString().slice(0, 10);
}

/** Hour of day (0–23) in business time. Used by the reply-timing heatmap. */
export function businessHour(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + OFFSET_MS).getUTCHours();
}

/** Day of week in business time, 0 = Sunday — same convention as
 *  `Date.getDay()`, so existing day-indexed arrays keep their meaning. */
export function businessWeekday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + OFFSET_MS).getUTCDay();
}

/** Epoch ms of 00:00:00.000 business-local on `YYYY-MM-DD`. */
export function businessDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - OFFSET_MS;
}

/** Epoch ms of 23:59:59.999 business-local on `YYYY-MM-DD`. */
export function businessDayEndMs(day: string): number {
  return Date.parse(`${day}T23:59:59.999Z`) - OFFSET_MS;
}

/** Today's business-local date as `YYYY-MM-DD`. */
export function businessToday(now: Date = new Date()): string {
  return businessDayKey(now.toISOString());
}

/** `YYYY-MM-DD` n days before the given business day. */
export function businessDayMinus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export type Window = { fromMs: number | null; toMs: number | null };

/**
 * Turn the `from` / `to` URL params (business-local `YYYY-MM-DD`) into an
 * instant range. Both ends inclusive; either may be null for an open range.
 */
export function resolveWindow(from?: string | null, to?: string | null): Window {
  return {
    fromMs: from ? businessDayStartMs(from) : null,
    toMs: to ? businessDayEndMs(to) : null,
  };
}

/** Is this instant inside the window? The single membership test. */
export function inWindow(iso: string | null | undefined, w: Window): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (w.fromMs !== null && t < w.fromMs) return false;
  if (w.toMs !== null && t > w.toMs) return false;
  return true;
}

/**
 * The window immediately before this one, same length. Returns null when the
 * current window is open-ended — there is no comparable prior period for
 * "All time", and inventing one is what produced the +2522% deltas.
 * (audit Block 7)
 */
export function priorWindow(w: Window): Window | null {
  if (w.fromMs === null || w.toMs === null) return null;
  const span = w.toMs - w.fromMs;
  return { fromMs: w.fromMs - span - 1, toMs: w.fromMs - 1 };
}

/** Preset → business-local date strings, for the filter bar. */
export function presetRange(days: number | null, now: Date = new Date()): { from: string; to: string } | null {
  if (days === null) return null; // all time
  const to = businessToday(now);
  // `days` is the inclusive length of the window, so a 30-day period ends
  // today and starts 29 days earlier.
  const from = businessDayMinus(to, Math.max(0, days - 1));
  return { from, to };
}

/* ═══════════════════════════════════════════════════════════════════════
   REPLIES  (audit Block 3)

   `lead_replies` stores logged CALL OUTCOMES alongside real inbound
   messages. 232 of the 313 rows in the audited window were call outcomes.
   Counting them as replies put the reply rate at 10% against a real 2.8%.

   A call outcome is not a reply. One predicate, used everywhere.
   ═══════════════════════════════════════════════════════════════════════ */

export const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);
// "not_now" (bad timing) is a follow-up, NOT a negative/lost outcome.
export const NEGATIVE_CLASS = new Set(["negative", "unsubscribe"]);

export type ReplyRow = {
  lead_id?: string | null;
  campaign_id?: string | null;
  classification?: string | null;
  channel?: string | null;
  received_at?: string | null;
};

/** A real inbound reply. Excludes logged call outcomes, always. */
export function isInboundReply(r: ReplyRow): boolean {
  return r.channel !== "call";
}

export function isPositiveReply(r: ReplyRow): boolean {
  return isInboundReply(r) && POSITIVE_CLASS.has(r.classification ?? "");
}

export function isNegativeReply(r: ReplyRow): boolean {
  return isInboundReply(r) && NEGATIVE_CLASS.has(r.classification ?? "");
}

/** Distinct leads that replied. The lead-level KPI. */
export function repliedLeadIds(replies: ReplyRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of replies) if (isInboundReply(r) && r.lead_id) out.add(r.lead_id);
  return out;
}

export function positiveLeadIds(replies: ReplyRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of replies) if (isPositiveReply(r) && r.lead_id) out.add(r.lead_id);
  return out;
}

/** Reply EVENTS, not leads. Callers that render this must say "reply events". */
export function replyEventCount(replies: ReplyRow[]): number {
  let n = 0;
  for (const r of replies) if (isInboundReply(r)) n++;
  return n;
}

/* ═══════════════════════════════════════════════════════════════════════
   CONTACTED vs ENROLLED  (audit Block 2)

   The dashboard treated "a campaign row exists for this lead" as Contacted.
   That is Enrolled. 785 leads sit in exactly that gap: enrolled, never
   messaged. Contacted requires a message that actually went out, inside the
   selected period, timestamped by the event itself — not by when the lead
   was loaded (audit Block 1).
   ═══════════════════════════════════════════════════════════════════════ */

export type MessageRow = {
  campaign_id?: string | null;
  status?: string | null;
  sent_at?: string | null;
  step_number?: number | null;
  channel?: string | null;
};

export function isSent(m: MessageRow): boolean {
  return m.status === "sent";
}

/**
 * CONTACTED — distinct leads with ≥1 sent message inside the window.
 * `leadOfCampaign` maps campaign_id → lead_id.
 */
export function contactedLeadIds(
  messages: MessageRow[],
  leadOfCampaign: Map<string, string>,
  w: Window,
): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (!isSent(m) || !m.campaign_id) continue;
    if (!inWindow(m.sent_at, w)) continue;
    const lead = leadOfCampaign.get(m.campaign_id);
    if (lead) out.add(lead);
  }
  return out;
}

/** ENROLLED — distinct leads that have a flow at all. A stock, not activity. */
export function enrolledLeadIds(campaigns: { lead_id?: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const c of campaigns) if (c.lead_id) out.add(c.lead_id);
  return out;
}

/** The one reply-rate formula for the whole product: replied ÷ contacted.
 *  Returns full precision — callers round only at render (see formatRate). */
export function replyRate(repliedLeads: number, contactedLeads: number): number | null {
  if (contactedLeads <= 0) return null;
  return (repliedLeads / contactedLeads) * 100;
}

/* ═══════════════════════════════════════════════════════════════════════
   THE COHORT  (audit RC-3, closed 2026-09-08)

   Every PERFORMANCE surface measures one cohort: the leads contacted inside
   the window. A reply counts for performance only if it came from a lead in
   that cohort. A lead contacted in July that replies in September is real
   inbound work, but it is not this period's cohort performing — folding it
   in makes the funnel stop nesting and the rate divide two different
   universes.

   Those replies do not disappear: `inboundRepliesReceived` counts them as
   inbox workload. They must never be added to a reply rate.
   ═══════════════════════════════════════════════════════════════════════ */

export type CohortReplies = {
  /** Distinct cohort leads with >=1 real inbound reply in the window. */
  leads: Set<string>;
  /** Distinct cohort leads whose reply was classified positive. */
  positive: Set<string>;
  /** Reply EVENTS from cohort leads. Render only as "reply events". */
  events: number;
  /** Inbound replies in the window from leads OUTSIDE the cohort — inbox
   *  workload, never performance. */
  outsideCohortLeads: number;
};

/**
 * The single reply definition for Overview, Funnel, ICPs, Campaigns,
 * Sellers, rankings and comparisons. Pass the cohort and the window's
 * inbound replies; everything downstream reads this.
 */
export function getCohortReplies(cohort: Set<string>, inboundInWindow: ReplyRow[]): CohortReplies {
  const leads = new Set<string>();
  const positive = new Set<string>();
  const outside = new Set<string>();
  let events = 0;
  for (const r of inboundInWindow) {
    if (!isInboundReply(r) || !r.lead_id) continue;
    if (!cohort.has(r.lead_id)) { outside.add(r.lead_id); continue; }
    events++;
    leads.add(r.lead_id);
    if (POSITIVE_CLASS.has(r.classification ?? "")) positive.add(r.lead_id);
  }
  return { leads, positive, events, outsideCohortLeads: outside.size };
}

/* ═══════════════════════════════════════════════════════════════════════
   RATE PRESENTATION  (audit RC-4)

   One precision everywhere: one decimal. Math.round() to an integer turned
   2.94% into 3% and disagreed with every other surface. Rounding happens at
   RENDER — never before aggregating or comparing.
   ═══════════════════════════════════════════════════════════════════════ */

export const RATE_DECIMALS = 1;

/** Round a rate for display. Null in, null out — never 0%. */
export function roundRate(rate: number | null, decimals = RATE_DECIMALS): number | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  const f = 10 ** decimals;
  return Math.round(rate * f) / f;
}

/** Render a rate as a string. `dash` is what an absent denominator shows. */
export function formatRate(rate: number | null, decimals = RATE_DECIMALS, dash = "—"): string {
  const r = roundRate(rate, decimals);
  return r === null ? dash : `${r.toFixed(decimals)}%`;
}

/* ═══════════════════════════════════════════════════════════════════════
   PER-CHANNEL REPLY ATTRIBUTION  (audit RC-5)

   Same-channel, both sides. A lead reached by email that replied on
   LinkedIn is a LinkedIn reply, not an email one. The loose rule nearly
   doubled the email rate (58 leads instead of 32).

   Invitation acceptance and call connect rate are NOT reply rates and are
   never computed here.
   ═══════════════════════════════════════════════════════════════════════ */

/** Normalise a reply row's channel onto the DM/email axis. A LinkedIn reply
 *  always arrives on the DM leg — an invitation cannot be replied to. */
export function replyChannel(r: ReplyRow): string {
  const c = r.channel ?? "";
  if (c === "linkedin" || c === "linkedin_dm") return "li_dm";
  return c;
}

/** Which outbound leg a sent message belongs to. */
export function messageChannel(m: MessageRow): string {
  if (m.channel === "linkedin") return (m.step_number ?? 0) === 0 ? "li_cr" : "li_dm";
  return m.channel ?? "";
}

export type ChannelRate = { reached: number; replied: number; rate: number | null; sent: number };

/**
 * Reply rate for ONE channel: of the leads reached on that channel, how many
 * replied ON THAT CHANNEL. Restricted to the cohort, like every other
 * performance figure.
 */
export function channelReplyRate(
  channel: "li_dm" | "email" | string,
  messages: MessageRow[],
  leadOfCampaign: Map<string, string>,
  inboundInWindow: ReplyRow[],
  cohort: Set<string>,
  w: Window,
): ChannelRate {
  const reached = new Set<string>();
  let sent = 0;
  for (const m of messages) {
    if (!isSent(m) || !m.campaign_id) continue;
    if (!inWindow(m.sent_at, w)) continue;
    if (messageChannel(m) !== channel) continue;
    sent++;
    const lead = leadOfCampaign.get(m.campaign_id);
    if (lead && cohort.has(lead)) reached.add(lead);
  }
  const replied = new Set<string>();
  for (const r of inboundInWindow) {
    if (!isInboundReply(r) || !r.lead_id) continue;
    if (replyChannel(r) !== channel) continue;
    if (reached.has(r.lead_id)) replied.add(r.lead_id);
  }
  return {
    reached: reached.size,
    replied: replied.size,
    sent,
    rate: reached.size > 0 ? (replied.size / reached.size) * 100 : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   LINKEDIN ACCEPTANCE  (audit Block 4)

   The old `connectedLeadIds` was `step_number >= 1 OR current_step >= 1` on
   ANY channel — it measured "the sequence advanced", not acceptance, and
   counted 2,888 leads with `linkedin_connected = false` as accepted.

   `leads.linkedin_connected` has NO timestamp, so acceptance cannot be
   windowed. The only defensible reading, and the one the UI must state:
   "of the leads INVITED in this period, how many are connected as of today".
   ═══════════════════════════════════════════════════════════════════════ */

/** Leads sent a connection request (LinkedIn step 0) inside the window. */
export function invitedLeadIds(
  messages: MessageRow[],
  leadOfCampaign: Map<string, string>,
  w: Window,
): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (!isSent(m) || !m.campaign_id) continue;
    if (m.channel !== "linkedin" || (m.step_number ?? 0) !== 0) continue;
    if (!inWindow(m.sent_at, w)) continue;
    const lead = leadOfCampaign.get(m.campaign_id);
    if (lead) out.add(lead);
  }
  return out;
}

export type Acceptance = {
  invited: number;
  accepted: number;
  /** null when nobody was invited — never 0%, which reads as a measurement. */
  rate: number | null;
  /** Rendered verbatim next to the figure. The caveat is part of the metric. */
  caveat: string;
};

export function linkedinAcceptance(invited: Set<string>, connectedLeads: Set<string>): Acceptance {
  let accepted = 0;
  for (const id of invited) if (connectedLeads.has(id)) accepted++;
  return {
    invited: invited.size,
    accepted,
    rate: invited.size > 0 ? (accepted / invited.size) * 100 : null,
    caveat: "of the leads invited in this period, accepted as of today",
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   CALLS  (audit Block 5)

   Dedup key is lead + minute. When a click-to-dial marker and the real
   Aircall row land in the same slot they are the SAME call, and the real
   row is the one carrying the data — so it must win. Taking whichever
   arrived first discarded real calls: 189 survived instead of 282.
   ═══════════════════════════════════════════════════════════════════════ */

export type DedupCallRow = CallRow & { lead_id?: string | null; started_at?: string | null };

export function callDedupKey(c: DedupCallRow): string {
  return `${c.lead_id ?? "?"}|${(c.started_at ?? "").slice(0, 16)}`;
}

/**
 * Deduplicate by lead+minute preferring the real call, then keep only real
 * calls. Returns the attempted set — the denominator for connect rate.
 */
export function realCallsInWindow<T extends DedupCallRow>(calls: T[], w: Window): T[] {
  const best = new Map<string, T>();
  for (const c of calls) {
    if (!inWindow(c.started_at, w)) continue;
    const k = callDedupKey(c);
    const prev = best.get(k);
    if (!prev || (isRealCall(c) && !isRealCall(prev))) best.set(k, c);
  }
  const out: T[] = [];
  for (const c of best.values()) if (isRealCall(c)) out.push(c);
  return out;
}

/**
 * Seller attribution for a call, in the order the audit fixed:
 *   who actually dialled → the flow's assigned caller → the flow's sender.
 * Everyone shares one Aircall seat, so the dialler field is the only thing
 * that separates them. Returns null when none resolves — the caller must
 * report that as Unattributed, never spread it across sellers.
 */
export function callOwner(
  c: { dialed_by_user_id?: string | null; seller_id?: string | null; lead_id?: string | null },
  opts: {
    sellerOfUser: Map<string, string>;
    leadAssignedUser: Map<string, string>;
    leadSeller: Map<string, string>;
  },
): string | null {
  if (c.dialed_by_user_id) {
    const s = opts.sellerOfUser.get(c.dialed_by_user_id);
    if (s) return s;
  }
  if (c.seller_id) return c.seller_id;
  if (c.lead_id) {
    const u = opts.leadAssignedUser.get(c.lead_id);
    if (u) {
      const s = opts.sellerOfUser.get(u);
      if (s) return s;
    }
    const s = opts.leadSeller.get(c.lead_id);
    if (s) return s;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════
   CALL SCOPE  (Delivery 3, RC-6)

   `scopedCalls` honoured only the seller-TIER scope and never saw the URL
   filters, so with any of them active the dashboard kept showing the whole
   workspace: 284 calls under a seller filter where 64 belong to it.

   Messages could not simply be copied, because each dimension means
   something different for a call:

     SELLER    — who actually made the call, by the canonical attribution
                 order (dialler → flow's assigned caller → flow's sender).
                 NOT "whose flow owns the lead": everyone shares one Aircall
                 seat, and crediting a dial to the flow owner is the exact
                 error Delivery 2 fixed in the Sellers tab.
     CAMPAIGN  — the call's lead belongs to a selected flow.
     ICP       — the call's lead belongs to the selected ICP.

   Active dimensions INTERSECT. A call must satisfy every one of them.
   ═══════════════════════════════════════════════════════════════════════ */

export type CallScope = {
  /** sellers.id values from the URL. null = dimension inactive. */
  sellerIds: Set<string> | null;
  /** lead ids belonging to the selected campaigns. null = inactive. */
  campaignLeadIds: Set<string> | null;
  /** lead ids belonging to the selected ICPs. null = inactive. */
  icpLeadIds: Set<string> | null;
  /** seller-tier scope (campaigns.assigned_user_id). null = inactive. */
  assignedLeadIds: Set<string> | null;
  /** Canonical attribution, injected so the rule stays testable. */
  attribute: (c: { dialed_by_user_id?: string | null; seller_id?: string | null; lead_id?: string | null }) => string | null;
};

export function emptyCallScope(): CallScope {
  return { sellerIds: null, campaignLeadIds: null, icpLeadIds: null, assignedLeadIds: null, attribute: () => null };
}

/**
 * One rule, one place. Every active dimension must pass — never OR.
 * A call whose seller cannot be attributed is EXCLUDED by an active seller
 * filter rather than admitted into it.
 */
export function callMatchesScope(
  c: { dialed_by_user_id?: string | null; seller_id?: string | null; lead_id?: string | null },
  scope: CallScope,
): boolean {
  const lead = c.lead_id ?? null;

  if (scope.assignedLeadIds && (!lead || !scope.assignedLeadIds.has(lead))) return false;
  if (scope.campaignLeadIds && (!lead || !scope.campaignLeadIds.has(lead))) return false;
  if (scope.icpLeadIds && (!lead || !scope.icpLeadIds.has(lead))) return false;

  if (scope.sellerIds) {
    const owner = scope.attribute(c);
    if (!owner || !scope.sellerIds.has(owner)) return false;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════
   METRICS WITH NO SOURCE OF TRUTH  (audit Block 10)

   Rendering 0 for something nobody tracks is worse than rendering nothing:
   a zero reads as a measured result.
   ═══════════════════════════════════════════════════════════════════════ */

export const NOT_MEASURED = "not_measured" as const;
export type NotMeasured = typeof NOT_MEASURED;
export type Measurable<T> = T | NotMeasured;

export function isNotMeasured<T>(v: Measurable<T>): v is NotMeasured {
  return v === NOT_MEASURED;
}

/** Why each unmeasurable metric is unmeasurable. Rendered in the tooltip. */
export const NOT_MEASURED_REASON: Record<string, string> = {
  meetings: "No meeting event exists. `qualified` means a positive reply reached the CRM, which is a different thing.",
  won: "The `closed_won` status has never been set on any lead, in any tenant.",
  lost: "The available figure mixes a negative reply with a manually closed lead. Two events, one number.",
};

/* ═══════════════════════════════════════════════════════════════════════
   SOURCE FAILURE  (audit Block 8)

   A paged read that fails halfway used to return the rows it had. Pages
   1-10 succeed, page 11 fails, and the dashboard renders confident, wrong
   totals. A partial read is now an error, and the panel says so.
   ═══════════════════════════════════════════════════════════════════════ */

export class SourceUnavailableError extends Error {
  readonly source: string;
  constructor(source: string, cause?: unknown) {
    super(`[dashboard] source "${source}" could not be read completely — refusing to serve partial data`);
    this.name = "SourceUnavailableError";
    this.source = source;
    if (cause) this.cause = cause;
  }
}
