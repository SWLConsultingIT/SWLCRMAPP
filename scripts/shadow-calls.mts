#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.3 · SHADOW comparison.
//
// Runs the REAL dashboard aggregation (lib/dashboard-data.ts, unmodified —
// the exact function app/page.tsx awaits) for each case, and diffs its
// canonical Calls output against scripts/verify-calls-independent.mts, which
// shares no code with it.
//
// RED = any disagreement. Nothing is auto-corrected: a new RED cause is a
// finding to document, not to patch.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… HARNESS_TENANT_ID=… \
//   npx tsx --tsconfig tsconfig.render.json scripts/shadow-calls.mts
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { getDashboardData } from "../lib/dashboard-data.ts";

const TENANT = process.env.HARNESS_TENANT_ID!;
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !TENANT) {
  console.error("\n[shadow] need SUPABASE_URL, SUPABASE_SERVICE_KEY, HARNESS_TENANT_ID\n");
  process.exit(2);
}
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const day = (d: Date) => new Date(d.getTime() - 180 * 60_000).toISOString().slice(0, 10);
const TODAY = day(new Date());
const D30 = day(new Date(Date.now() - 29 * 86_400_000));

type IndepFile = {
  workspace: any; bySeller: Record<string, any>; byCampaign: Record<string, any>; byIcp: Record<string, any>;
  sellerNames: Record<string, string>;
};
const indepAll: IndepFile = JSON.parse(readFileSync(arg("--indep-all", "/tmp/indep-all.json")!, "utf8"));
const indep30: IndepFile = JSON.parse(readFileSync(arg("--indep-30", "/tmp/indep-30.json")!, "utf8"));

let red = 0, green = 0;
const reds: string[] = [];
const cmp = (label: string, a: number | null, b: number | null) => {
  const ok = a === b || (a == null && b == null);
  if (ok) { green++; return `${String(a ?? "—").padStart(6)}`; }
  red++; reds.push(`${label}: dashboard ${a} vs independent ${b}`);
  return `${String(a ?? "—").padStart(6)}✗`;
};

type Case = { id: string; label: string; from: string | null; to: string | null; indep: IndepFile;
  sellerIds?: string[]; campaignNames?: string[]; icpIds?: string[];
  pick: (f: IndepFile) => any };

