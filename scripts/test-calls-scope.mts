#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.3 · Regression tests for the two RED causes.
//
// RED #1  sellerId is a sellers.id, never an auth user id.
// RED #2  group FIRST, scope AFTER. A physical call has ONE owner.
//
// The fixture is the real case that broke it: Lucía's dial marker plus the
// Aircall webhook that carried the voicemail outcome and no dialler.
// ─────────────────────────────────────────────────────────────────────────

import {
  canonicalCallGroups, callMetrics, callMetricsBy, callMatchesScope,
  emptyPhysicalCallScope, type CallGroupView, type PhysicalCallScope,
} from "../lib/metrics/calls-read.ts";
import { resolveWindow } from "../lib/metric-defs.ts";
import type { RawCallRow } from "../lib/metrics/calls-identity.ts";

let pass = 0, fail = 0; const fails: string[] = [];
const check = (l: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  ✓ ${l}`); } else { fail++; fails.push(`${l} ${d}`); console.log(`  ✗ ${l} ${d}`); }
};
const eq = (l: string, a: unknown, b: unknown) => check(l, Object.is(a, b), `— got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ── the world ────────────────────────────────────────────────────────── */
const LUCIA_USER = "u-lucia", LUCIA_SELLER = "s-lucia";
const ANDREA_USER = "u-andrea", ANDREA_SELLER = "s-andrea";
const LEAD = "lead-1", CANON = "canon-1";
const CAMP = "camp-odoo", ICP = "icp-odoo";

const ctx = {
  win: resolveWindow("2026-09-01", "2026-09-30"),
  leadToCampaignName: new Map<string, string | null>([[LEAD, "Odoo Implementation"]]),
  leadToCampaignId: new Map([[LEAD, CAMP]]),
  leadToIcpId: new Map([[LEAD, ICP]]),
  sellerOfUser: new Map([[LUCIA_USER, LUCIA_SELLER], [ANDREA_USER, ANDREA_SELLER]]),
  // The LEAD is assigned to Andrea — this is the fallback that stole the call.
  leadAssignedUser: new Map([[LEAD, ANDREA_USER]]),
  toDayKey: (iso: string | null) => (iso ?? "").slice(0, 10),
};

const row = (o: Partial<RawCallRow> & { id: string }): RawCallRow => ({
  canonical_call_id: CANON, lead_id: LEAD, seller_id: null, dialed_by_user_id: null,
  aircall_call_id: null, direction: "outbound", status: null, duration: null,
  classification: null, started_at: "2026-09-09T14:00:00.000Z", phone_number: "+5491133334444",
  ...o,
});

// The real pair: marker has the dialler, webhook has the outcome.
const marker = row({ id: "r-marker", dialed_by_user_id: LUCIA_USER, seller_id: LUCIA_SELLER });
const webhook = row({ id: "r-webhook", aircall_call_id: 987654, status: "answered", duration: 31, classification: "voicemail" });
const FIXTURE = [marker, webhook];

const scope = (o: Partial<PhysicalCallScope>): PhysicalCallScope => ({ ...emptyPhysicalCallScope(), ...o });

/* ── 1 ────────────────────────────────────────────────────────────────── */
console.log("\n1. marker Lucía + webhook voicemail → ONE physical call");
const groups = canonicalCallGroups(FIXTURE, ctx);
eq("  one physical call", groups.length, 1);
eq("  owner is Lucía, not the lead's assignee", groups[0].sellerId, LUCIA_SELLER);
eq("  outcome came from the webhook", groups[0].classification, "voicemail");
eq("  connection is confirmed_not_connected", groups[0].connection, "confirmed_not_connected");
eq("  sellerId is a sellers.id, NOT an auth user id", groups[0].sellerId, LUCIA_SELLER);
check("  the auth id lives in userId", groups[0].userId === LUCIA_USER && groups[0].sellerId !== LUCIA_USER);

/* ── 2 & 3 ────────────────────────────────────────────────────────────── */
console.log("\n2-3. the seller filter admits Lucía and excludes Andrea");
eq("  filter Lucía → the call is in", groups.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([LUCIA_SELLER]) }))).length, 1);
eq("  filter Andrea → the call is OUT", groups.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([ANDREA_SELLER]) }))).length, 0);

/* ── 4 ────────────────────────────────────────────────────────────────── */
console.log("\n4. a canonical_call_id never appears under two sellers");
const bySeller = callMetricsBy(groups, g => g.sellerId ?? "UNATTRIBUTED");
eq("  exactly one seller bucket", bySeller.size, 1);
const seen = new Map<string, string>();
let dup = false;
for (const g of groups) {
  const k = g.sellerId ?? "UNATTRIBUTED";
  if (seen.has(g.canonicalCallId) && seen.get(g.canonicalCallId) !== k) dup = true;
  seen.set(g.canonicalCallId, k);
}
check("  no canonical id in two buckets", !dup);

