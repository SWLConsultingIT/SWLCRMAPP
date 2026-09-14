// Home priority engine — ranking tests. Part of `npm test`.
//
// The engine decides what a seller sees first thing in the morning, so the
// property that matters is not "the numbers are right" but "the ORDER is the
// commercial rule Fran agreed to, and it cannot drift". These assertions pin
// the bands, the per-lead de-dup, and the guarantee that urgency can never
// promote a row past a stronger reason.
//
// Pure: no DB, no network, clock injected.

import {
  ACCEPTED_NO_FOLLOWUP_MIN_HOURS,
  MAX_AGE_DAYS,
  MAX_PER_ACTION,
  MAX_PER_REASON,
  NEVER_ACTIONABLE,
  isEligible,
  DEFAULT_ACTION,
  MAX_PRIORITIES,
  MS_DAY,
  MS_HOUR,
  NOT_NOW_MATURE_DAYS,
  REASON_WEIGHT,
  notNowMatured,
  rankPriorities,
  reasonForReply,
  scoreSignal,
  urgencyBonus,
  type LeadRef,
  type PrioritySignal,
} from "@/lib/home-priorities";

let failed = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) { failed++; console.error("  ✗ " + msg); }
}

const NOW = Date.parse("2026-09-14T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const LEADS = new Map<string, LeadRef>([
  ["l1", { id: "l1", name: "Sarah Chen", company: "Acme" }],
  ["l2", { id: "l2", name: "Steve Hellman", company: "Globex" }],
  ["l3", { id: "l3", name: "Michael Ross", company: "Initech" }],
  ["l4", { id: "l4", name: "John Doe", company: "Umbrella" }],
]);

// ── 1. Bands ───────────────────────────────────────────────────────────────
console.log("home priorities · reason bands");

const ORDER = [
  "meeting_intent", "positive_reply", "needs_info", "callback_overdue",
  "follow_up_reply", "callback_today", "call_overdue",
  "connection_accepted_no_followup", "not_now_matured",
] as const;

for (let i = 1; i < ORDER.length; i++) {
  ok(REASON_WEIGHT[ORDER[i - 1]] > REASON_WEIGHT[ORDER[i]],
    `${ORDER[i - 1]} outranks ${ORDER[i]}`);
}
for (let i = 1; i < ORDER.length; i++) {
  ok(REASON_WEIGHT[ORDER[i - 1]] - REASON_WEIGHT[ORDER[i]] >= 10,
    `the gap ${ORDER[i - 1]}→${ORDER[i]} is at least 10 (urgency cannot cross it)`);
}
ok(Object.keys(REASON_WEIGHT).length === ORDER.length, "every reason has a weight and no extras");
ok(Object.keys(DEFAULT_ACTION).length === ORDER.length, "every reason has a default action");

// ── 2. Urgency stays inside its band ───────────────────────────────────────
console.log("home priorities · urgency is a tiebreaker, never a promotion");

ok(urgencyBonus(0) === 1, "a brand-new signal still scores above zero");
ok(urgencyBonus(null) === 0, "no timestamp means no bonus");
ok(urgencyBonus(-5000) === 0, "a future timestamp does not earn urgency");
ok(urgencyBonus(30 * 60_000) === 1, "under an hour → 1");
ok(urgencyBonus(2 * MS_HOUR) === 2, "a couple of hours → 2");
ok(urgencyBonus(6 * MS_HOUR) === 3, "half a day → 3");
ok(urgencyBonus(20 * MS_HOUR) === 4, "under a day → 4");
ok(urgencyBonus(365 * MS_DAY) <= 9, "urgency saturates at 9 no matter how old");
ok(urgencyBonus(null, 20) <= 9, "overdue urgency saturates too");
ok(urgencyBonus(null, 3) > urgencyBonus(null, 1), "more days overdue ranks higher");

