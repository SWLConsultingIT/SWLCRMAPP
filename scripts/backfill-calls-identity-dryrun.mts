#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A · BACKFILL DRY RUN — canonical call identity.
//
// Reads production. Writes NOTHING. It produces:
//   · out/calls-recon-plan-<batch>.json  — the full proposal set
//   · out/calls-recon-plan-<batch>.sql   — INSERTs into calls_recon_plan,
//                                          for a human to run later
//   · a console report: totals, confidences, conflicts, canonical groups
//     before/after, and the per-seller before/after that the change will
//     actually be judged on.
//
// "Before" is reproduced with the CURRENT dashboard rules (realCallsInWindow
// + isConnected) so the comparison is against what the screen shows today,
// not against an idealisation. "After" groups by canonical_call_id and uses
// the Confirmed Connected / Not Connected / Unknown split.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
//   npx tsx scripts/backfill-calls-identity-dryrun.mts \
//     --tenant <bio_id> --from 2026-08-10 --to 2026-09-09
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  proposeMatches, highConfidence, mediumConfidence,
  toPhysicalCalls, callTotals, resolveCallSeller, explainUnmatched,
  isMarkerRow, isWebhookRow,
  type RawCallRow, type MatchProposal,
} from "../lib/metrics/calls-identity.ts";
import { realCallsInWindow, resolveWindow, inWindow, callOwner } from "../lib/metric-defs.ts";
import { isConnected } from "../lib/flow-metrics-lib.ts";

/* ── args + connection ────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

function readEnvFile(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split("\n").filter(l => l.includes("=") && !l.trimStart().startsWith("#")).map(l => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    ) as Record<string, string>;
  } catch { return {}; }
}
const fileEnv = readEnvFile();
const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? fileEnv.SUPABASE_SERVICE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !KEY_ || KEY_ === "placeholder") {
  console.error("\n[dryrun] no usable Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.\n");
  process.exit(2);
}
const svc = createClient(URL_, KEY_, { auth: { persistSession: false } });

const TENANT = arg("--tenant");            // report scope; the PLAN is global
const FROM = arg("--from");
const TO = arg("--to");
const BATCH = arg("--batch", `phase3a-${new Date().toISOString().slice(0, 10)}`)!;
const OUT = arg("--out", "out")!;

/* ── read-only paging ─────────────────────────────────────────────────── */

