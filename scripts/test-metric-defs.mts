// Unit tests for the canonical metric definitions (Phase 2, Delivery 2).
// Run: npx tsx scripts/test-metric-defs.mts
//
// These are pure — no database. They pin the RULES the audit fixed, so a
// future edit that reintroduces one of them fails here instead of on a
// dashboard someone is reading.

import {
  businessDayKey, businessHour, businessWeekday, businessDayStartMs, businessDayEndMs,
  resolveWindow, inWindow, priorWindow, presetRange,
  isInboundReply, isPositiveReply, repliedLeadIds, positiveLeadIds, replyEventCount,
  contactedLeadIds, enrolledLeadIds, replyRate,
  invitedLeadIds, linkedinAcceptance,
  realCallsInWindow, callOwner,
  isRealCall, isConnected,
  NOT_MEASURED, isNotMeasured, SourceUnavailableError,
} from "../lib/metric-defs.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : "")); console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/* ── BLOCK 6 · timezone ───────────────────────────────────────────────── */
console.log("\nBLOCK 6 — one business timezone (America/Argentina/Buenos_Aires, UTC−3)");

// 02:00Z on the 8th is still 23:00 on the 7th in Buenos Aires.
eq("02:00Z on the 8th is the 7th locally", businessDayKey("2026-08-08T02:00:00Z"), "2026-08-07");
eq("03:00Z on the 8th is the 8th locally", businessDayKey("2026-08-08T03:00:00Z"), "2026-08-08");
eq("23:59Z on the 7th is the 7th locally", businessDayKey("2026-08-07T23:59:59Z"), "2026-08-07");
eq("local hour of 12:00Z is 09", businessHour("2026-08-10T12:00:00Z"), 9);
eq("local hour of 01:00Z rolls back a day", businessHour("2026-08-10T01:00:00Z"), 22);
// 2026-08-10 is a Monday. 01:00Z Monday is Sunday evening locally.
eq("weekday uses getDay() convention (0=Sun)", businessWeekday("2026-08-10T12:00:00Z"), 1);
eq("01:00Z Monday is Sunday locally", businessWeekday("2026-08-10T01:00:00Z"), 0);

eq("day starts at 03:00Z", new Date(businessDayStartMs("2026-08-08")).toISOString(), "2026-08-08T03:00:00.000Z");
eq("day ends at 02:59:59.999Z next day", new Date(businessDayEndMs("2026-08-08")).toISOString(), "2026-08-09T02:59:59.999Z");

// The exact bug: an event three hours after UTC midnight.
const w = resolveWindow("2026-08-08", "2026-09-07");
check("an event at 02:00Z on the first day is OUTSIDE the window (it is the previous local day)",
  !inWindow("2026-08-08T02:00:00Z", w));
check("an event at 04:00Z on the first day is inside", inWindow("2026-08-08T04:00:00Z", w));
check("an event at 02:00Z the day AFTER the last day is still inside (local 23:00)",
  inWindow("2026-09-08T02:00:00Z", w));
check("an event at 04:00Z the day after is outside", !inWindow("2026-09-08T04:00:00Z", w));

eq("a 30-day preset is 30 days, not 31",
  presetRange(30, new Date("2026-09-07T15:00:00Z")), { from: "2026-08-09", to: "2026-09-07" });
eq("all time has no range", presetRange(null), null);

/* ── BLOCK 7 · prior period ───────────────────────────────────────────── */
console.log("\nBLOCK 7 — the prior window is the same length, or it does not exist");

const p = priorWindow(w)!;
check("prior window exists for a bounded window", p !== null);
check("prior window is the same length", (p.toMs! - p.fromMs!) === (w.toMs! - w.fromMs!));
check("prior window ends the instant before the current one starts", p.toMs! === w.fromMs! - 1);
eq("ALL TIME has no comparable prior window", priorWindow({ fromMs: null, toMs: null }), null);
eq("an open-ended start has no prior window", priorWindow({ fromMs: null, toMs: Date.now() }), null);

/* ── BLOCK 3 · call outcomes are not replies ──────────────────────────── */
console.log("\nBLOCK 3 — a call outcome never increments the reply count");

