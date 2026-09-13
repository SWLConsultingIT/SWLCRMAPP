// Unit tests for LinkedIn Recovery pure logic. No DB, no network.
// Run: npx tsx scripts/test-linkedin-recovery.mts
//
// Pins the invariants that must not drift: cooldown anchored on withdrawn_at,
// the 5-day pre-withdraw wait, the shared per-seller cap, max-2 attempts, the
// fail-closed guard evaluators, discovery classification, and copy distinctness.

import {
  computeEligibleWithdrawAt, computeReinviteAfter, computeSecondAcceptDeadline,
  capRemaining, evaluateWithdrawGuards, evaluateReinviteGuards, classifyCandidate,
  sellerUsable, RECOVERY_STATES, WAIT_DAYS_BEFORE_WITHDRAW, COOLDOWN_DAYS, DAY_MS,
  type WithdrawCtx, type ReinviteCtx, type CandidateSnapshot,
} from "../lib/linkedin-recovery.ts";
import { isDistinctCopy, copySimilarity, normalizeForCompare } from "../lib/linkedin-recovery-copy.ts";
import { completionFields } from "../lib/campaign-complete.ts";
import { computeRecoveryKpis, kpisByDimension } from "../lib/linkedin-recovery-metrics.ts";
import { resolveOutbound } from "../lib/placeholders.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const NOW = Date.parse("2026-09-13T12:00:00.000Z");

/* ── timers ── */
console.log("\ntimers");
eq("eligible withdraw = completed + 5d", computeEligibleWithdrawAt("2026-09-01T00:00:00.000Z"), new Date(Date.parse("2026-09-01T00:00:00.000Z") + 5 * DAY_MS).toISOString());
eq("eligible withdraw null when no completion", computeEligibleWithdrawAt(null), null);
eq("eligible withdraw null when garbage", computeEligibleWithdrawAt("nope"), null);
eq("reinvite_after = withdrawn + 21d", computeReinviteAfter("2026-09-10T00:00:00.000Z"), new Date(Date.parse("2026-09-10T00:00:00.000Z") + 21 * DAY_MS).toISOString());
eq("second-accept deadline = sent + 21d", computeSecondAcceptDeadline("2026-10-01T00:00:00.000Z"), new Date(Date.parse("2026-10-01T00:00:00.000Z") + 21 * DAY_MS).toISOString());
eq("cooldown constant is 21", COOLDOWN_DAYS, 21);
eq("pre-withdraw wait is 5", WAIT_DAYS_BEFORE_WITHDRAW, 5);

/* ── cap (shared with dispatch-queue) ── */
console.log("\ncapRemaining");
eq("47 normal + 3 recovery of 50 → 0", capRemaining(50, 47, 3), 0);
eq("40 normal + 2 recovery of 50 → 8", capRemaining(50, 40, 2), 8);
eq("over cap clamps to 0", capRemaining(20, 25, 3), 0);
eq("null limit falls back to 20", capRemaining(null, 18, 0), 2);

/* ── seller usability ── */
console.log("\nsellerUsable");
eq("active + account → usable", sellerUsable("active", "acc_1"), true);
eq("restricted → not usable", sellerUsable("restricted", "acc_1"), false);
eq("no account → not usable", sellerUsable("active", null), false);

/* ── withdraw guards ── */
console.log("\nevaluateWithdrawGuards");
const baseW: WithdrawCtx = {
  nowMs: NOW,
  eligibleWithdrawAtMs: NOW - DAY_MS,     // eligible window open
  leadConnected: false, leadTerminal: false, leadArchived: false,
  suppressed: false, laterEngagement: false,
  sellerActive: true, accountAvailable: true,
  originalInvitationId: "inv_1", storedProviderId: "prov_1",
  live: { networkDistance: "DISTANCE_2", invitationStatus: "PENDING", providerId: "prov_1" },
};
eq("happy path → proceed", evaluateWithdrawGuards(baseW).action, "proceed");
eq("connected before withdraw → cancel accepted", evaluateWithdrawGuards({ ...baseW, leadConnected: true }), { action: "cancel", state: RECOVERY_STATES.CANCELLED_ACCEPTED, reason: "connected_before_withdraw" });
eq("terminal → cancel terminal", (evaluateWithdrawGuards({ ...baseW, leadTerminal: true }) as any).state ?? null, RECOVERY_STATES.CANCELLED_TERMINAL);
eq("archived → cancel terminal", (evaluateWithdrawGuards({ ...baseW, leadArchived: true }) as any).state ?? null, RECOVERY_STATES.CANCELLED_TERMINAL);
eq("suppressed → cancel suppressed", (evaluateWithdrawGuards({ ...baseW, suppressed: true }) as any).state ?? null, RECOVERY_STATES.CANCELLED_SUPPRESSED);
eq("later engagement → review", evaluateWithdrawGuards({ ...baseW, laterEngagement: true }).action, "review");
eq("seller unavailable → review", evaluateWithdrawGuards({ ...baseW, sellerActive: false }).action, "review");
eq("missing invitation id → review", evaluateWithdrawGuards({ ...baseW, originalInvitationId: null }).action, "review");
eq("no completion anchor → review", evaluateWithdrawGuards({ ...baseW, eligibleWithdrawAtMs: null }), { action: "review", reason: "no_completion_anchor" });
eq("within 5d wait → wait", evaluateWithdrawGuards({ ...baseW, eligibleWithdrawAtMs: NOW + DAY_MS }), { action: "wait", reason: "within_5d_wait" });
eq("no live preflight → review", evaluateWithdrawGuards({ ...baseW, live: null }), { action: "review", reason: "unipile_preflight_unavailable" });
eq("live first-degree → cancel accepted", (evaluateWithdrawGuards({ ...baseW, live: { networkDistance: "FIRST_DEGREE", invitationStatus: null, providerId: "prov_1" } }) as any).state ?? null, RECOVERY_STATES.CANCELLED_ACCEPTED);
eq("original invite not pending (already gone) → review", evaluateWithdrawGuards({ ...baseW, live: { networkDistance: "DISTANCE_2", invitationStatus: null, providerId: "prov_1" } }), { action: "review", reason: "original_invite_not_pending" });
eq("provider mismatch → review", evaluateWithdrawGuards({ ...baseW, live: { networkDistance: "DISTANCE_2", invitationStatus: "PENDING", providerId: "prov_OTHER" } }), { action: "review", reason: "provider_mismatch" });

