#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.3 · STEP D — what the UI actually RENDERS vs the verifier.
//
// A screenshot proves a page rendered; it does not prove the number on it is
// right. capture-authenticated.mts scrapes the Calls card out of the DOM into
// visible-numbers.json; this diffs that against the independent verifier.
//
//   npx tsx scripts/verify-visible-calls.mts \
//     --shots docs/audits/phase3a/shots --indep-30 /tmp/indep-30.json
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SHOTS = arg("--shots", "docs/audits/phase3a/shots")!;
const FILE = `${SHOTS}/visible-numbers.json`;
const LUCIA = arg("--lucia", "5e5085ca-4bb4-4bac-a4b6-323bf8917f35")!;
const ODOO_CAMPAIGN = arg("--campaign", "Odoo Implementation — Argentina - Multicanal")!;
const ODOO_ICP = arg("--icp", "9afe82a7-8310-4b8e-ad91-933156134ee2")!;

if (!existsSync(FILE)) {
  console.error(`\n  [visible] ${FILE} not found.\n  Run: npm run dev:prod-readonly, then npx tsx scripts/capture-authenticated.mts\n`);
  process.exit(2);
}
const seen = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Record<string, number | null>>;
const ind = JSON.parse(readFileSync(arg("--indep-30", "/tmp/indep-30.json")!, "utf8"));

let pass = 0, fail = 0; const fails: string[] = [];
const cmp = (label: string, got: number | null | undefined, want: number | null) => {
  const g = got ?? null;
  const w = want == null ? null : Math.round(want * 10) / 10;
  if (Object.is(g, w)) { pass++; console.log(`    ✓ ${label.padEnd(24)} ${g}`); }
  else { fail++; fails.push(`${label}: rendered ${g} vs verifier ${w}`); console.log(`    ✗ ${label.padEnd(24)} rendered ${g} · verifier ${w}`); }
};

const cases: Array<[string, any]> = [
  ["overview-30d", ind.workspace],
  ["sellers-30d", ind.workspace],
  ["campaigns-30d", ind.workspace],
  ["icps-30d", ind.workspace],
  ["channels-30d", ind.workspace],
  ["overview-seller", ind.bySeller[LUCIA]],
  ["overview-campaign", ind.byCampaign[ODOO_CAMPAIGN]],
  ["overview-icp", ind.byIcp[ODOO_ICP]],
];

console.log(`\n  VISIBLE UI vs INDEPENDENT VERIFIER\n`);
for (const [name, exp] of cases) {
  const got = seen[name];
  console.log(`  ${name}`);
  if (!got) { fail++; fails.push(`${name}: not captured`); console.log("    ✗ not captured"); continue; }
  if (!exp) { fail++; fails.push(`${name}: no verifier baseline`); console.log("    ✗ no verifier baseline — comparison would be vacuous"); continue; }
  cmp("attempted", got.attempted, exp.attempted);
  cmp("confirmed connected", got.confirmedConnected, exp.connected);
  cmp("confirmed not conn.", got.confirmedNotConnected, exp.notConnected);
  cmp("unknown", got.unknown, exp.unknown);
  cmp("confirmed connect rate", got.confirmedConnectRate, exp.rate);
}
console.log(`\n  ${"─".repeat(60)}\n  ${pass} green · ${fail} RED`);
if (fail) { for (const f of fails) console.log(`   · ${f}`); process.exit(1); }
console.log("  What the UI renders equals the independent truth.\n");