const replies = [
  { lead_id: "a", channel: "linkedin", classification: "needs_info" },
  { lead_id: "a", channel: "linkedin", classification: "positive" },
  { lead_id: "b", channel: "email", classification: "negative" },
  { lead_id: "c", channel: "call", classification: "positive" },   // ← a call outcome
  { lead_id: "d", channel: "call", classification: "voicemail" },  // ← a call outcome
];
check("a call row is not an inbound reply", !isInboundReply(replies[3]));
check("a linkedin row is an inbound reply", isInboundReply(replies[0]));
eq("replied leads exclude call outcomes", [...repliedLeadIds(replies)].sort(), ["a", "b"]);
eq("positive leads exclude a positive CALL outcome", [...positiveLeadIds(replies)], ["a"]);
eq("reply EVENTS exclude call outcomes", replyEventCount(replies), 3);
check("a positive call outcome is not a positive reply", !isPositiveReply(replies[3]));

// The regression the audit found: adding a call outcome must change nothing.
const before = repliedLeadIds(replies).size;
const after = repliedLeadIds([...replies, { lead_id: "z", channel: "call", classification: "positive" }]).size;
eq("adding a call outcome does not increment replied leads", after, before);

/* ── BLOCK 2 · contacted vs enrolled ──────────────────────────────────── */
console.log("\nBLOCK 2 — Contacted requires a message that actually went out");

const leadOf = new Map([["c1", "L1"], ["c2", "L2"], ["c3", "L3"]]);
const msgs = [
  { campaign_id: "c1", status: "sent",   sent_at: "2026-08-10T12:00:00Z", channel: "email", step_number: 1 },
  { campaign_id: "c1", status: "sent",   sent_at: "2026-08-11T12:00:00Z", channel: "email", step_number: 4 },
  { campaign_id: "c2", status: "queued", sent_at: null,                   channel: "email", step_number: 1 },
  { campaign_id: "c3", status: "sent",   sent_at: "2026-01-01T12:00:00Z", channel: "email", step_number: 1 },
];
const camps = [{ lead_id: "L1" }, { lead_id: "L2" }, { lead_id: "L3" }];
const contacted = contactedLeadIds(msgs, leadOf, w);
const enrolled = enrolledLeadIds(camps);

eq("contacted dedups by lead, not by message", [...contacted], ["L1"]);
eq("enrolled counts every lead with a flow", enrolled.size, 3);
check("INVARIANT contacted <= enrolled", contacted.size <= enrolled.size, `${contacted.size} <= ${enrolled.size}`);
check("a lead with a flow and no sent message is enrolled but NOT contacted",
  enrolled.has("L2") && !contacted.has("L2"));
check("a lead whose only send is outside the window is not contacted in it", !contacted.has("L3"));
eq("reply rate divides by contacted, not enrolled", replyRate(1, contacted.size), 100);
eq("reply rate is null with no denominator, never 0%", replyRate(0, 0), null);

/* ── BLOCK 4 · LinkedIn acceptance ────────────────────────────────────── */
console.log("\nBLOCK 4 — acceptance comes from linkedin_connected, nothing else");

const inviteMsgs = [
  { campaign_id: "c1", status: "sent", sent_at: "2026-08-10T12:00:00Z", channel: "linkedin", step_number: 0 },
  { campaign_id: "c2", status: "sent", sent_at: "2026-08-10T12:00:00Z", channel: "linkedin", step_number: 0 },
  { campaign_id: "c3", status: "sent", sent_at: "2026-08-10T12:00:00Z", channel: "linkedin", step_number: 2 }, // a DM
  { campaign_id: "c3", status: "sent", sent_at: "2026-08-10T12:00:00Z", channel: "email",    step_number: 0 }, // not LinkedIn
];
const invited = invitedLeadIds(inviteMsgs, leadOf, w);
eq("only LinkedIn step 0 counts as an invitation", [...invited].sort(), ["L1", "L2"]);

const acc = linkedinAcceptance(invited, new Set(["L1"]));
eq("accepted counts invited leads that are connected", acc.accepted, 1);
eq("denominator is the invited leads", acc.invited, 2);
eq("acceptance rate", acc.rate, 50);
check("the caveat travels with the number", acc.caveat.includes("as of today"));
eq("no invitations means no rate, not 0%", linkedinAcceptance(new Set(), new Set()).rate, null);

