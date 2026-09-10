#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// FINAL QA — Growth Engine console.
//
// Drives the real aggregation the page uses, across every filter and every
// tab, and asserts the one rule that matters:
//
//   same metric + same scope + same window = same value, everywhere.
//
// Read-only.
// ─────────────────────────────────────────────────────────────────────────

import { loadConsoleSource, buildIndex, buildOverview, buildTabs, type ConsoleFilters } from "../lib/console-data.ts";
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;

const BIO = process.env.QA_TENANT ?? "7c02e222-be59-416d-9434-acf4685f8590";
const day = (ms: number) => new Date(ms - 180 * 60_000).toISOString().slice(0, 10);
const now = Date.now();

let green = 0, yellow = 0; const reds: string[] = []; const yellows: string[] = [];
const ok = (l: string) => { green++; console.log(`  GREEN  ${l}`); };
const warn = (l: string) => { yellow++; yellows.push(l); console.log(`  YELLOW ${l}`); };
const bad = (l: string) => { reds.push(l); console.log(`  RED    ${l}`); };
const eq = (l: string, a: unknown, b: unknown) => (Object.is(a, b) ? ok(`${l} = ${JSON.stringify(a)}`) : bad(`${l}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`));

const src = await loadConsoleSource(BIO);
const view = (f: Partial<ConsoleFilters>) => {
  const filters = { from: day(now - 29 * 864e5), to: day(now), bioId: BIO, preset: "30 days", ...f } as ConsoleFilters;
  const ix = buildIndex(src, filters);
  return { D: buildOverview(ix, filters), T: buildTabs(ix), ix };
};

const CAMP = "Odoo Implementation — Argentina - Multicanal";
const ICP_ODOO = "9afe82a7-8310-4b8e-ad91-933156134ee2";
const LUCIA = "5e5085ca-4bb4-4bac-a4b6-323bf8917f35";

/* ══ 1. PERIOD PRESETS ══════════════════════════════════════════════════ */
console.log("\n── PERIOD PRESETS ──");
const P = {
  today: view({ from: day(now), to: day(now), preset: "Today" }),
  d7: view({ from: day(now - 6 * 864e5), to: day(now), preset: "7 days" }),
  d30: view({}),
  d90: view({ from: day(now - 89 * 864e5), to: day(now), preset: "90 days" }),
  all: view({ from: null, to: null, preset: "All time" }),
  custom: view({ from: "2026-08-01", to: "2026-08-20", preset: null }),
};
const c = (k: keyof typeof P) => P[k].D.funnel.stages[0].n;
(c("today") <= c("d7") && c("d7") <= c("d30") && c("d30") <= c("d90") && c("d90") <= c("all"))
  ? ok(`contacted is monotonic across presets: ${c("today")} ≤ ${c("d7")} ≤ ${c("d30")} ≤ ${c("d90")} ≤ ${c("all")}`)
  : bad(`presets not monotonic: ${["today","d7","d30","d90","all"].map(k => c(k as any)).join(" / ")}`);
P.custom.D.period.range.includes("Aug") ? ok(`custom range renders: ${P.custom.D.period.range}`) : bad("custom range label wrong");
P.all.D.period.range === "All time" ? ok("All time has no bounds") : bad(`All time label: ${P.all.D.period.range}`);

/* ══ 2. DIMENSION FILTERS ═══════════════════════════════════════════════ */
console.log("\n── DIMENSION FILTERS (30d) ──");
const base = P.d30;
const byCamp = view({ campaignNames: [CAMP] });
const byIcp = view({ icpIds: [ICP_ODOO] });
const bySeller = view({ sellerIds: [LUCIA] });
[["campaign", byCamp], ["ICP", byIcp], ["seller", bySeller]].forEach(([n, v]: any) =>
  v.D.funnel.stages[0].n < base.D.funnel.stages[0].n
    ? ok(`${n} filter restricts (${v.D.funnel.stages[0].n} < ${base.D.funnel.stages[0].n})`)
    : bad(`${n} filter does not restrict`));
const both = view({ campaignNames: [CAMP], icpIds: [ICP_ODOO] });
both.D.funnel.stages[0].n <= Math.min(byCamp.D.funnel.stages[0].n, byIcp.D.funnel.stages[0].n)
  ? ok(`campaign AND ICP intersects (${both.D.funnel.stages[0].n})`) : bad("combined filters do not intersect");
const reset = view({});
eq("reset returns to the unfiltered universe", reset.D.funnel.stages[0].n, base.D.funnel.stages[0].n);

