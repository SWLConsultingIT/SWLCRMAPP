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
export const MAX_PRIORITIES = 5;

/* ═══════════════════════════════════════════════════════════════════════════
   ELIGIBILITY — runs BEFORE scoring.

   Scoring answers "how urgent is this relative to that". It cannot answer "does
   this belong on today's list at all", and conflating the two is what made the
   first version useless: a positive reply from 81 days ago still scored ~99 and
   sat at the top of the Home every morning, forever, because nothing had
   changed about it. Measured on production 2026-09-14 — of 102 pending replies,
   7 were under a week old and 54 were over thirty days. The list was almost
   entirely archaeology.

   So a signal must first EARN a slot in "today". Things that fail are not lost:
   they stay in the Inbox and the Activities board, which is what a backlog is
   for. The Home is a work surface, not a debt ledger.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How long a signal stays "today's work", per reason.
 *
 * These are commercial shelf-lives, not storage policy. A positive reply is hot
 * for about two weeks; after that, re-engaging is a different motion than
 * replying and does not belong in a list titled "start here". A promise we made
 * (callback) survives longer because breaking it is the seller's own doing, but
 * a two-month-old overdue callback is a dead lead, not today's priority.
 */
export const MAX_AGE_DAYS: Record<PriorityReason, number> = {
  meeting_intent: 21,
  positive_reply: 21,
  needs_info: 21,
  callback_overdue: 30,
  follow_up_reply: 21,
  callback_today: 2,
  call_overdue: 30,
  connection_accepted_no_followup: 30,
  not_now_matured: 90,
};

// CALIBRATION (production, 2026-09-14). The reply windows started at 10-14
// days and that was too tight: dry-running the engine over real data gave
// three of eight sellers a completely empty Home while they each had pending
// work. Every excluded item was a `needs_info` — someone who asked about
// pricing — aged between 10 and 105 days. Twelve days late answering a buying
// question is still today's work, and arguably more urgent than a fresh one;
// eighty days late is archaeology. 21 days keeps the first and drops the
// second, and stays inside the "nothing from 27+ days" bound Fran set.
// Re-measured after the change: Andrea 1 row, Juan 2, Lucho 2 (capped),
// Lucia 4, Isaac 2 — lists that are short, varied and true.

/**
 * Reply classifications that are never work, at any age.
 *
 * `auto_reply` is the out-of-office / bounce bucket — the lead did not say
 * anything, a mail server did. `unsubscribe` and `spam` are the opposite of a
 * lead to chase, and acting on them is a compliance problem. `negative` is a
 * clear no. `nurturing` is a long-horizon state the flow handles on its own.
 * The full enum lives in app/api/replies/[id]/review/route.ts; anything not
 * mapped by `reasonForReply` is already excluded, and this set makes the
 * dangerous ones explicit so a future mapping cannot quietly let them in.
 */
export const NEVER_ACTIONABLE: ReadonlySet<string> = new Set([
  "auto_reply", "unsubscribe", "spam", "negative", "nurturing",
]);

/** Rows sharing one reason, so the list does not become six of the same card. */
export const MAX_PER_REASON = 2;

/**
 * Rows sharing one CTA. Four different reasons can all end in "Reply", which
 * still reads as a wall of identical buttons — this caps the *shape* of the
 * list, not just its labels.
 */
export const MAX_PER_ACTION = 3;

/**
 * Does this signal belong on today's list?
 *
 * Deliberately no backfill anywhere downstream: if only two things qualify,
 * the Home shows two. "You have two things to do" is a useful, true statement.
 * Padding it back to five with stale rows would rebuild the exact problem the
 * filter exists to solve.
 */
export function isEligible(s: PrioritySignal, nowMs: number): boolean {
  if (!(s.reason in REASON_WEIGHT)) return false;

  // Overdue things are dated by their due date, which `at` already carries.
  const ms = s.at ? Date.parse(s.at) : NaN;
  if (Number.isNaN(ms)) {
    // No timestamp: only the reasons that are defined by state rather than by
    // a moment can qualify (an overdue call knows its own lateness).
    return s.overdueDays != null && s.overdueDays >= 0
      && s.overdueDays <= MAX_AGE_DAYS[s.reason];
  }

  const ageDays = (nowMs - ms) / MS_DAY;
  if (ageDays < 0) return false;                       // dated in the future
  if (ageDays > MAX_AGE_DAYS[s.reason]) return false;  // past its shelf life

  // A "not now" is the one reason with a floor as well as a ceiling: it is not
  // work until the lead's own window has passed.
  if (s.reason === "not_now_matured" && ageDays < NOT_NOW_MATURE_DAYS) return false;

  return true;
}

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
    if (!isEligible(s, nowMs)) continue;   // shelf life FIRST, urgency second
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

  // Variety pass. Without it the list degenerates into the same card repeated:
  // four different reasons all resolve to "Reply", so a busy inbox produced six
  // near-identical rows and the ranking stopped conveying anything. Taking the
  // best two per reason and at most three per CTA keeps the strongest item of
  // each KIND of work visible, which is what makes the list scannable.
  const byReason = new Map<PriorityReason, number>();
  const byAction = new Map<PriorityAction, number>();
  const out: HomePriority[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if ((byReason.get(r.reason) ?? 0) >= MAX_PER_REASON) continue;
    if ((byAction.get(r.action) ?? 0) >= MAX_PER_ACTION) continue;
    byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
    out.push(r);
  }
  return out;
}

/**
 * Map a `lead_replies.classification` to its reason, or null when the reply is
 * not something to act on. Values are the ones actually present in the data
 * (audit 2026-09-14): not_now, negative, follow_up, needs_info, positive,
 * meeting_intent. `negative` is deliberately absent — a "no" is not a to-do.
 */
export function reasonForReply(classification: string | null | undefined): PriorityReason | null {
  // Explicit gate first: an out-of-office auto-reply, an unsubscribe or a spam
  // flag must never become a task even if the mapping below grows later.
  if (classification && NEVER_ACTIONABLE.has(classification)) return null;
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