const main = async () => {
  // Seller ids come from the independent side, i.e. real `sellers.id`.
  // NOT from callOutcomesBySeller.sellerId, which carries an auth user id —
  // see RED cause #1. Feeding that to the filter silently returns 0 and the
  // comparison would pass against nothing.
  const luciaId = Object.keys(indep30.bySeller)
    .find(id => /lucia/i.test(indep30.sellerNames[id] ?? ""));
  const odooCamp = Object.keys(indep30.byCampaign).find(n => /odoo/i.test(n));
  const odooIcp = Object.entries(indep30.byIcp)
    .find(([id]) => id !== "NO ICP" && indep30.byCampaign[odooCamp ?? ""] &&
      (indep30.byIcp[id]?.attempted === indep30.byCampaign[odooCamp ?? ""]?.attempted))?.[0]
    ?? Object.keys(indep30.byIcp).find(id => id !== "NO ICP");

  const cases: Case[] = [
    { id: "C1", label: "All time · workspace", from: null, to: null, indep: indepAll, pick: f => f.workspace },
    { id: "C2", label: "Last 30 days · workspace", from: D30, to: TODAY, indep: indep30, pick: f => f.workspace },
    { id: "C3", label: `Seller Lucia · 30d`, from: D30, to: TODAY, indep: indep30,
      sellerIds: luciaId ? [luciaId] : [], pick: f => f.bySeller[luciaId ?? ""] },
    { id: "C4", label: `Campaign ${odooCamp ?? "Odoo"} · 30d`, from: D30, to: TODAY, indep: indep30,
      campaignNames: odooCamp ? [odooCamp] : [], pick: f => f.byCampaign[odooCamp ?? ""] },
    { id: "C5", label: `ICP ${(odooIcp ?? "").slice(0, 8)} · 30d`, from: D30, to: TODAY, indep: indep30,
      icpIds: odooIcp ? [odooIcp] : [], pick: f => f.byIcp[odooIcp ?? ""] },
  ];

  console.log(`\n  SHADOW — canonical Calls vs independent verifier   tenant ${TENANT.slice(0, 8)}`);
  console.log(`  flag CALLS_CANONICAL_IDENTITY = ${process.env.CALLS_CANONICAL_IDENTITY ?? "(unset → off)"}\n`);
  console.log("  case  scope                                   attempted  conn  notConn  unknown    rate");

  for (const c of cases) {
    const d: any = await getDashboardData({
      from: c.from, to: c.to,
      ...(c.sellerIds?.length ? { sellerIds: c.sellerIds } : {}),
      ...(c.campaignNames?.length ? { campaignNames: c.campaignNames } : {}),
      ...(c.icpIds?.length ? { icpIds: c.icpIds } : {}),
    });
    const b = d.callsBreakdown;
    const e = c.pick(c.indep);
    if (!e) {
      red++; reds.push(`${c.id}: the independent side has no entry for this scope — comparison would be vacuous`);
      console.log(`  ${c.id}    ${c.label.slice(0, 38).padEnd(40)} RED — no independent baseline for this key`);
      continue;
    }
    const rateD = b.confirmedConnectRate == null ? null : Math.round(b.confirmedConnectRate * 10) / 10;
    console.log(
      `  ${c.id}    ${c.label.slice(0, 38).padEnd(40)} ` +
      `${cmp(`${c.id} attempted`, b.attempted, e.attempted)} ` +
      `${cmp(`${c.id} connected`, b.confirmedConnected, e.connected)} ` +
      `${cmp(`${c.id} notConnected`, b.confirmedNotConnected, e.notConnected)} ` +
      `${cmp(`${c.id} unknown`, b.unknown, e.unknown)} ` +
      `${cmp(`${c.id} rate`, rateD, e.rate)}`,
    );
    // Shadow payload: what would change if the flag were flipped.
    const sh = d.callsShadow;
    if (sh && c.id === "C2") {
      console.log(`        legacy made ${sh.workspace.legacy.attempted} → canonical ${sh.workspace.canonical.attempted}` +
        `  (Δ ${sh.workspace.attemptedDelta >= 0 ? "+" : ""}${sh.workspace.attemptedDelta}) · ` +
        `legacy answered ${sh.workspace.legacy.connected} → confirmed connected ${sh.workspace.canonical.confirmedConnected}` +
        ` (Δ ${sh.workspace.connectedDelta >= 0 ? "+" : ""}${sh.workspace.connectedDelta})`);
    }
  }

  /* ── Σ dimensions == workspace, from the dashboard's own payload ────── */
  const d30: any = await getDashboardData({ from: D30, to: TODAY });
  const sh = d30.callsShadow;
  const sumOf = (rec: Record<string, any>) => Object.values(rec).reduce((a: any, t: any) => ({
    attempted: a.attempted + t.attempted, connected: a.connected + t.confirmedConnected,
    notConnected: a.notConnected + t.confirmedNotConnected, unknown: a.unknown + t.unknown,
  }), { attempted: 0, connected: 0, notConnected: 0, unknown: 0 });
  const w = sh.workspace.canonical;
  for (const [name, rec] of [["sellers", sh.bySeller], ["campaigns", sh.byCampaign], ["ICPs", sh.byIcp]] as const) {
    const s = sumOf(rec as Record<string, any>);
    const ok = s.attempted === w.attempted && s.connected === w.confirmedConnected
      && s.notConnected === w.confirmedNotConnected && s.unknown === w.unknown;
    if (ok) green++; else { red++; reds.push(`Σ ${name} != workspace: ${JSON.stringify(s)} vs ${JSON.stringify(w)}`); }
    console.log(`  Σ ${name.padEnd(10)} == workspace ... ${ok ? "OK" : "RED"}`);
  }

  console.log(`\n  ${"─".repeat(72)}\n  ${green} green · ${red} RED`);
  if (red) { console.log("\n  RED causes:"); for (const r of reds) console.log(`   · ${r}`); process.exit(1); }
  console.log("  Canonical Calls agree with the independent verifier on every case.\n");
};

main().catch(e => { console.error(e); process.exit(1); });