/* ── 5 ────────────────────────────────────────────────────────────────── */
console.log("\n5. group-before-filter is the ONLY correct order");
// Filtering rows first, the way the dashboard used to: keep only rows whose
// own attribution is Lucía. The webhook has none, so it is dropped, and the
// surviving marker alone is not a real call.
const rowsFirst = FIXTURE.filter(r => r.dialed_by_user_id === LUCIA_USER || r.seller_id === LUCIA_SELLER);
const wrong = canonicalCallGroups(rowsFirst, ctx);
eq("  filter-then-group LOSES the call", wrong.length, 0);
eq("  group-then-filter KEEPS it", groups.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([LUCIA_SELLER]) }))).length, 1);
check("  the two orders disagree — which is why only one is allowed", wrong.length !== 1);

/* ── 6 ────────────────────────────────────────────────────────────────── */
console.log("\n6. seller row total == same seller filtered view");
const other = [
  row({ id: "r-a1", canonical_call_id: "canon-2", dialed_by_user_id: ANDREA_USER, seller_id: ANDREA_SELLER, classification: "positive" }),
  row({ id: "r-a2", canonical_call_id: "canon-2", aircall_call_id: 111, duration: 90 }),
];
const world = canonicalCallGroups([...FIXTURE, ...other], ctx);
const rowTotal = callMetricsBy(world, g => g.sellerId ?? "UNATTRIBUTED").get(LUCIA_SELLER)!;
const filtered = callMetrics(world.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([LUCIA_SELLER]) }))));
eq("  attempted matches", filtered.attempted, rowTotal.attempted);
eq("  connected matches", filtered.confirmedConnected, rowTotal.confirmedConnected);
eq("  notConnected matches", filtered.confirmedNotConnected, rowTotal.confirmedNotConnected);
eq("  unknown matches", filtered.unknown, rowTotal.unknown);

/* ── 7 ────────────────────────────────────────────────────────────────── */
console.log("\n7. Overview filtered by seller == Sellers tab row, same window");
// Both read the same population; there is only one.
eq("  Overview(Lucía) == Sellers row(Lucía)", filtered.attempted, rowTotal.attempted);
eq("  Andrea likewise", callMetrics(world.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([ANDREA_SELLER]) })))).attempted,
   callMetricsBy(world, g => g.sellerId ?? "UNATTRIBUTED").get(ANDREA_SELLER)!.attempted);

/* ── 8 & 9 ────────────────────────────────────────────────────────────── */
console.log("\n8-9. campaign and ICP filtered == their breakdown row");
const byCamp = callMetricsBy(world, g => g.campaignId ?? "NO CAMPAIGN").get(CAMP)!;
eq("  campaign filter == campaign row",
   callMetrics(world.filter(g => callMatchesScope(g, scope({ campaignIds: new Set([CAMP]) })))).attempted, byCamp.attempted);
const byIcp = callMetricsBy(world, g => g.icpId ?? "NO ICP").get(ICP)!;
eq("  ICP filter == ICP row",
   callMetrics(world.filter(g => callMatchesScope(g, scope({ icpIds: new Set([ICP]) })))).attempted, byIcp.attempted);

/* ── 10 ───────────────────────────────────────────────────────────────── */
console.log("\n10. combined filters INTERSECT (AND), never union");
eq("  Lucía AND her campaign → 1",
   world.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([LUCIA_SELLER]), campaignIds: new Set([CAMP]) }))).length, 1);
eq("  Lucía AND a foreign campaign → 0",
   world.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([LUCIA_SELLER]), campaignIds: new Set(["camp-other"]) }))).length, 0);
eq("  Andrea AND Lucía's ICP → 1 (both leads share it)",
   world.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([ANDREA_SELLER]), icpIds: new Set([ICP]) }))).length, 1);
eq("  three dimensions AND → 1",
   world.filter(g => callMatchesScope(g, scope({ sellerIds: new Set([LUCIA_SELLER]), campaignIds: new Set([CAMP]), icpIds: new Set([ICP]) }))).length, 1);
eq("  an unattributable call is EXCLUDED by an active seller filter",
   canonicalCallGroups([row({ id: "r-x", canonical_call_id: "canon-x", lead_id: null, aircall_call_id: 222, classification: "voicemail" })],
     { ...ctx, leadAssignedUser: new Map() })
     .filter(g => callMatchesScope(g, scope({ sellerIds: new Set([LUCIA_SELLER]) }))).length, 0);

/* ── the rate ─────────────────────────────────────────────────────────── */
console.log("\nUnknown never enters the denominator");
const withUnknown = canonicalCallGroups([
  ...FIXTURE, ...other,
  row({ id: "r-u", canonical_call_id: "canon-3", aircall_call_id: 333, duration: 50, status: "answered" }),
], ctx);
const m = callMetrics(withUnknown);
eq("  attempted", m.attempted, 3);
eq("  connected", m.confirmedConnected, 1);
eq("  notConnected", m.confirmedNotConnected, 1);
eq("  unknown (answered + duration 50s is NOT connected)", m.unknown, 1);
eq("  rate is 1/2, not 1/3", m.confirmedConnectRate, 50);

console.log(`\n${"─".repeat(70)}\n  ${pass} passed · ${fail} failed`);
if (fail) { console.log("\nFAILURES:"); for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
console.log("  Scope and attribution hold.\n");
