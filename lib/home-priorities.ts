// "Start here — your priorities for today": which leads this seller should
// touch RIGHT NOW, and why.
//
// PURE on purpose. Everything here is plain data in, ranked data out — no
// Supabase, no fetch, no clock of its own (callers pass `nowMs`). The whole
// ranking is pinned by scripts/test-home-priorities.mts with no DB, because a
// ranking nobody can reproduce is a ranking nobody trusts.
//
// DETERMINISTIC, NOT "AI SCORING". Fran's requirement: the seller must always
// be able to read why a lead is on the list. So the model is two-level:
//
//   score = REASON_WEIGHT[reason] + urgency(0..9)
//
// The REASON decides the band; urgency only orders rows *inside* a band. Bands
// are 10 apart and the bonus is capped at 9, so urgency can never promote a
// row past a stronger reason — "a stale call reminder outranks a fresh
// positive reply" is exactly the kind of surprise this shape prevents.
//
// Each row carries its `reason` verbatim to the UI, which renders it as copy
// ("Positive reply · 18 min ago"). The number never reaches the screen.
//
// SIGNALS ARE THE ONES THAT ACTUALLY EXIST (audit 2026-09-14). Email
// opens/clicks are NOT here: nothing in the product stores them, so
// "opened email 3x" cannot be computed and was dropped from the design rather
// than faked.

/** Why a lead is on the list. Rendered as copy — never show the score. */
export type PriorityReason =
  | "meeting_intent"
  | "positive_reply"
  | "needs_info"
  | "callback_overdue"
  | "follow_up_reply"
  | "callback_today"
  | "call_overdue"
  | "connection_accepted_no_followup"
  | "not_now_matured";

/** What the CTA does. Maps to a button label + destination in the UI. */
export type PriorityAction = "reply" | "call" | "follow_up" | "view";

/**
 * Band per reason. Spaced by 10 so the urgency bonus (max 9) can reorder
 * inside a band but never across one.
 *
 * The order encodes the commercial rule Fran set:
 *   a booked-meeting intent  > a positive reply  > someone asking for info
 *   > a promise we made and broke (callback overdue)  > an explicit
 *   follow-up request  > a promise due today  > an overdue dial
 *   > an accepted connection we never used  > a "not now" that has matured.
 */
export const REASON_WEIGHT: Record<PriorityReason, number> = {
  meeting_intent: 100,
  positive_reply: 90,
  needs_info: 80,
  callback_overdue: 70,
  follow_up_reply: 60,
  callback_today: 50,
  call_overdue: 40,
  connection_accepted_no_followup: 30,
  not_now_matured: 20,
};

export const DEFAULT_ACTION: Record<PriorityReason, PriorityAction> = {
  meeting_intent: "reply",
  positive_reply: "reply",
  needs_info: "reply",
  callback_overdue: "call",
  follow_up_reply: "reply",
  callback_today: "call",
  call_overdue: "call",
  connection_accepted_no_followup: "follow_up",
  not_now_matured: "follow_up",
};

/** Max rows the Home renders. A priority list nobody finishes is a backlog. */
export const MAX_PRIORITIES = 6;

/** A "not now" only comes back around after this long. */
export const NOT_NOW_MATURE_DAYS = 14;

/** An accepted connection with no follow-up is only worth surfacing after the
 *  dispatcher's own cooldown has clearly passed. */
export const ACCEPTED_NO_FOLLOWUP_MIN_HOURS = 24;

export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

/** One candidate, before ranking. `at` is the moment the signal happened. */
export type PrioritySignal = {
  leadId: string;
  reason: PriorityReason;
  /** ISO of the signal (reply received, call due, connection accepted). */
  at: string | null;
  /** Whole days past due. Only meaningful for the overdue reasons. */
  overdueDays?: number | null;
  /** Short verbatim quote from the lead, when the signal is a reply. */
  snippet?: string | null;
};

export type LeadRef = {
  id: string;
  name: string | null;
  company: string | null;
};

export type HomePriority = {
  leadId: string;
  name: string | null;
  company: string | null;
  reason: PriorityReason;
  action: PriorityAction;
  /** Age of the signal in ms — the UI formats it ("18 min ago"). */
  ageMs: number | null;
  overdueDays: number | null;
  snippet: string | null;
  href: string;
  /** Internal ordering only. Never rendered. */
  score: number;
};