// THE invariant: an ancient weak signal must never beat a fresh strong one.
{
  const ancient = scoreSignal({ leadId: "l1", reason: "call_overdue", at: ago(400 * MS_DAY), overdueDays: 400 }, NOW);
  const fresh = scoreSignal({ leadId: "l2", reason: "callback_overdue", at: ago(60_000), overdueDays: 1 }, NOW);
  ok(fresh > ancient, "a fresh callback_overdue still beats a 400-day-old call_overdue");
}
{
  const stalePositive = scoreSignal({ leadId: "l1", reason: "positive_reply", at: ago(30 * MS_DAY) }, NOW);
  const freshMeeting = scoreSignal({ leadId: "l2", reason: "meeting_intent", at: ago(1000) }, NOW);
  ok(freshMeeting > stalePositive, "a brand-new meeting_intent outranks a month-old positive reply");
}

// ── 3. Older-unanswered ranks higher inside a band ─────────────────────────
console.log("home priorities · within a band, the one rotting longest comes first");
{
  const rows = rankPriorities([
    { leadId: "l1", reason: "positive_reply", at: ago(10 * 60_000) },
    { leadId: "l2", reason: "positive_reply", at: ago(3 * MS_DAY) },
  ], LEADS, NOW);
  ok(rows[0].leadId === "l2", "the 3-day-old unanswered positive reply comes before the 10-minute-old one");
  ok(rows.length === 2, "both still appear");
}

// ── 4. One row per lead ────────────────────────────────────────────────────
console.log("home priorities · one row per lead");
{
  const rows = rankPriorities([
    { leadId: "l1", reason: "call_overdue", at: ago(2 * MS_DAY), overdueDays: 2 },
    { leadId: "l1", reason: "positive_reply", at: ago(MS_HOUR) },
    { leadId: "l1", reason: "not_now_matured", at: ago(40 * MS_DAY) },
  ], LEADS, NOW);
  ok(rows.length === 1, "a lead with three signals produces exactly one row");
  ok(rows[0].reason === "positive_reply", "the strongest reason is the one kept");
}

// ── 5. Unknown leads and junk are dropped ──────────────────────────────────
console.log("home priorities · junk in, nothing out");
{
  const rows = rankPriorities([
    { leadId: "ghost", reason: "positive_reply", at: ago(1000) },
    { leadId: "", reason: "positive_reply", at: ago(1000) },
    { leadId: "l1", reason: "not_a_reason" as PrioritySignal["reason"], at: ago(1000) },
    { leadId: "l1", reason: "positive_reply", at: "not-a-date" },
  ], LEADS, NOW);
  // An undated reply is dropped, not shown: with no timestamp there is no way
  // to tell a fresh one from an 81-day-old one, and the shelf-life filter fails
  // closed rather than guessing.
  ok(rows.length === 0, "junk in, nothing out — including the undated reply");
}
{
  // A dateless signal that carries its own lateness still works, and must not
  // leak NaN into the age the UI formats.
  const rows = rankPriorities([{ leadId: "l1", reason: "call_overdue", at: null, overdueDays: 2 }], LEADS, NOW);
  ok(rows.length === 1, "a dateless overdue call still qualifies on its overdue count");
  ok(rows[0].ageMs === null, "and yields a null age, never NaN");
}

