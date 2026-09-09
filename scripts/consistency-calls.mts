#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.3 · THE consistency rule, on production data.
//
//   SAME METRIC + SAME SELLER + SAME WINDOW + SAME FILTERS = SAME VALUE
//
// Runs the real getDashboardData across the surfaces that must agree and
// fails on a difference of 1. Also checks that turning canonical Calls on
// moves NOTHING outside Calls.
//
//   CALLS_CANONICAL_IDENTITY=1 npx tsx --tsconfig tsconfig.render.json \
//     scripts/consistency-calls.mts
// ─────────────────────────────────────────────────────────────────────────

import { getDashboardData } from "../lib/dashboard-data.ts";
import { writeFileSync, readFileSync, existsSync } from "fs";

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const day = (d: Date) => new Date(d.getTime() - 180 * 60_000).toISOString().slice(0, 10);
const TO = day(new Date()), FROM = day(new Date(Date.now() - 29 * 86_400_000));
const SNAP = arg("--snapshot");           // write other-metrics snapshot
const COMPARE = arg("--compare");          // compare other-metrics snapshot

let pass = 0, fail = 0; const fails: string[] = [];
const eq = (l: string, a: unknown, b: unknown) => {
  if (Object.is(a, b)) { pass++; console.log(`  ✓ ${l}  (${JSON.stringify(a)})`); }
  else { fail++; fails.push(`${l}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); console.log(`  ✗ ${l}  ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); }
};

const main = async () => {
  console.log(`\n  CONSISTENCY — flag CALLS_CANONICAL_IDENTITY = ${process.env.CALLS_CANONICAL_IDENTITY ?? "(off)"}`);
  console.log(`  window ${FROM} → ${TO}\n`);

  const base: any = await getDashboardData({ from: FROM, to: TO });
  const lucia = (base.callOutcomesBySeller ?? []).find((s: any) => /lucia/i.test(s.sellerName));
  if (!lucia) throw new Error("no Lucia row — cannot run the consistency check");

  console.log("  RED #1 — the id the table exposes is the id the filter accepts");
  eq("  sellerId is not the auth user id", lucia.sellerId !== lucia.userId, true);
  const byExposedId: any = await getDashboardData({ from: FROM, to: TO, sellerIds: [lucia.sellerId] });

  console.log("\n  Lucia · Last 30 Days · Calls Attempted, everywhere");
  const sellersRow = lucia.made;                                  // Sellers tab row
  const filteredView = byExposedId.callsBreakdown.made;           // Sellers filtered
  const overviewFiltered = byExposedId.callsBreakdown.total;      // Overview, same filter
  const shadowRow = base.callsShadow.bySeller[lucia.sellerId]?.attempted;
  eq("  Sellers row == filtered view", sellersRow, filteredView);
  eq("  Overview filtered == filtered view", overviewFiltered, filteredView);
  eq("  per-seller breakdown == filtered view", shadowRow, filteredView);
  eq("  attempted == made under the canonical path", byExposedId.callsBreakdown.attempted, filteredView);

  console.log("\n  Confirmed split is consistent for the same scope");
  const s = base.callsShadow.bySeller[lucia.sellerId];
  eq("  connected", byExposedId.callsBreakdown.confirmedConnected, s.confirmedConnected);
  eq("  notConnected", byExposedId.callsBreakdown.confirmedNotConnected, s.confirmedNotConnected);
  eq("  unknown", byExposedId.callsBreakdown.unknown, s.unknown);

  console.log("\n  Σ dimensions == workspace");
  const sum = (rec: Record<string, any>) => Object.values(rec).reduce((a: any, t: any) => ({
    attempted: a.attempted + t.attempted, connected: a.connected + t.confirmedConnected,
    notConnected: a.notConnected + t.confirmedNotConnected, unknown: a.unknown + t.unknown,
  }), { attempted: 0, connected: 0, notConnected: 0, unknown: 0 });
  const w = base.callsShadow.workspace.canonical;
  for (const [n, rec] of [["sellers", base.callsShadow.bySeller], ["campaigns", base.callsShadow.byCampaign], ["ICPs", base.callsShadow.byIcp]] as const) {
    const t = sum(rec as any);
    eq(`  Σ ${n}`, `${t.attempted}/${t.connected}/${t.notConnected}/${t.unknown}`,
       `${w.attempted}/${w.confirmedConnected}/${w.confirmedNotConnected}/${w.unknown}`);
  }

  /* ── other metrics must not move ─────────────────────────────────────── */
  // The real payload shape. Names taken from EMPTY_DASHBOARD, not guessed:
  // an `undefined` on both sides compares equal and proves nothing, which is
  // how the first run of this check "passed" against nothing.
  const h = base.headline;
  const other = {
    "headline.totalLeads": h.totalLeads,
    "headline.contactedLeads": h.contactedLeads,
    "headline.enrolledLeads": h.enrolledLeads,
    "headline.connectedLeads": h.connectedLeads,
    "headline.leadsLoadedInPeriod": h.leadsLoadedInPeriod,
    "headline.repliedCount": h.repliedCount,
    "headline.positiveCount": h.positiveCount,
    "headline.negativeCount": h.negativeCount,
    "headline.responseRate": h.responseRate,
    "headline.positiveRate": h.positiveRate,
    "headline.conversionRate": h.conversionRate,
    "headline.acceptanceRate": h.acceptanceRate,
    "headline.acceptance": h.acceptance,
    "headline.replyEvents": h.replyEvents,
    "headline.inboundRepliesReceived": h.inboundRepliesReceived,
    funnel: base.funnel,
    channelBreakdown: base.channelBreakdown,
    replyClassCounts: base.replyClassCounts,
    linkedinConnections: base.linkedinConnections,
    stepPerformance: base.stepPerformance,
    heatmapByChannel: base.heatmapByChannel,
  };
  const undef = Object.entries(other).filter(([, v]) => v === undefined).map(([k]) => k);
  if (undef.length) {
    fail++; fails.push(`payload fields missing — comparison would be vacuous: ${undef.join(", ")}`);
    console.log(`  ✗ these fields are undefined: ${undef.join(", ")}`);
  }
  if (SNAP) { writeFileSync(SNAP, JSON.stringify(other, null, 2) + "\n"); console.log(`\n  other-metrics snapshot → ${SNAP}`); }
  if (COMPARE && existsSync(COMPARE)) {
    console.log("\n  Other metrics unchanged with canonical Calls ON");
    const prev = JSON.parse(readFileSync(COMPARE, "utf8"));
    for (const k of Object.keys(other)) eq(`  ${k}`, JSON.stringify((other as any)[k]), JSON.stringify(prev[k]));
  }

  console.log(`\n  ${"─".repeat(66)}\n  ${pass} passed · ${fail} failed`);
  if (fail) { for (const f of fails) console.log(`   · ${f}`); process.exit(1); }
  console.log("  Same metric, same scope, same number.\n");
};
main().catch(e => { console.error(e); process.exit(1); });