/* ── reinvite guards ── */
console.log("\nevaluateReinviteGuards");
const baseR: ReinviteCtx = {
  nowMs: NOW,
  reinviteAfterMs: NOW - DAY_MS,     // cooldown elapsed
  attemptCount: 1, copyApproved: true, capRemaining: 5,
  leadConnected: false, leadTerminal: false, leadArchived: false,
  suppressed: false, laterEngagement: false,
  sellerActive: true, accountAvailable: true,
  live: { networkDistance: "DISTANCE_2", invitationStatus: null, providerId: "prov_1" },
};
eq("happy path → proceed", evaluateReinviteGuards(baseR).action, "proceed");
eq("attempt_count 2 → review (max)", evaluateReinviteGuards({ ...baseR, attemptCount: 2 }), { action: "review", reason: "max_attempts_reached" });
eq("connected during cooldown → cancel accepted", (evaluateReinviteGuards({ ...baseR, leadConnected: true }) as any).state ?? null, RECOVERY_STATES.CANCELLED_ACCEPTED);
eq("awaiting copy approval → wait", evaluateReinviteGuards({ ...baseR, copyApproved: false }), { action: "wait", reason: "awaiting_copy_approval" });
eq("within cooldown → wait", evaluateReinviteGuards({ ...baseR, reinviteAfterMs: NOW + DAY_MS }), { action: "wait", reason: "within_cooldown" });
eq("cap reached → wait", evaluateReinviteGuards({ ...baseR, capRemaining: 0 }), { action: "wait", reason: "daily_cap_reached" });
eq("no live → review", evaluateReinviteGuards({ ...baseR, live: null }).action, "review");
eq("live already first-degree → cancel accepted", (evaluateReinviteGuards({ ...baseR, live: { networkDistance: "FIRST_DEGREE", invitationStatus: null, providerId: "p" } }) as any).state ?? null, RECOVERY_STATES.CANCELLED_ACCEPTED);
eq("unexpected pending invite → review", evaluateReinviteGuards({ ...baseR, live: { networkDistance: "DISTANCE_2", invitationStatus: "PENDING", providerId: "p" } }), { action: "review", reason: "unexpected_pending_invite" });

/* ── discovery classification ── */
console.log("\nclassifyCandidate");
const baseC: CandidateSnapshot = {
  completedAt: "2026-09-01T00:00:00.000Z",
  leadConnected: false, leadTerminal: false, leadArchived: false,
  suppressed: false, laterEngagement: false,
  originalInvitationId: "inv_1", linkedinInternalId: "prov_1",
  sellerId: "sel_1", accountAvailable: true, sellerActive: true, stopReason: null,
};
eq("eligible with completion → WAITING_WITHDRAWAL", classifyCandidate(baseC), { enroll: true, state: RECOVERY_STATES.WAITING_WITHDRAWAL, eligibleWithdrawAt: computeEligibleWithdrawAt("2026-09-01T00:00:00.000Z"), reason: "eligible" });
eq("historical (no completion) → SHADOW", classifyCandidate({ ...baseC, completedAt: null }), { enroll: true, state: RECOVERY_STATES.SHADOW, eligibleWithdrawAt: null, reason: "no_completion_anchor" });
eq("invite_expired → not enrolled", classifyCandidate({ ...baseC, stopReason: "invite_expired" }), { enroll: false, reason: "already_expire_invited" });
eq("connected → not enrolled", classifyCandidate({ ...baseC, leadConnected: true }).enroll, false);
eq("suppressed → not enrolled", classifyCandidate({ ...baseC, suppressed: true }).enroll, false);
eq("missing invitation id → not enrolled", classifyCandidate({ ...baseC, originalInvitationId: null }).enroll, false);
eq("no seller account → not enrolled", classifyCandidate({ ...baseC, accountAvailable: false }).enroll, false);

