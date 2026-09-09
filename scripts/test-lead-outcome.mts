// Unit tests for the canonical lead-outcome classifier (Phase 3). Pure.
// Run: npx tsx scripts/test-lead-outcome.mts
//
// Pins the REVISED lifecycle: Completed with no human decision = PENDING (stays
// in Funnel/Completed), never auto Re-nurture / Lost. Also pins the /leads ==
// /results parity (both call this one function).

import { classifyLeadOutcome, isOutcomePending, type OutcomeSignals } from "../lib/lead-outcome.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const base: OutcomeSignals = {
  hasPositive: false, statusWon: false, transferredToOdoo: false,
  hasNegativeReply: false, statusLost: false, statusNurturing: false, hasActiveFollowup: false,
};

console.log("\nclassifyLeadOutcome");
// TEST 7 + 8 — sequence completed, no reply, no decision → pending (NOT renurture, NOT lost)
eq("completed, no reply, no decision → pending", classifyLeadOutcome({ ...base }), "pending");
eq("isOutcomePending true for that case", isOutcomePending({ ...base }), true);

eq("positive reply → won", classifyLeadOutcome({ ...base, hasPositive: true }), "won");
eq("status won → won", classifyLeadOutcome({ ...base, statusWon: true }), "won");
eq("transferred to odoo → won", classifyLeadOutcome({ ...base, transferredToOdoo: true }), "won");

eq("negative, no followup → lost", classifyLeadOutcome({ ...base, hasNegativeReply: true }), "lost");
eq("status closed_lost → lost", classifyLeadOutcome({ ...base, statusLost: true }), "lost");

eq("explicit nurturing → renurture", classifyLeadOutcome({ ...base, statusNurturing: true }), "renurture");
eq("active follow-up → renurture", classifyLeadOutcome({ ...base, hasActiveFollowup: true }), "renurture");

// Precedence: re-nurture beats lost (a negative lead being re-engaged is Re-nurture)
eq("negative + active followup → renurture", classifyLeadOutcome({ ...base, hasNegativeReply: true, hasActiveFollowup: true }), "renurture");
eq("negative + nurturing → renurture", classifyLeadOutcome({ ...base, hasNegativeReply: true, statusNurturing: true }), "renurture");
// Precedence: won beats everything
eq("positive + negative → won", classifyLeadOutcome({ ...base, hasPositive: true, hasNegativeReply: true }), "won");
eq("won status + nurturing → won", classifyLeadOutcome({ ...base, statusWon: true, statusNurturing: true }), "won");

console.log(`\nLead outcome: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("FAILURES:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