// ── 6. Cap + stable order ──────────────────────────────────────────────────
console.log("home priorities · cap and stability");
{
  const many: PrioritySignal[] = Array.from({ length: 20 }, (_, i) => ({
    leadId: `x${i}`, reason: "positive_reply" as const, at: ago(MS_HOUR),
  }));
  const leads = new Map(many.map(s => [s.leadId, { id: s.leadId, name: null, company: null }]));
  const rows = rankPriorities(many, leads, NOW);
  // Twenty eligible rows of ONE reason are capped by the variety rule long
  // before the length cap — the wall-of-identical-cards guard bites first.
  ok(rows.length === MAX_PER_REASON, `twenty same-reason rows collapse to ${MAX_PER_REASON}`);
}
{
  // The length cap is what bites when the reasons ARE varied.
  const varied: PrioritySignal[] = ORDER.map((reason, i) => ({
    leadId: `v${i}`, reason, at: ago(MS_HOUR), overdueDays: 1,
  }));
  const leads = new Map(varied.map(s => [s.leadId, { id: s.leadId, name: null, company: null }]));
  const rows = rankPriorities(varied, leads, NOW);
  ok(rows.length === MAX_PRIORITIES, `nine varied reasons are capped at ${MAX_PRIORITIES}`);
  ok(new Set(rows.map(r => r.reason)).size === rows.length, "and every visible row is a different reason");
}
{
  // Identical scores must not reshuffle between renders — the seller loses
  // their place if the list reorders on every poll.
  const sig: PrioritySignal[] = [
    { leadId: "l3", reason: "needs_info", at: ago(MS_HOUR) },
    { leadId: "l1", reason: "needs_info", at: ago(MS_HOUR) },
    { leadId: "l2", reason: "needs_info", at: ago(MS_HOUR) },
  ];
  const a = rankPriorities(sig, LEADS, NOW).map(r => r.leadId).join(",");
  const b = rankPriorities([...sig].reverse(), LEADS, NOW).map(r => r.leadId).join(",");
  ok(a === b, "the same ties produce the same order regardless of input order");
  // Three tied rows of one reason; the variety cap keeps two, and WHICH two is
  // decided by the stable lead-id tiebreak, not by input order.
  ok(a === "l1,l2", "ties break deterministically by lead id");
}

// ── 7. Actions + destinations ──────────────────────────────────────────────
console.log("home priorities · CTA routing");
{
  const rows = rankPriorities([
    { leadId: "l1", reason: "positive_reply", at: ago(1000) },
    { leadId: "l2", reason: "call_overdue", at: ago(MS_DAY), overdueDays: 1 },
    { leadId: "l3", reason: "connection_accepted_no_followup", at: ago(2 * MS_DAY) },
  ], LEADS, NOW);
  const by = new Map(rows.map(r => [r.leadId, r]));
  ok(by.get("l1")!.action === "reply", "a positive reply is answered, not dialled");
  ok(by.get("l1")!.href === "/queue?tab=inbox&lead=l1", "reply goes to the Inbox tab on that lead");
  ok(by.get("l2")!.action === "call", "an overdue call is dialled");
  ok(by.get("l2")!.href === "/queue?tab=calls&lead=l2", "call goes to the Calls tab, not the Inbox");
  ok(by.get("l3")!.href === "/leads/l3", "a follow-up opens the lead");
  ok(rows.every(r => !r.href.includes("?tab=chat")), "nothing routes to the retired chat tab");
}

// ── 8. The reason is always explainable ────────────────────────────────────
console.log("home priorities · every row carries a renderable reason");
{
  // Each reason must be able to surface on its own. Tested one at a time,
  // because together the variety caps deliberately hold some back (four
  // different reasons all end in a "Reply" CTA).
  for (const reason of ORDER) {
    // Each reason gets an age inside ITS own window — not_now_matured has a
    // floor as well as a ceiling, so a one-hour-old one is correctly ineligible.
    const ageDays = reason === "not_now_matured" ? NOT_NOW_MATURE_DAYS + 1 : 0;
    const one = rankPriorities(
      [{ leadId: "l1", reason, at: ago(ageDays * MS_DAY + MS_HOUR), overdueDays: 1 }], LEADS, NOW,
    );
    ok(one.length === 1, `${reason} can produce a row on its own`);
  }
  const rows = rankPriorities(
    ORDER.map((reason, i) => ({ leadId: `x${i}`, reason, at: ago(MS_HOUR), overdueDays: 1 })),
    new Map(ORDER.map((_, i) => [`x${i}`, { id: `x${i}`, name: null, company: null }])),
    NOW, 99,
  );
  ok(rows.length < ORDER.length, "shown together, the variety caps hold some back");
  ok(rows.every(r => typeof r.reason === "string" && r.reason.length > 0), "every row states its reason");
  ok(rows.every(r => r.score > 0), "every row has an internal score");
  // The score is ordering metadata; if it ever reaches the UI, that is a bug.
  ok(rows.every(r => Object.prototype.hasOwnProperty.call(r, "score")), "score exists for ordering");
}