type Row = Record<string, unknown>;
async function all(table: string, select: string, tune?: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q: any = svc.from(table).select(select).order("id", { ascending: true }).range(from, from + 999);
    if (tune) q = tune(q);
    const { data, error } = await q;
    if (error) throw new Error(`[dryrun] ${table} page ${from}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const S = (v: unknown) => (v == null ? null : String(v));

async function main() {
  console.log(`\n  PHASE 3A · BACKFILL DRY RUN — batch ${BATCH}`);
  console.log(`  source ${URL_}   READ ONLY — no write is issued by this script\n`);

  const [callRows, leadRows, campRows, sellerRows] = await Promise.all([
    all("calls", "id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, direction, status, duration, classification, started_at, ended_at, phone_number, recording_url, recording_storage_path, transcript, notes, created_at"),
    all("leads", "id, company_bio_id"),
    all("campaigns", "id, lead_id, seller_id, assigned_user_id"),
    all("sellers", "id, name, user_id, company_bio_id"),
  ]);

  const calls = callRows as unknown as RawCallRow[];
  const tenantOfLead = new Map(leadRows.map(l => [String(l.id), S(l.company_bio_id) ?? ""]));
  const sellerName = new Map(sellerRows.map(s => [String(s.id), String(s.name)]));
  const sellerOfUser = new Map(sellerRows.filter(s => s.user_id).map(s => [String(s.user_id), String(s.id)]));
  const leadAssignedUser = new Map<string, string>();
  const leadSeller = new Map<string, string>();
  for (const c of campRows) {
    const lid = S(c.lead_id); if (!lid) continue;
    if (c.assigned_user_id && !leadAssignedUser.has(lid)) leadAssignedUser.set(lid, String(c.assigned_user_id));
    if (c.seller_id && !leadSeller.has(lid)) leadSeller.set(lid, String(c.seller_id));
  }
  // AFTER uses resolveCallSeller, which deliberately drops the flow's
  // LinkedIn sender as a fallback (everyone shares one Aircall seat, so that
  // fallback invents a dialler). BEFORE uses callOwner, which still has it.
  // The difference shows up as movement into Unattributed and is reported,
  // not smoothed over.
  const ctx = { sellerOfUser, leadAssignedUser };
  const legacyOpts = { sellerOfUser, leadAssignedUser, leadSeller };

  /* ── 1. Propose, per tenant ─────────────────────────────────────────── */
  // The matcher's contract is "every candidate row in scope (one tenant)".
  // Running it globally could pair rows across tenants that share a lead id
  // by accident; it cannot happen today, but the contract is the contract.
  const byTenant = new Map<string, RawCallRow[]>();
  for (const c of calls) {
    const t = c.lead_id ? (tenantOfLead.get(c.lead_id) ?? "no-lead") : "no-lead";
    (byTenant.get(t) ?? byTenant.set(t, []).get(t)!).push(c);
  }

  const proposals: MatchProposal[] = [];
  const why = { no_candidate: 0, ambiguous: 0, not_mutual: 0 };
  for (const [, rows] of byTenant) {
    const p = proposeMatches(rows);
    proposals.push(...p);
    const w = explainUnmatched(rows, p);
    why.no_candidate += w.no_candidate; why.ambiguous += w.ambiguous; why.not_mutual += w.not_mutual;
  }
  const high = highConfidence(proposals);
  const medium = mediumConfidence(proposals);

  /* ── 2. Conflicts — a row proposed twice, on either side ────────────── */
  const seen = new Map<string, number>();
  for (const p of proposals) {
    seen.set(p.webhookRowId, (seen.get(p.webhookRowId) ?? 0) + 1);
    seen.set(p.markerRowId, (seen.get(p.markerRowId) ?? 0) + 1);
  }
  const conflicts = [...seen.entries()].filter(([, n]) => n > 1);

  /* ── 3. Canonical groups before / after ─────────────────────────────── */
  // Before: every row is its own physical call (the seeded state).
  // After: HIGH proposals collapse a webhook into its marker's identity.
  const canonicalOf = new Map<string, string>(calls.map(c => [c.id, c.id]));
  for (const p of high) canonicalOf.set(p.webhookRowId, canonicalOf.get(p.markerRowId)!);
  const groupsBefore = calls.length;
  const groupsAfter = new Set([...canonicalOf.values()]).size;

  /* ── 4. Unmatched breakdown ─────────────────────────────────────────── */
  const linked = new Set<string>([...high.flatMap(p => [p.webhookRowId, p.markerRowId])]);
  const orphanMarkers = calls.filter(c => isMarkerRow(c) && !linked.has(c.id));
  const orphanWebhooks = calls.filter(c => isWebhookRow(c) && !linked.has(c.id));

  console.log("  ── PLAN ────────────────────────────────────────────────");
  console.log(`  rows in calls .................. ${calls.length}`);
  console.log(`    markers (no aircall_call_id) . ${calls.filter(isMarkerRow).length}`);
  console.log(`    webhook rows ................. ${calls.filter(isWebhookRow).length}`);
  console.log(`  HIGH   (≤15s, unique both ways)  ${high.length}   → apply automatically`);
  console.log(`  MEDIUM (15–120s) ............... ${medium.length}   → staged, human review, NOT applied`);
  console.log(`  unmatched markers .............. ${orphanMarkers.length}   (after HIGH only)`);
  console.log(`  unmatched webhook rows ......... ${orphanWebhooks.length}   (after HIGH only)`);
  console.log(`    · staged as MEDIUM ........... ${medium.length}   (matched, awaiting review)`);
  console.log(`    · no candidate marker ........ ${why.no_candidate}   (webhook with no marker within 120s)`);
  console.log(`    · ambiguous ................... ${why.ambiguous}   (2+ plausible markers — deliberately NOT linked)`);
  console.log(`    · not mutual .................. ${why.not_mutual}   (its marker preferred another webhook)`);
  console.log(`  conflicts (row proposed twice) . ${conflicts.length}`);
  console.log(`  canonical groups before → after  ${groupsBefore} → ${groupsAfter}  (−${groupsBefore - groupsAfter})`);

  /* ── 5. Per-seller before / after ───────────────────────────────────── */
  const win = resolveWindow(FROM, TO);
  const scoped = calls.filter(c => {
    if (!TENANT) return true;
    return c.lead_id ? tenantOfLead.get(c.lead_id) === TENANT : false;
  });

  // BEFORE — exactly what the dashboard computes today.
  const beforeCalls = realCallsInWindow(scoped as any[], win) as unknown as RawCallRow[];
  type Cell = { attempted: number; connected: number; notConnected: number; unknown: number };
  const blank = (): Cell => ({ attempted: 0, connected: 0, notConnected: 0, unknown: 0 });
  const before = new Map<string, Cell>();
  for (const c of beforeCalls) {
    const owner = callOwner(c, legacyOpts) ?? "UNATTRIBUTED";
    const cell = before.get(owner) ?? before.set(owner, blank()).get(owner)!;
    cell.attempted++;
    if (isConnected(c as any)) cell.connected++;
  }

  // AFTER — group by canonical identity, then the confirmed split.
  const withCanonical = scoped.map(c => ({ ...c, canonical_call_id: canonicalOf.get(c.id) ?? c.id }));
  const physical = toPhysicalCalls(withCanonical).filter(p => p.isReal && inWindow(p.startedAt, win));
  const after = new Map<string, Cell>();
  for (const p of physical) {
    const owner = resolveCallSeller(p, ctx) ?? "UNATTRIBUTED";
    const cell = after.get(owner) ?? after.set(owner, blank()).get(owner)!;
    cell.attempted++;
    if (p.connection === "confirmed_connected") cell.connected++;
    else if (p.connection === "confirmed_not_connected") cell.notConnected++;
    else cell.unknown++;
  }

  const rate = (c: number, n: number) => (c + n > 0 ? `${((c / (c + n)) * 100).toFixed(1)}%` : "—");
  const nm = (id: string) => (id === "UNATTRIBUTED" ? "Unattributed" : sellerName.get(id) ?? id.slice(0, 8));
  const ids = [...new Set([...before.keys(), ...after.keys()])]
    .sort((a, b) => (after.get(b)?.attempted ?? 0) - (after.get(a)?.attempted ?? 0));

  console.log(`\n  ── PER SELLER — ${TENANT ?? "all tenants"} · ${FROM ?? "all time"} → ${TO ?? "today"} ──`);
  console.log("  seller           attempted        connected (old)   →   confirmed conn.  not conn.  unknown   conf. rate");
  let tb = blank(), ta = blank();
  for (const id of ids) {
    const b = before.get(id) ?? blank(), a = after.get(id) ?? blank();
    tb.attempted += b.attempted; tb.connected += b.connected;
    ta.attempted += a.attempted; ta.connected += a.connected;
    ta.notConnected += a.notConnected; ta.unknown += a.unknown;
    console.log(
      `  ${nm(id).padEnd(16)} ${String(b.attempted).padStart(4)} → ${String(a.attempted).padEnd(6)}   ` +
      `${String(b.connected).padStart(4)}          →   ${String(a.connected).padStart(6)}    ` +
      `${String(a.notConnected).padStart(6)}   ${String(a.unknown).padStart(6)}   ${rate(a.connected, a.notConnected).padStart(7)}`,
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(16)} ${String(tb.attempted).padStart(4)} → ${String(ta.attempted).padEnd(6)}   ` +
    `${String(tb.connected).padStart(4)}          →   ${String(ta.connected).padStart(6)}    ` +
    `${String(ta.notConnected).padStart(6)}   ${String(ta.unknown).padStart(6)}   ${rate(ta.connected, ta.notConnected).padStart(7)}`,
  );

  // Σ sellers + unattributed must equal the workspace, by construction.
  const workspace = callTotals(physical);
  const sumOk = ta.attempted === workspace.attempted
    && ta.connected === workspace.confirmedConnected
    && ta.notConnected === workspace.confirmedNotConnected
    && ta.unknown === workspace.unknown;
  console.log(`\n  Σ sellers + unattributed == workspace ...... ${sumOk ? "OK" : "MISMATCH"}`);
  console.log(`  workspace: attempted ${workspace.attempted} · confirmed connected ${workspace.confirmedConnected} · ` +
    `not connected ${workspace.confirmedNotConnected} · unknown ${workspace.unknown} · ` +
    `confirmed connect rate ${workspace.confirmedConnectRate == null ? "—" : workspace.confirmedConnectRate.toFixed(1) + "%"}`);

  /* ── 6. Emit the plan. Files only. ──────────────────────────────────── */
  mkdirSync(OUT, { recursive: true });
  const rowById = new Map<string, RawCallRow>(calls.map(c => [c.id, c] as [string, RawCallRow]));
  const planRows = proposals.map(p => ({
    batch: BATCH,
    webhook_row_id: p.webhookRowId,
    marker_row_id: p.markerRowId,
    proposed_canonical_call_id: rowById.get(p.markerRowId)!.id,
    previous_canonical_call_id: rowById.get(p.webhookRowId)!.id,
    confidence: p.confidence,
    time_delta_seconds: p.timeDeltaSeconds,
    phone_match: p.phoneMatch,
    candidates_considered: p.candidatesConsidered,
  }));
  const json = `${OUT}/calls-recon-plan-${BATCH}.json`;
  writeFileSync(json, JSON.stringify({
    batch: BATCH, generated_at: new Date().toISOString(), source: URL_,
    totals: {
      rows: calls.length, high: high.length, medium: medium.length,
      orphan_markers: orphanMarkers.length, orphan_webhooks: orphanWebhooks.length,
      conflicts: conflicts.length, groups_before: groupsBefore, groups_after: groupsAfter,
      unmatched_webhook_reasons: why,
    },
    plan: planRows,
  }, null, 2));

  const q = (v: unknown) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
  const sql = `${OUT}/calls-recon-plan-${BATCH}.sql`;
  writeFileSync(sql,
    `-- PHASE 3A backfill plan · batch ${BATCH} · generated ${new Date().toISOString()}\n` +
    `-- STAGING ONLY. Inserting this changes no metric: calls.canonical_call_id is untouched.\n` +
    `-- Applying the plan is a separate, explicitly approved step.\n\n` +
    planRows.map(r =>
      `INSERT INTO public.calls_recon_plan (batch, webhook_row_id, marker_row_id, proposed_canonical_call_id, previous_canonical_call_id, confidence, time_delta_seconds, phone_match, candidates_considered) VALUES (${q(r.batch)}, ${q(r.webhook_row_id)}, ${q(r.marker_row_id)}, ${q(r.proposed_canonical_call_id)}, ${q(r.previous_canonical_call_id)}, ${q(r.confidence)}, ${r.time_delta_seconds}, ${q(r.phone_match)}, ${r.candidates_considered});`,
    ).join("\n") + "\n",
  );

  console.log(`\n  plan written (NOT applied):\n    ${json}\n    ${sql}\n`);
  if (conflicts.length > 0) { console.error("  CONFLICTS PRESENT — do not apply.\n"); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
