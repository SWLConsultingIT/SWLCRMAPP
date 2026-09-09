// PHASE 3A · Tests for canonical call identity.
// Run: npx tsx scripts/test-calls-identity.mts
//
// Pure — no database. Every rule the evidence forced is pinned here, so
// reintroducing one fails the build instead of a dashboard.

import {
  proposeMatches, highConfidence, mediumConfidence,
  mergePhysicalCall, toPhysicalCalls, connectionState, callTotals,
  resolveCallSeller, phoneMatchKind, isRealCallRow, explainUnmatched,
  HIGH_CONFIDENCE_MAX_SECONDS, MEDIUM_CONFIDENCE_MAX_SECONDS,
  type RawCallRow,
} from "../lib/metrics/calls-identity.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
const check = (n: string, c: boolean, x = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; fails.push(n + (x ? ` — ${x}` : "")); console.log(`  ✗ ${n}${x ? " — " + x : ""}`); }
};
const eq = (n: string, got: unknown, want: unknown) =>
  check(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const T = (s: number) => new Date(Date.parse("2026-09-01T12:00:00.000Z") + s * 1000).toISOString();
const base: RawCallRow = {
  id: "", lead_id: "L1", seller_id: null, dialed_by_user_id: null, aircall_call_id: null,
  direction: "outbound", status: null, duration: null, classification: null,
  started_at: null, phone_number: "+54 11 5555 1234",
};
const marker = (id: string, t: number, o: Partial<RawCallRow> = {}): RawCallRow =>
  ({ ...base, id, started_at: T(t), canonical_call_id: id, dialed_by_user_id: "u1", ...o });
const webhook = (id: string, t: number, o: Partial<RawCallRow> = {}): RawCallRow =>
  ({ ...base, id, started_at: T(t), canonical_call_id: id, aircall_call_id: 900 + Number(id.slice(1)),
     status: "answered", duration: 62, ...o });

/* ── matcher ──────────────────────────────────────────────────────────── */
console.log("\nMATCHER — mutual unique best match");

{
  const rows = [marker("m1", 0), webhook("w1", 3)];
  const p = proposeMatches(rows);
  eq("marker + webhook 3s apart is one HIGH pair", p.length, 1);
  eq("  confidence", p[0].confidence, "high");
  eq("  it pairs the right two rows", [p[0].markerRowId, p[0].webhookRowId], ["m1", "w1"]);
}
{
  const p = proposeMatches([marker("m1", 0), webhook("w1", 40)]);
  eq("40s apart is MEDIUM, not auto-linkable", p[0]?.confidence, "medium");
  eq("  high tier is empty", highConfidence(p).length, 0);
  eq("  medium tier has it", mediumConfidence(p).length, 1);
}
eq("beyond 120s nothing is proposed", proposeMatches([marker("m1", 0), webhook("w1", 300)]).length, 0);
eq("a different lead never matches",
  proposeMatches([marker("m1", 0, { lead_id: "L9" }), webhook("w1", 2)]).length, 0);
eq("a different phone never matches",
  proposeMatches([marker("m1", 0, { phone_number: "+54 11 4444 0000" }), webhook("w1", 2)]).length, 0);

// The measured reality: the same lead is redialled inside a minute.
{
  const rows = [marker("m1", 0), webhook("w1", 2), marker("m2", 50), webhook("w2", 52)];
  const p = highConfidence(proposeMatches(rows));
  eq("two calls to one lead 50s apart stay TWO calls", p.length, 2);
  check("  each marker keeps its own webhook",
    p.some(x => x.markerRowId === "m1" && x.webhookRowId === "w1")
    && p.some(x => x.markerRowId === "m2" && x.webhookRowId === "w2"));
}
{
  // Two markers equidistant from one webhook: mutuality cannot be established.
  const rows = [marker("m1", -5), marker("m2", 5), webhook("w1", 0)];
  const p = highConfidence(proposeMatches(rows));
  eq("an ambiguous tie links NOTHING rather than guessing nearest", p.length, 0);
}
{
  // Two webhooks both plausibly belonging to one marker. Uniqueness fails on
  // the marker's side, so nothing links — the marker is consumed zero times,
  // never twice.
  const rows = [marker("m1", 0), webhook("w1", 2), webhook("w2", 4)];
  const p = highConfidence(proposeMatches(rows));
  eq("two webhooks contending for one marker link NOTHING", p.length, 0);
  eq("  the marker is never consumed twice", p.filter(x => x.markerRowId === "m1").length, 0);
}
{
  // Four rows inside four seconds. Every webhook sees both markers, so
  // uniqueness fails everywhere and the correct answer is: link nothing.
  const rows = [marker("m1", 0), webhook("w1", 2), marker("m2", 3), webhook("w2", 4)];
  eq("a cluster where everything is plausible links nothing",
    highConfidence(proposeMatches(rows)).length, 0);
}
{
  // Well-separated pairs each resolve, and no row is ever used twice.
  const rows = [marker("m1", 0), webhook("w1", 2), marker("m2", 600), webhook("w2", 602)];
  const p = highConfidence(proposeMatches(rows));
  eq("separated pairs both link", p.length, 2);
  eq("  and no row is used twice",
    new Set(p.map(x => x.markerRowId)).size + new Set(p.map(x => x.webhookRowId)).size, p.length * 2);
}
{
  const rows = [marker("m1", 0), marker("m2", 1), webhook("w1", 2), webhook("w2", 3)];
  const p = highConfidence(proposeMatches(rows));
  const ws = new Set(p.map(x => x.webhookRowId)), ms = new Set(p.map(x => x.markerRowId));
  eq("no webhook is consumed twice", ws.size, p.length);
  eq("no marker is consumed twice", ms.size, p.length);
}
{
  // HIGH must settle before MEDIUM competes for the same marker.
  const rows = [marker("m1", 0), webhook("w1", 3), webhook("w2", 90)];
  const p = proposeMatches(rows);
  eq("a 3s pair is not stolen by a 90s one", p.find(x => x.markerRowId === "m1")?.webhookRowId, "w1");
}

/* ── determinism ──────────────────────────────────────────────────────── */
console.log("\nDETERMINISM — shuffling the input cannot change the answer");
{
  const rows = [marker("m1", 0), webhook("w1", 2), marker("m2", 60), webhook("w2", 63),
                marker("m3", 200), webhook("w3", 500), marker("m4", 10, { lead_id: "L2" })];
  const canonical = JSON.stringify(proposeMatches(rows));
  let stable = true;
  for (let i = 0; i < 100; i++) {
    const sh = [...rows];
    for (let j = sh.length - 1; j > 0; j--) { const k = Math.floor(Math.random() * (j + 1)); [sh[j], sh[k]] = [sh[k], sh[j]]; }
    if (JSON.stringify(proposeMatches(sh)) !== canonical) { stable = false; break; }
  }
  check("matcher: 100 shuffles, identical proposals", stable);

  const mrows = [marker("m1", 0, { classification: "follow_up" }), webhook("w1", 2)];
  const merged = JSON.stringify(mergePhysicalCall(mrows));
  let mstable = true;
  for (let i = 0; i < 100; i++) {
    const sh = [...mrows].sort(() => Math.random() - 0.5);
    if (JSON.stringify(mergePhysicalCall(sh)) !== merged) { mstable = false; break; }
  }
  check("merge: 100 shuffles, identical PhysicalCall", mstable);
}

/* ── merge ────────────────────────────────────────────────────────────── */
console.log("\nMERGE — the human's outcome, the webhook's technical truth");
{
  // The 212-row defect: outcome on the marker, audio on the webhook.
  const m = marker("m1", 0, { classification: "follow_up", lead_id: "L1" });
  const w = webhook("w1", 3, { canonical_call_id: "m1", duration: 91, status: "answered",
                               recording_url: "https://rec/1", lead_id: null });
  const pc = mergePhysicalCall([m, w]);
  eq("one physical call from two rows", pc.rowIds.length, 2);
  eq("  the human's outcome survives", pc.outcome, "follow_up");
  eq("  the webhook's duration survives", pc.durationSeconds, 91);
  eq("  the recording survives", pc.recordingUrl, "https://rec/1");
  eq("  the lead comes from the marker when the webhook lacks it", pc.leadId, "L1");
  eq("  the Aircall id is carried", pc.aircallCallId, 901);
  eq("  it is a real call", pc.isReal, true);
}
{
  const a = marker("m1", 0, { classification: "voicemail", updated_at: T(10) });
  const b = webhook("w1", 2, { canonical_call_id: "m1", classification: "positive", updated_at: T(99) });
  eq("two human outcomes → the most recently updated wins", mergePhysicalCall([a, b]).outcome, "positive");
}
eq("a marker alone with an outcome is still a call",
  mergePhysicalCall([marker("m1", 0, { classification: "negative" })]).isReal, true);
eq("a bare marker is NOT a real call",
  isRealCallRow(marker("m1", 0)), false);

/* ── connected semantics ──────────────────────────────────────────────── */
console.log("\nCONNECTED — only a human decides, never Aircall");
{
  // The headline finding: 286 of 632 answered+duration calls were voicemail.
  const vm = mergePhysicalCall([
    marker("m1", 0, { classification: "voicemail" }),
    webhook("w1", 2, { canonical_call_id: "m1", status: "answered", duration: 37 }),
  ]);
  eq("voicemail + Aircall answered + 37s → confirmed_not_connected", vm.connection, "confirmed_not_connected");

  const unk = mergePhysicalCall([webhook("w1", 0, { status: "answered", duration: 120 })]);
  eq("answered + 120s with NO human outcome → unknown", unk.connection, "unknown");

  for (const o of ["positive", "follow_up", "negative", "needs_info", "other_person"]) {
    eq(`  ${o} → confirmed_connected`, connectionState(o), "confirmed_connected");
  }
  for (const o of ["voicemail", "wrong_number", "no_answer"]) {
    eq(`  ${o} → confirmed_not_connected`, connectionState(o), "confirmed_not_connected");
  }
  eq("an unrecognised outcome decides nothing", connectionState("banana"), "unknown");
  eq("no outcome at all is unknown", connectionState(null), "unknown");
}
{
  const calls = toPhysicalCalls([
    marker("m1", 0, { classification: "positive" }),
    webhook("w1", 2, { canonical_call_id: "m1" }),
    marker("m2", 100, { classification: "voicemail" }),
    webhook("w2", 102, { canonical_call_id: "m2" }),
    webhook("w3", 200),                                   // unknown
    marker("m9", 300),                                    // bare marker, not a call
  ]);
  const t = callTotals(calls);
  eq("attempted counts physical calls, not rows", t.attempted, 3);
  eq("  confirmed connected", t.confirmedConnected, 1);
  eq("  confirmed not connected", t.confirmedNotConnected, 1);
  eq("  unknown", t.unknown, 1);
  check("INVARIANT connected + not_connected + unknown = attempted",
    t.confirmedConnected + t.confirmedNotConnected + t.unknown === t.attempted);
  eq("Confirmed Connect Rate excludes unknown from the denominator", t.confirmedConnectRate, 50);
  check("INVARIANT connected <= attempted", t.confirmedConnected <= t.attempted);
}
eq("no classified calls → rate is null, never 0%",
  callTotals(toPhysicalCalls([webhook("w1", 0)])).confirmedConnectRate, null);

/* ── attribution ──────────────────────────────────────────────────────── */
console.log("\nATTRIBUTION — the dialler, never the flow's LinkedIn sender");
{
  const ctx = { sellerOfUser: new Map([["u1", "s-lucia"], ["u2", "s-juan"]]),
                leadAssignedUser: new Map([["L1", "u2"]]) };
  eq("the dialler wins",
    resolveCallSeller(mergePhysicalCall([marker("m1", 0, { dialed_by_user_id: "u1", classification: "positive" })]), ctx), "s-lucia");
  eq("then calls.seller_id",
    resolveCallSeller(mergePhysicalCall([marker("m1", 0, { dialed_by_user_id: null, seller_id: "s-x", classification: "positive" })]), ctx), "s-x");
  eq("then the flow's assigned caller",
    resolveCallSeller(mergePhysicalCall([marker("m1", 0, { dialed_by_user_id: null, classification: "positive" })]), ctx), "s-juan");
  eq("otherwise Unattributed, never a guess",
    resolveCallSeller(mergePhysicalCall([marker("m1", 0, { dialed_by_user_id: null, lead_id: "L404", classification: "positive" })]), ctx), null);
}

/* ── phone ────────────────────────────────────────────────────────────── */
console.log("\nPHONE — formats differ per source");
eq("identical strings are exact", phoneMatchKind("+541155551234", "+541155551234"), "exact");
eq("same digits, different spacing, is exact", phoneMatchKind("+54 11 5555 1234", "541155551234"), "exact");
eq("a national vs international form matches on the last 9", phoneMatchKind("+44 115 496 0000", "0115 496 0000"), "suffix");
eq("different numbers do not match", phoneMatchKind("+54 11 5555 1234", "+54 11 4444 0000"), "none");
eq("too short to be safe → none", phoneMatchKind("1234", "1234"), "none");

/* ── reconciler idempotence ───────────────────────────────────────────── */
console.log("\nRECONCILER — running twice changes nothing");
{
  const rows = [marker("m1", 0), webhook("w1", 3)];
  const first = highConfidence(proposeMatches(rows));
  // Simulate applying the link, then sweeping again.
  const after = rows.map(r => r.id === "w1" ? { ...r, canonical_call_id: "m1" } : r);
  const second = highConfidence(proposeMatches(after));
  eq("the pair is still proposed (the sweep is stateless)", second.length, first.length);
  const applied = after.filter(r => r.canonical_call_id === "m1");
  eq("  but applying it again is a no-op — both already share the identity", applied.length, 2);
  eq("  and they collapse to ONE physical call", toPhysicalCalls(after).length, 1);
}
{
  // Late evidence: the marker existed yesterday, the webhook lands today.
  const late = [marker("m1", 0), webhook("w1", 8)];
  eq("a webhook arriving after its marker still links", highConfidence(proposeMatches(late)).length, 1);
  const reversed = [webhook("w1", 8), marker("m1", 0)];
  eq("  and arrival order does not matter", highConfidence(proposeMatches(reversed)).length, 1);
}

/* ── diagnostics classify every unlinked webhook ──────────────────────── */
console.log("\nDIAGNOSTICS — why a row stayed unlinked");
{
  const rows = [
    marker("m1", 0), webhook("w1", 2),        // links
    webhook("w9", 5_000),                      // no marker anywhere near
    marker("m2", 10_000), webhook("w2", 10_002), webhook("w3", 10_004), // two webhooks, one marker
  ];
  const p = proposeMatches(rows);
  const why = explainUnmatched(rows, p);
  eq("linked webhooks are not explained", p.length, 1);
  eq("  webhook with no marker in range", why.no_candidate, 1);
  eq("  every unlinked webhook is classified exactly once",
    why.no_candidate + why.ambiguous + why.not_mutual,
    rows.filter(r => r.aircall_call_id != null).length - p.length);
}

/* ── thresholds are the measured ones ─────────────────────────────────── */
console.log("\nTHRESHOLDS — from the evidence, not from taste");
eq("high confidence gate is 15 seconds", HIGH_CONFIDENCE_MAX_SECONDS, 15);
eq("medium ceiling is 120 seconds", MEDIUM_CONFIDENCE_MAX_SECONDS, 120);

console.log(`\n${"─".repeat(70)}\n  ${pass} passed · ${fail} failed`);
if (fail) { console.log("\nFAILURES:"); for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
console.log("  Canonical call identity holds.\n");