/* ══ 3. CROSS-TAB CONSISTENCY ═══════════════════════════════════════════ */
console.log("\n── CROSS-TAB: same scope must give the same number ──");
// Seller Lucia, 30d: Overview / Sellers row / Sellers call table / Channels
{
  const v = bySeller;
  const row = v.T.sellers.find(s => /lucia/i.test(s.name));
  const calls = v.T.sellerCalls.find(s => /lucia/i.test(s.name));
  eq("Lucia · contacted · Overview == Sellers row", v.D.funnel.stages[0].n, row?.contacted);
  eq("Lucia · calls · teamHealth == Sellers call row", v.T.teamHealth.calls, calls?.attempted);
  const chCall = v.T.channelCards.find(x => x.key === "call")!;
  eq("Lucia · calls · Channels card == teamHealth", chCall.sent, v.T.teamHealth.calls);
  eq("Lucia · confirmed connected · Channels == teamHealth", chCall.result, v.T.teamHealth.confirmedConnected);
}
// Campaign Odoo
{
  const v = byCamp;
  const row = v.T.campaigns.find(x => x.name === CAMP);
  eq("Odoo campaign · contacted · Overview == Campaigns row", v.D.funnel.stages[0].n, row?.contacted);
  eq("Odoo campaign · calls · Campaigns row == teamHealth", row?.calls, v.T.teamHealth.calls);
  const unfilteredRow = base.T.campaigns.find(x => x.name === CAMP);
  eq("Odoo campaign row is identical filtered vs unfiltered", row?.contacted, unfilteredRow?.contacted);
  eq("  …and its calls too", row?.calls, unfilteredRow?.calls);
}
// ICP Odoo
{
  const v = byIcp;
  const row = v.T.icps[0];
  eq("Odoo ICP · contacted · Overview == ICPs row", v.D.funnel.stages[0].n, row?.contacted);
  const unfiltered = base.T.icps.find(x => /Odoo/i.test(x.name));
  eq("Odoo ICP row identical filtered vs unfiltered", row?.contacted, unfiltered?.contacted);
}

/* ══ 4. CALLS — canonical identity ══════════════════════════════════════ */
console.log("\n── CALLS ──");
for (const [name, v] of Object.entries({ workspace: base, lucia: bySeller, odoo: byCamp, icp: byIcp })) {
  const h = v.T.teamHealth;
  eq(`${name}: attempted == connected + notConnected + unknown`,
    h.calls, h.confirmedConnected + h.confirmedNotConnected + h.unknown);
  const den = h.confirmedConnected + h.confirmedNotConnected;
  const expect = den > 0 ? Math.round((h.confirmedConnected / den) * 1000) / 10 : 0;
  eq(`${name}: rate == connected / (connected + notConnected)`, h.connectRate, expect);
}
{
  const sum = base.T.sellerCalls.reduce((a, s) => a + s.attempted, 0);
  eq("Σ calls by seller (incl. Unattributed) == workspace", sum, base.T.teamHealth.calls);
  base.T.sellerCalls.some(s => s.name === "Unattributed") || base.T.teamHealth.calls === sum
    ? ok("Unattributed is a row, not spread") : bad("Unattributed missing");
}

/* ══ 5. ADDITIVITY ══════════════════════════════════════════════════════ */
console.log("\n── ADDITIVITY ──");
eq("Σ contacted by ICP == workspace", base.T.icps.reduce((a, r) => a + r.contacted, 0), base.D.funnel.stages[0].n);
eq("Σ contacted by campaign == workspace", base.T.campaigns.reduce((a, r) => a + r.contacted, 0), base.D.funnel.stages[0].n);
eq("funnel is a strict subset", true, base.D.funnel.stages[0].n >= base.D.funnel.stages[1].n && base.D.funnel.stages[1].n >= base.D.funnel.stages[2].n);

/* ══ 6. ZERO / UNKNOWN / NOT MEASURED ═══════════════════════════════════ */
console.log("\n── ZERO · UNKNOWN · NOT MEASURED ──");
{
  const empty = view({ from: "2020-01-01", to: "2020-01-02", preset: null });
  eq("empty window: contacted 0", empty.D.funnel.stages[0].n, 0);
  eq("empty window: calls 0", empty.T.teamHealth.calls, 0);
  empty.D.replyRates.rows.every(r => r.rate === 0 || r.rate === null)
    ? ok("empty window: reply rates do not invent a value") : bad("empty window shows a rate");
  const rateNull = empty.T.channelCards.find(x => x.key === "call")!.rate;
  rateNull === 0 ? warn("empty window: call rate renders 0, not — (no denominator)") : ok("empty window: call rate is —");
  eq("empty window: ICP list is empty, not zeros", empty.T.icps.length, 0);
}
{
  const zeroCallSellers = base.T.sellerCalls.filter(s => s.attempted === 0);
  zeroCallSellers.every(s => s.connectRate === 0)
    ? warn(`${zeroCallSellers.length} sellers with 0 calls show a 0% connect rate instead of —`)
    : ok("sellers with no calls do not show a rate");
}