/* ── copy distinctness ── */
console.log("\nsecond-copy distinctness");
eq("identical copy → not distinct", isDistinctCopy("Hi, let's connect about logistics ROI", "Hi, let's connect about logistics ROI"), false);
eq("empty candidate → not distinct", isDistinctCopy("original", "   "), false);
eq("clearly different → distinct", isDistinctCopy("Hi, I help LATAM distributors cut last-mile costs — worth a chat?", "Saw Drivin's Mexico expansion — quick question on your ops."), true);
eq("near-duplicate → not distinct", isDistinctCopy("Hi, let's connect about logistics ROI at Drivin today", "Hi, let's connect about logistics ROI at Drivin now"), false);
eq("no original → distinct if non-empty", isDistinctCopy(null, "anything"), true);
eq("similarity identical = 1", copySimilarity("a b c", "a b c"), 1);
eq("similarity disjoint = 0", copySimilarity("a b c", "x y z"), 0);
eq("normalize strips placeholders/punct", normalizeForCompare("Hi {{first_name}}, connect?!"), "hi connect");

/* ── completionFields (completed_at fix) ── */
console.log("\ncompletionFields");
eq("last step → status+completed_at", completionFields(null, "2026-09-13T12:00:00.000Z"), { status: "completed", completed_at: "2026-09-13T12:00:00.000Z" });
eq("more steps → empty patch", completionFields("2026-09-20T00:00:00.000Z", "2026-09-13T12:00:00.000Z"), {});

/* ── metrics (recovery-only KPIs) ── */
console.log("\ncomputeRecoveryKpis");
{
  const rows = [
    { state: "WAITING_WITHDRAWAL", withdrawn_at: null, second_invite_sent_at: null, second_message_sent_at: null, company_bio_id: "t1", seller_id: "s1" },
    { state: "WAITING_REINVITE", withdrawn_at: "2026-09-10T00:00:00Z", second_invite_sent_at: null, second_message_sent_at: null, company_bio_id: "t1", seller_id: "s1" },
    { state: "SECOND_INVITE_SENT", withdrawn_at: "2026-09-10T00:00:00Z", second_invite_sent_at: "2026-10-01T00:00:00Z", second_message_sent_at: null, company_bio_id: "t1", seller_id: "s2" },
    { state: "DONE", withdrawn_at: "2026-09-10T00:00:00Z", second_invite_sent_at: "2026-10-01T00:00:00Z", second_message_sent_at: "2026-10-03T00:00:00Z", company_bio_id: "t2", seller_id: "s2" },
  ];
  const k = computeRecoveryKpis(rows);
  eq("total", k.total, 4);
  eq("withdrawn", k.withdrawn, 3);
  eq("secondInvitesSent", k.secondInvitesSent, 2);
  eq("secondDmSent", k.secondDmSent, 1);
  eq("secondAccepted (DONE)", k.secondAccepted, 1);
  eq("acceptance rate = 1/2", k.secondAcceptanceRate, 0.5);
  eq("byState DONE=1", k.byState.DONE, 1);
  const byT = kpisByDimension(rows, "company_bio_id");
  eq("tenant t1 total", byT.t1.total, 3);
  eq("tenant t2 done", byT.t2.secondAccepted, 1);
}
eq("empty kpis acceptance null", computeRecoveryKpis([]).secondAcceptanceRate, null);

/* ── placeholder gate: recovery copy must go through resolveOutbound, fail closed ── */
console.log("\nplaceholder gate (second copy send-path)");
const fullLead = (first: string | null) => ({
  primary_first_name: first, primary_last_name: "García", company_name: "Acme",
  primary_title_role: "CEO", company_city: null, company_industry: null,
  company_country: null, company_website: null,
});
const sellerObj = { name: "Lucho" };
{
  const r = resolveOutbound("Hola {{first_name}}, me encantaría conectar.", fullLead("Ana") as any, sellerObj as any, "linkedin");
  eq("first_name valid → resolved ok", r.ok, true);
  if (r.ok) { eq("resolved text has name", r.text.includes("Ana"), true); eq("no leftover placeholder", r.text.includes("{{"), false); }
}
eq("missing first_name → NO SEND (ok=false)", resolveOutbound("Hola {{first_name}}", fullLead(null) as any, sellerObj as any, "linkedin").ok, false);
eq("unknown placeholder → NO SEND (ok=false)", resolveOutbound("Hi {{unknown_token}}", fullLead("Ana") as any, sellerObj as any, "linkedin").ok, false);
{
  const dm = resolveOutbound("Gracias por conectar, {{first_name}}!", fullLead("Ana") as any, sellerObj as any, "linkedin");
  eq("second DM resolved ok", dm.ok, true);
  if (dm.ok) eq("second DM no leftover placeholder", dm.text.includes("{{"), false);
}

console.log(`\nLinkedIn Recovery: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("FAILURES:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