// ── 9. Reply classification mapping ────────────────────────────────────────
console.log("home priorities · reply classification mapping");
ok(reasonForReply("meeting_intent") === "meeting_intent", "meeting_intent maps through");
ok(reasonForReply("positive") === "positive_reply", "positive maps to positive_reply");
ok(reasonForReply("needs_info") === "needs_info", "needs_info maps through");
ok(reasonForReply("follow_up") === "follow_up_reply", "follow_up maps to follow_up_reply");
ok(reasonForReply("negative") === null, "a negative reply is NOT a to-do");
ok(reasonForReply("not_now") === null, "not_now is handled by its own maturity rule, not here");
ok(reasonForReply(null) === null, "an unclassified reply is not prioritized");
ok(reasonForReply("unsubscribe") === null, "an unsubscribe is never surfaced as work");

// ── 10. "not now" maturity ─────────────────────────────────────────────────
console.log("home priorities · not_now maturity");
ok(!notNowMatured(ago(3 * MS_DAY), NOW), "a 3-day-old not_now is still not now");
ok(!notNowMatured(ago((NOT_NOW_MATURE_DAYS - 1) * MS_DAY), NOW), "one day short of the window does not mature");
ok(notNowMatured(ago((NOT_NOW_MATURE_DAYS + 1) * MS_DAY), NOW), "past the window it comes back");
ok(!notNowMatured(null, NOW), "no timestamp never matures");
ok(!notNowMatured("garbage", NOW), "an unparseable timestamp never matures");
ok(ACCEPTED_NO_FOLLOWUP_MIN_HOURS >= 24, "an accepted connection gets at least a day before it is nagged about");

// ── 11. Eligibility — the shelf-life filter ────────────────────────────────
console.log("home priorities · eligibility runs before scoring");

// The bug this exists for: measured on production, 54 of 102 pending replies
// were over thirty days old. They scored high purely because they were still
// pending, and owned the top of the Home every morning.
{
  const stale: PrioritySignal = { leadId: "l1", reason: "positive_reply", at: ago(81 * MS_DAY) };
  ok(!isEligible(stale, NOW), "an 81-day-old positive reply is not today's work");
  ok(scoreSignal(stale, NOW) > REASON_WEIGHT.needs_info, "…even though it still scores high");
  const rows = rankPriorities([stale], LEADS, NOW);
  ok(rows.length === 0, "and it never reaches the list");
}
{
  ok(!isEligible({ leadId: "l1", reason: "positive_reply", at: ago(27 * MS_DAY) }, NOW),
    "a 27-day-old positive reply is out too");
  ok(isEligible({ leadId: "l1", reason: "positive_reply", at: ago(13 * MS_DAY) }, NOW),
    "a 13-day-old positive reply is still in");
}
for (const reason of ORDER) {
  const inside = MAX_AGE_DAYS[reason] - 1;
  const outside = MAX_AGE_DAYS[reason] + 1;
  if (reason === "not_now_matured") continue;   // has a floor too, checked below
  ok(isEligible({ leadId: "l1", reason, at: ago(inside * MS_DAY) }, NOW), `${reason} inside its window is eligible`);
  ok(!isEligible({ leadId: "l1", reason, at: ago(outside * MS_DAY) }, NOW), `${reason} past its window is not`);
}
{
  ok(!isEligible({ leadId: "l1", reason: "not_now_matured", at: ago(3 * MS_DAY) }, NOW),
    "a fresh not_now has not matured yet (floor)");
  ok(isEligible({ leadId: "l1", reason: "not_now_matured", at: ago(20 * MS_DAY) }, NOW),
    "a matured not_now is eligible");
  ok(!isEligible({ leadId: "l1", reason: "not_now_matured", at: ago(200 * MS_DAY) }, NOW),
    "an ancient not_now is dead, not mature (ceiling)");
}
{
  ok(!isEligible({ leadId: "l1", reason: "positive_reply", at: new Date(NOW + MS_DAY).toISOString() }, NOW),
    "a signal dated in the future is not eligible");
  ok(isEligible({ leadId: "l1", reason: "call_overdue", at: null, overdueDays: 3 }, NOW),
    "a dateless overdue call qualifies on its overdue count");
  ok(!isEligible({ leadId: "l1", reason: "call_overdue", at: null, overdueDays: 400 }, NOW),
    "a 400-day overdue call does not");
}