// The exact defect: sequence progression must not imply acceptance.
const advancedNotAccepted = linkedinAcceptance(new Set(["L1", "L2"]), new Set());
eq("INVARIANT current_step > 0 with linkedin_connected=false is NOT accepted", advancedNotAccepted.accepted, 0);

/* ── BLOCK 5 · calls ──────────────────────────────────────────────────── */
console.log("\nBLOCK 5 — canonical call rules, real row wins the dedup");

const marker = { lead_id: "L1", started_at: "2026-08-10T12:00:30Z", seller_id: null, status: "initiated", duration: null, classification: null, aircall_call_id: null };
const real   = { lead_id: "L1", started_at: "2026-08-10T12:00:45Z", seller_id: null, status: "answered",  duration: 61,   classification: "follow_up", aircall_call_id: 991 };
const vmail  = { lead_id: "L2", started_at: "2026-08-10T13:00:00Z", seller_id: null, status: "answered",  duration: 4,    classification: "voicemail", aircall_call_id: 992 };
const lone   = { lead_id: "L3", started_at: "2026-08-10T14:00:00Z", seller_id: null, status: "initiated", duration: null, classification: null, aircall_call_id: null };

check("a click-to-dial marker is not a real call", !isRealCall(marker));
check("an Aircall-logged row is a real call", isRealCall(real));

// Both orderings must give the same answer — that was the bug.
const forwards = realCallsInWindow([marker, real, vmail, lone], w);
const backwards = realCallsInWindow([real, marker, vmail, lone], w);
eq("marker + real in the same minute collapse to one call", forwards.length, 2);
eq("dedup is order-independent", backwards.length, forwards.length);
eq("the surviving row is the REAL one, not the marker",
  forwards.find(c => c.lead_id === "L1")?.aircall_call_id, 991);
check("a lone marker is dropped entirely", !forwards.some(c => c.lead_id === "L3"));

check("voicemail is NOT connected even with duration > 0", !isConnected(vmail));
check("a classified conversation is connected", isConnected(real));
const connected = forwards.filter(isConnected).length;
check("INVARIANT connected <= attempted", connected <= forwards.length, `${connected} <= ${forwards.length}`);

const attrOpts = {
  sellerOfUser: new Map([["u-dialer", "s-dialer"], ["u-assigned", "s-assigned"]]),
  leadAssignedUser: new Map([["L1", "u-assigned"]]),
  leadSeller: new Map([["L1", "s-flow"], ["L9", "s-flow"]]),
};
eq("the dialler wins", callOwner({ dialed_by_user_id: "u-dialer", lead_id: "L1" }, attrOpts), "s-dialer");
eq("then the flow's assigned caller", callOwner({ dialed_by_user_id: null, lead_id: "L1" }, attrOpts), "s-assigned");
eq("then the flow's sender", callOwner({ dialed_by_user_id: null, lead_id: "L9" }, attrOpts), "s-flow");
eq("nothing resolves means UNATTRIBUTED, never a guess",
  callOwner({ dialed_by_user_id: null, lead_id: "L404" }, attrOpts), null);

/* ── BLOCK 8 · no silent partial data ─────────────────────────────────── */
console.log("\nBLOCK 8 — a half-read source is an error, not a smaller number");

const err = new SourceUnavailableError("campaign_messages", { code: "57014" });
check("the error names the source that failed", err.source === "campaign_messages");
check("the message refuses partial data out loud", err.message.includes("refusing to serve partial"));
check("it is catchable by type", err instanceof SourceUnavailableError && err instanceof Error);

/* ── BLOCK 10 · not measured ──────────────────────────────────────────── */
console.log("\nBLOCK 10 — untracked is not zero");

check("NOT_MEASURED is recognisable", isNotMeasured(NOT_MEASURED));
check("0 is NOT the same as not measured", !isNotMeasured(0));

/* ── summary ──────────────────────────────────────────────────────────── */
console.log(`\n${"─".repeat(70)}`);
console.log(`  ${pass} passed · ${fail} failed`);
if (fail) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log(`  · ${f}`);
  process.exit(1);
}
console.log("  All metric definitions hold.\n");
