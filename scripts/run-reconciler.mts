#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.1 · Run the reconciliation sweep and report orphan rate.
//
// Uses lib/metrics/reconcile-sweep — the SAME code the cron route runs, so
// what is measured here is what is deployed.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
//   npx tsx scripts/run-reconciler.mts [--hours 48] [--dry]
//
// --dry reports what it would link without writing anything.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { runReconcileSweep } from "../lib/metrics/reconcile-sweep.ts";
import { proposeMatches, highConfidence, isMarkerRow, isWebhookRow, type RawCallRow } from "../lib/metrics/calls-identity.ts";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");
const HOURS = Number(arg("--hours", "48"));

const URL_ = process.env.SUPABASE_URL, KEY_ = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY_) { console.error("\n[reconciler] need SUPABASE_URL and SUPABASE_SERVICE_KEY\n"); process.exit(2); }
const svc = createClient(URL_, KEY_, { auth: { persistSession: false } });

/** Share of Aircall-confirmed rows that are NOT grouped with a marker. */
async function orphanRate(sinceIso: string) {
  const { data, error } = await svc
    .from("calls")
    .select("id, canonical_call_id, aircall_call_id, started_at")
    .gte("started_at", sinceIso)
    .order("id", { ascending: true })
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; canonical_call_id: string | null; aircall_call_id: unknown }>;
  const size = new Map<string, number>();
  for (const r of rows) {
    const k = r.canonical_call_id ?? r.id;
    size.set(k, (size.get(k) ?? 0) + 1);
  }
  const webhooks = rows.filter(r => r.aircall_call_id != null);
  const alone = webhooks.filter(r => (size.get(r.canonical_call_id ?? r.id) ?? 1) === 1);
  return {
    webhooks: webhooks.length,
    orphans: alone.length,
    rate: webhooks.length ? (alone.length / webhooks.length) * 100 : 0,
  };
}

const main = async () => {
  const since = new Date(Date.now() - HOURS * 3600_000).toISOString();
  console.log(`\n  RECONCILER · last ${HOURS}h${DRY ? "  (DRY — no writes)" : ""}\n  since ${since}\n`);

  const before = await orphanRate(since);
  console.log(`  orphan rate BEFORE ... ${before.orphans}/${before.webhooks} webhook rows unlinked  (${before.rate.toFixed(1)}%)`);

  if (DRY) {
    const { data } = await svc.from("calls")
      .select("id, canonical_call_id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, direction, status, duration, classification, started_at, phone_number")
      .gte("started_at", since).order("id", { ascending: true }).limit(5000);
    const rows = (data ?? []) as unknown as RawCallRow[];
    const p = highConfidence(proposeMatches(rows));
    console.log(`  rows scanned ......... ${rows.length}  (${rows.filter(isMarkerRow).length} markers · ${rows.filter(isWebhookRow).length} webhooks)`);
    console.log(`  would link ........... ${p.length}\n`);
    return;
  }

  const r1 = await runReconcileSweep(svc, { lookbackHours: HOURS, reconciledBy: "scripts/run-reconciler" });
  console.log(`  rows scanned ......... ${r1.rowsScanned}`);
  console.log(`  HIGH pairs ........... ${r1.highConfidencePairs}`);
  console.log(`  linked ............... ${r1.linked}`);
  console.log(`  already linked ....... ${r1.alreadyLinked}`);
  console.log(`  failed ............... ${r1.failed}`);

  // Idempotence is a property, not a hope. Prove it on every run.
  const r2 = await runReconcileSweep(svc, { lookbackHours: HOURS, reconciledBy: "scripts/run-reconciler" });
  const idempotent = r2.linked === 0 && r2.failed === 0;
  console.log(`\n  second run ........... linked ${r2.linked} · already ${r2.alreadyLinked} · failed ${r2.failed}  → ${idempotent ? "IDEMPOTENT" : "NOT IDEMPOTENT"}`);

  const after = await orphanRate(since);
  console.log(`\n  orphan rate AFTER .... ${after.orphans}/${after.webhooks} webhook rows unlinked  (${after.rate.toFixed(1)}%)`);
  console.log(`  change ............... ${(after.rate - before.rate).toFixed(1)} pp\n`);
  if (!idempotent) process.exit(1);
};

main().catch(e => { console.error(e); process.exit(1); });