/**
 * Urgency bonus, 0..9, from how long the signal has been sitting.
 *
 * Both directions mean "you are losing this": an unanswered reply rots, and an
 * overdue task is already late. So older ⇒ higher, in both cases. It saturates
 * — past a week, one more day tells the seller nothing new, and letting it
 * grow unbounded would need a bigger band gap for no benefit.
 */
export function urgencyBonus(ageMs: number | null, overdueDays?: number | null): number {
  if (overdueDays != null && overdueDays > 0) return Math.min(9, 3 + overdueDays * 2);
  if (ageMs == null || ageMs < 0) return 0;
  const hours = ageMs / MS_HOUR;
  if (hours < 1) return 1;
  if (hours < 4) return 2;
  if (hours < 12) return 3;
  if (hours < 24) return 4;
  const days = hours / 24;
  return Math.min(9, 4 + Math.floor(days));
}

export function scoreSignal(s: PrioritySignal, nowMs: number): number {
  const ageMs = s.at ? nowMs - Date.parse(s.at) : null;
  const age = ageMs != null && Number.isFinite(ageMs) ? ageMs : null;
  return REASON_WEIGHT[s.reason] + urgencyBonus(age, s.overdueDays);
}

function hrefFor(action: PriorityAction, leadId: string): string {
  switch (action) {
    // Replying happens in the Inbox, which opens on the lead's thread.
    case "reply": return `/queue?tab=inbox&lead=${leadId}`;
    // Dialing happens in the Calls tab.
    case "call": return `/queue?tab=calls&lead=${leadId}`;
    default: return `/leads/${leadId}`;
  }
}

/**
 * Rank the signals and keep the best row PER LEAD.
 *
 * One lead can light up several signals at once (a positive reply AND an
 * overdue call). Showing both would push other leads off a 6-row list and make
 * the seller do the de-duping in their head, so only the strongest survives.
 *
 * Ties break on leadId so the order is stable across renders — without it the
 * list reshuffles on every poll and the seller loses their place.
 */
export function rankPriorities(
  signals: PrioritySignal[],
  leads: Map<string, LeadRef>,
  nowMs: number = Date.now(),
  limit: number = MAX_PRIORITIES,
): HomePriority[] {
  const best = new Map<string, { s: PrioritySignal; score: number }>();
  for (const s of signals) {
    if (!s.leadId || !leads.has(s.leadId)) continue;
    if (!(s.reason in REASON_WEIGHT)) continue;
    const score = scoreSignal(s, nowMs);
    const cur = best.get(s.leadId);
    if (!cur || score > cur.score) best.set(s.leadId, { s, score });
  }

  const rows: HomePriority[] = [];
  for (const [leadId, { s, score }] of best) {
    const lead = leads.get(leadId)!;
    const action = DEFAULT_ACTION[s.reason];
    const parsed = s.at ? nowMs - Date.parse(s.at) : null;
    rows.push({
      leadId,
      name: lead.name,
      company: lead.company,
      reason: s.reason,
      action,
      ageMs: parsed != null && Number.isFinite(parsed) ? parsed : null,
      overdueDays: s.overdueDays ?? null,
      snippet: (s.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 90) || null,
      href: hrefFor(action, leadId),
      score,
    });
  }

  rows.sort((a, b) => (b.score - a.score) || a.leadId.localeCompare(b.leadId));
  return rows.slice(0, limit);
}

/**
 * Map a `lead_replies.classification` to its reason, or null when the reply is
 * not something to act on. Values are the ones actually present in the data
 * (audit 2026-09-14): not_now, negative, follow_up, needs_info, positive,
 * meeting_intent. `negative` is deliberately absent — a "no" is not a to-do.
 */
export function reasonForReply(classification: string | null | undefined): PriorityReason | null {
  switch (classification) {
    case "meeting_intent": return "meeting_intent";
    case "positive": return "positive_reply";
    case "needs_info": return "needs_info";
    case "follow_up": return "follow_up_reply";
    default: return null;
  }
}

/**
 * A "not now" only earns a slot once it has actually matured; before that it is
 * noise the lead explicitly asked us not to make.
 */
export function notNowMatured(receivedAt: string | null, nowMs: number): boolean {
  if (!receivedAt) return false;
  const ms = Date.parse(receivedAt);
  if (Number.isNaN(ms)) return false;
  return nowMs - ms >= NOT_NOW_MATURE_DAYS * MS_DAY;
}