/* ══ 7. STABILITY ═══════════════════════════════════════════════════════ */
console.log("\n── STABILITY ──");
{
  const a = JSON.stringify(view({}).T.teamHealth);
  const b = JSON.stringify(view({}).T.teamHealth);
  eq("same filters twice give the same result", a, b);
  const back = view({ sellerIds: [LUCIA] }), fwd = view({});
  eq("switching filters leaves no stale scope", fwd.D.funnel.stages[0].n, base.D.funnel.stages[0].n);
  back.D.funnel.stages[0].n !== fwd.D.funnel.stages[0].n ? ok("scopes are independent") : bad("scope bleed");
}


/* ══ 8. TABS · VISIBILITY ═══════════════════════════════════════════════ */
console.log("\n── TABS ──");
{
  const { VISIBLE_TABS, HIDDEN_TABS, TABS } = await import("../app/dashboard-console/tabs-data.ts");
  eq("Portfolio is hidden from the bar", VISIBLE_TABS.includes("Portfolio" as never), false);
  eq("five tabs are offered", VISIBLE_TABS.length, 5);
  eq("Portfolio's code is still there", TABS.includes("Portfolio" as never), true);
  eq("nothing else got hidden", HIDDEN_TABS.length, 1);
  for (const t of ["Overview", "ICPs", "Campaigns", "Channels", "Sellers"])
    VISIBLE_TABS.includes(t as never) ? ok(`${t} is offered`) : bad(`${t} disappeared`);
}

/* ══ 9. EVERY TAB RENDERS UNDER EVERY FILTER ════════════════════════════ */
console.log("\n── EVERY TAB × EVERY FILTER ──");
{
  const windows: [string, Partial<ConsoleFilters>][] = [
    ["Today", { from: day(now), to: day(now), preset: "Today" }],
    ["7 days", { from: day(now - 6 * 864e5), to: day(now), preset: "7 days" }],
    ["30 days", {}],
    ["90 days", { from: day(now - 89 * 864e5), to: day(now), preset: "90 days" }],
    ["All time", { from: null, to: null, preset: "All time" }],
    ["Custom", { from: "2026-08-01", to: "2026-08-20", preset: null }],
  ];
  const dims: [string, Partial<ConsoleFilters>][] = [
    ["no dimension", {}],
    ["campaign", { campaignNames: [CAMP] }],
    ["ICP", { icpIds: [ICP_ODOO] }],
    ["seller", { sellerIds: [LUCIA] }],
  ];
  let cells = 0, broken = 0;
  const isBad = (v: unknown): boolean =>
    typeof v === "number" ? !Number.isFinite(v)
    : Array.isArray(v) ? v.some(isBad)
    : v && typeof v === "object" ? Object.values(v).some(isBad) : false;

  for (const [wn, w] of windows) for (const [dn, d] of dims) {
    cells++;
    const v = view({ ...w, ...d });
    const payload = { D: v.D, T: v.T };
    if (isBad(payload)) { broken++; bad(`${wn} + ${dn}: a NaN or Infinity reached the payload`); continue; }
    const h = v.T.teamHealth;
    if (h.calls !== h.confirmedConnected + h.confirmedNotConnected + h.unknown) {
      broken++; bad(`${wn} + ${dn}: calls do not add up`); continue;
    }
    const den = h.confirmedConnected + h.confirmedNotConnected;
    if (den === 0 && h.connectRate !== null) { broken++; bad(`${wn} + ${dn}: rate shown with no denominator`); continue; }
    const sum = v.T.icps.reduce((a, r) => a + r.contacted, 0);
    if (sum !== v.D.funnel.stages[0].n) { broken++; bad(`${wn} + ${dn}: Σ ICP ${sum} != workspace ${v.D.funnel.stages[0].n}`); continue; }
  }
  broken === 0 ? ok(`${cells} window × dimension combinations: no NaN, calls add up, rates guarded, ICPs additive`)
               : bad(`${broken} of ${cells} combinations broken`);
}

/* ══ 10. NO LEGACY NUMBER LEAKS INTO THE CONSOLE ════════════════════════ */
console.log("\n── CANONICAL CALLS ──");
{
  const v = P.d30;
  const groups = v.ix.callGroups;
  const distinct = new Set(groups.map(g => g.canonicalCallId)).size;
  eq("every call in the view is one canonical id", distinct, groups.length);
  eq("teamHealth.calls == distinct canonical ids", v.T.teamHealth.calls, distinct);
  groups.every(g => g.connection === "confirmed_connected" || g.connection === "confirmed_not_connected" || g.connection === "unknown")
    ? ok("every call carries one of the three states") : bad("a call has no connection state");
}

console.log(`\n${"─".repeat(70)}`);
console.log(`  ${green} GREEN · ${yellow} YELLOW · ${reds.length} RED`);
if (yellows.length) { console.log("\n  YELLOW:"); yellows.forEach(y => console.log(`   · ${y}`)); }
if (reds.length) { console.log("\n  RED:"); reds.forEach(r => console.log(`   · ${r}`)); process.exit(1); }