// ── 12. Never-actionable classifications ───────────────────────────────────
console.log("home priorities · auto-replies and dead ends never become work");
for (const c of ["auto_reply", "unsubscribe", "spam", "negative", "nurturing"]) {
  ok(NEVER_ACTIONABLE.has(c), `${c} is on the never-actionable list`);
  ok(reasonForReply(c) === null, `${c} produces no reason`);
}
ok(!NEVER_ACTIONABLE.has("positive"), "a positive reply is obviously actionable");
ok(!NEVER_ACTIONABLE.has("needs_info"), "needs_info is actionable");

// ── 13. Variety — no wall of identical rows ────────────────────────────────
console.log("home priorities · the list stays varied");
{
  // Six fresh positive replies: without the cap this rendered six identical
  // "Reply" cards, which is what Fran called out.
  const many: PrioritySignal[] = Array.from({ length: 6 }, (_, i) => ({
    leadId: `p${i}`, reason: "positive_reply" as const, at: ago((i + 1) * MS_HOUR),
  }));
  const leads = new Map(many.map(s => [s.leadId, { id: s.leadId, name: null, company: null }]));
  const rows = rankPriorities(many, leads, NOW);
  ok(rows.length === MAX_PER_REASON, `six positive replies collapse to ${MAX_PER_REASON} rows`);
  ok(rows.every(r => r.reason === "positive_reply"), "the ones kept are still positive replies");
}
{
  // Four reasons that all mean "Reply" must not fill the list with buttons
  // that look the same.
  const sig: PrioritySignal[] = [
    { leadId: "a1", reason: "meeting_intent", at: ago(MS_HOUR) },
    { leadId: "a2", reason: "positive_reply", at: ago(MS_HOUR) },
    { leadId: "a3", reason: "needs_info", at: ago(MS_HOUR) },
    { leadId: "a4", reason: "follow_up_reply", at: ago(MS_HOUR) },
    { leadId: "a5", reason: "call_overdue", at: null, overdueDays: 2 },
  ];
  const leads = new Map(sig.map(s => [s.leadId, { id: s.leadId, name: null, company: null }]));
  const rows = rankPriorities(sig, leads, NOW);
  const replies = rows.filter(r => r.action === "reply").length;
  ok(replies <= MAX_PER_ACTION, `at most ${MAX_PER_ACTION} rows share the Reply CTA (got ${replies})`);
  ok(rows.some(r => r.action === "call"), "the call still makes the list instead of being crowded out");
}
{
  // No backfill: a thin day shows a thin list rather than padding with stale
  // rows. That is the whole point of the filter.
  const rows = rankPriorities([
    { leadId: "l1", reason: "positive_reply", at: ago(2 * MS_HOUR) },
    { leadId: "l2", reason: "positive_reply", at: ago(90 * MS_DAY) },
    { leadId: "l3", reason: "needs_info", at: ago(60 * MS_DAY) },
  ], LEADS, NOW);
  ok(rows.length === 1, "only the fresh one shows; the list is not padded back to five");
}
ok(MAX_PRIORITIES <= 5, "the visible list is capped at five rows");

console.log(`\n${checks - failed}/${checks} home-priority assertions passed`);
if (failed) process.exit(1);
