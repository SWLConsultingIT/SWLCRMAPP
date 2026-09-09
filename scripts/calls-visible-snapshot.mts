#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.1 · Snapshot of every CALL number the dashboard renders.
//
// Runs the real getDashboardData (same harness as render-reconcile) and
// records only the call-derived fields, across the filter dimensions that
// have their own call path: workspace, seller, campaign, ICP.
//
// Taken BEFORE the forward rollout and again AFTER. If any value moves, the
// rollout changed a visible number and must stop — the whole point of
// separating WRITE from READ is that this diff is empty.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… HARNESS_TENANT_ID=… \
//   npx tsx --tsconfig tsconfig.render.json scripts/calls-visible-snapshot.mts <out.json>
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, existsSync } from "fs";
import { getDashboardData } from "../lib/dashboard-data.ts";

const TENANT = process.env.HARNESS_TENANT_ID!;
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !TENANT) {
  console.error("\n[snapshot] need SUPABASE_URL, SUPABASE_SERVICE_KEY and HARNESS_TENANT_ID\n");
  process.exit(2);
}

// dashboard-data builds its client from NEXT_PUBLIC_SUPABASE_URL, which on a
// dev machine points at localhost. The harness runs against production, so
// the explicit SUPABASE_URL wins here too.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;

const OUT = process.argv[2] ?? "/tmp/calls-snapshot.json";
const COMPARE = process.argv[3];

const day = (d: Date) => new Date(d.getTime() - 180 * 60_000).toISOString().slice(0, 10);
const TO = day(new Date());
const FROM = day(new Date(Date.now() - 29 * 86_400_000));

type Filters = Parameters<typeof getDashboardData>[0];
const base = { from: FROM, to: TO } as Filters;

async function callFields(label: string, f: Filters) {
  const d: any = await getDashboardData(f);
  return {
    label,
    unavailable: d.unavailable,
    // Overview
    callsBreakdown: d.callsBreakdown,
    // Sellers — one row per seller, the table the tab renders
    callOutcomesBySeller: (d.callOutcomesBySeller ?? []).map((s: any) => ({
      sellerId: s.sellerId, sellerName: s.sellerName,
      made: s.made, answered: s.answered, interested: s.interested,
      badTiming: s.badTiming, voicemail: s.voicemail,
      notInterested: s.notInterested, wrongNumber: s.wrongNumber,
    })),
    priorCallsBySeller: d.priorCallsBySeller ?? {},
  };
}

const main = async () => {
  const sellers: string[] = [];
  const first: any = await getDashboardData(base);
  for (const s of first.callOutcomesBySeller ?? []) sellers.push(s.sellerId);

  const snaps = [await callFields("workspace", base)];
  for (const sid of sellers.slice(0, 3)) {
    snaps.push(await callFields(`seller:${sid}`, { ...base, sellerIds: [sid] }));
  }
  const campaignNames: string[] = (first.campaignPerformance ?? []).slice(0, 2).map((c: any) => c.name);
  for (const n of campaignNames) {
    snaps.push(await callFields(`campaign:${n}`, { ...base, campaignNames: [n] }));
  }
  const icpIds: string[] = (first.icpPerformance ?? []).slice(0, 2).map((i: any) => i.id ?? i.icpId).filter(Boolean);
  for (const id of icpIds) {
    snaps.push(await callFields(`icp:${id}`, { ...base, icpIds: [id] }));
  }

  const payload = { tenant: TENANT, from: FROM, to: TO, taken_at: new Date().toISOString(), snaps };
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\n  snapshot: ${snaps.length} cases → ${OUT}`);
  for (const s of snaps) {
    console.log(`   ${s.label.padEnd(46)} made ${String(s.callsBreakdown?.made).padStart(4)} · answered ${String(s.callsBreakdown?.answered).padStart(4)} · positive ${String(s.callsBreakdown?.positive).padStart(3)} · sellers ${s.callOutcomesBySeller.length}`);
  }

  if (COMPARE && existsSync(COMPARE)) {
    const prev = JSON.parse(readFileSync(COMPARE, "utf8"));
    const a = JSON.stringify(prev.snaps);
    const b = JSON.stringify(payload.snaps);
    if (a === b) {
      console.log(`\n  DIFF vs ${COMPARE}: IDENTICAL — no visible call number moved.\n`);
    } else {
      console.error(`\n  DIFF vs ${COMPARE}: CHANGED. Investigate before continuing.\n`);
      for (let i = 0; i < payload.snaps.length; i++) {
        const x = JSON.stringify(prev.snaps[i]), y = JSON.stringify(payload.snaps[i]);
        if (x !== y) console.error(`   · ${payload.snaps[i].label}\n     before ${x}\n     after  ${y}`);
      }
      process.exit(1);
    }
  }
};

main().catch(e => { console.error(e); process.exit(1); });
