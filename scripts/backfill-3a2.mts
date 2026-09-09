#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.2 · Historical HIGH-confidence identity backfill.
//
// Regenerates the plan against the CURRENT database — forward links already
// exist, the reconciler applied 7, new calls arrived — and applies ONLY the
// HIGH tier. MEDIUM, ambiguous and LOW are reported and left alone.
//
// Identity is the only thing this touches. No row is deleted, no
// classification, duration, seller or aircall_call_id is written.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
//   npx tsx scripts/backfill-3a2.mts [--apply] [--batch <id>]
//
// Without --apply it is strictly read-only.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import {
  proposeMatches, highConfidence, mediumConfidence, explainUnmatched,
  toPhysicalCalls, callTotals, resolveCallSeller,
  isMarkerRow, isWebhookRow,
  type RawCallRow, type MatchProposal,
} from "../lib/metrics/calls-identity.ts";
import { realCallsInWindow, resolveWindow, inWindow, callOwner } from "../lib/metric-defs.ts";
import { isConnected } from "../lib/flow-metrics-lib.ts";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = argv.includes("--apply");
const BATCH = arg("--batch", `3a2-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`)!;
const OUT = arg("--out", "out")!;
const TENANT = arg("--tenant");
const FROM = arg("--from"), TO = arg("--to");

const URL_ = process.env.SUPABASE_URL, KEY_ = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY_) { console.error("\n[3a2] need SUPABASE_URL and SUPABASE_SERVICE_KEY\n"); process.exit(2); }
const svc = createClient(URL_, KEY_, { auth: { persistSession: false } });

type Row = Record<string, unknown>;
async function all(table: string, select: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from(table).select(select).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`[3a2] ${table} page ${from}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const S = (v: unknown) => (v == null ? null : String(v));
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k) ?? []; l.push(v); m.set(k, l); };

const main = async () => {
  console.log(`\n  PHASE 3A.2 · HISTORICAL HIGH BACKFILL — batch ${BATCH}`);
  console.log(`  ${URL_}   ${APPLY ? "APPLY MODE — will write identity" : "DRY RUN — read only"}\n`);

  const [callRows, leadRows, campRows, sellerRows] = await Promise.all([
    all("calls", "id, canonical_call_id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, direction, status, duration, classification, started_at, ended_at, phone_number, recording_url, recording_storage_path, transcript, notes, created_at"),
    all("leads", "id, company_bio_id, icp_profile_id"),
    all("campaigns", "id, lead_id, name, seller_id, assigned_user_id"),
    all("sellers", "id, name, user_id, company_bio_id"),
  ]);
  const calls = callRows as unknown as RawCallRow[];
  const tenantOfLead = new Map(leadRows.map(l => [String(l.id), S(l.company_bio_id) ?? ""]));
  const sellerName = new Map(sellerRows.map(s => [String(s.id), String(s.name)]));
  const sellerOfUser = new Map(sellerRows.filter(s => s.user_id).map(s => [String(s.user_id), String(s.id)]));
  const leadAssignedUser = new Map<string, string>(), leadSeller = new Map<string, string>();
  const leadCampaign = new Map<string, string>(), leadIcp = new Map<string, string>();
  for (const l of leadRows) if (l.icp_profile_id) leadIcp.set(String(l.id), String(l.icp_profile_id));

  for (const c of campRows) {
    const lid = S(c.lead_id); if (!lid) continue;
    if (c.assigned_user_id && !leadAssignedUser.has(lid)) leadAssignedUser.set(lid, String(c.assigned_user_id));
    if (c.seller_id && !leadSeller.has(lid)) leadSeller.set(lid, String(c.seller_id));
    if (c.name && !leadCampaign.has(lid)) leadCampaign.set(lid, String(c.name));
  }
  const ctx = { sellerOfUser, leadAssignedUser };
  const legacyOpts = { sellerOfUser, leadAssignedUser, leadSeller };
  const tenantOf = (c: RawCallRow) => (c.lead_id ? tenantOfLead.get(c.lead_id) ?? "no-lead" : "no-lead");

  /* ── existing identity, as it stands in the DB right now ────────────── */
  const canonicalNow = new Map<string, string>(calls.map(c => [c.id, c.canonical_call_id ?? c.id] as [string, string]));
  const groupMembers = new Map<string, RawCallRow[]>();
  for (const c of calls) push(groupMembers, canonicalNow.get(c.id)!, c);
  const groupsBefore = groupMembers.size;

  /* ── 1. Propose per tenant ──────────────────────────────────────────── */
  const byTenant = new Map<string, RawCallRow[]>();
  for (const c of calls) push(byTenant, tenantOf(c), c);

  const rawHigh: MatchProposal[] = [], rawMedium: MatchProposal[] = [];
  const why = { no_candidate: 0, ambiguous: 0, not_mutual: 0 };
  for (const [, rows] of byTenant) {
    const p = proposeMatches(rows);
    rawHigh.push(...highConfidence(p));
    rawMedium.push(...mediumConfidence(p));
    const w = explainUnmatched(rows, p);
    why.no_candidate += w.no_candidate; why.ambiguous += w.ambiguous; why.not_mutual += w.not_mutual;
  }

  /* ── 2. Filter HIGH against identity that already exists ────────────── */
  // Three ways a HIGH proposal is NOT actionable:
  //   already   — the two rows are already in one group; nothing to do
  //   conflict  — applying it would drag a THIRD row along, or merge two
  //               groups that each already hold an Aircall-confirmed call.
  //               A merge we cannot justify row by row is not a merge.
  const actionable: MatchProposal[] = [];
  const already: MatchProposal[] = [];
  const conflicts: Array<{ p: MatchProposal; reason: string }> = [];
  for (const p of rawHigh) {
    const mCanon = canonicalNow.get(p.markerRowId)!, wCanon = canonicalNow.get(p.webhookRowId)!;
    if (mCanon === wCanon) { already.push(p); continue; }
    const mGroup = groupMembers.get(mCanon) ?? [], wGroup = groupMembers.get(wCanon) ?? [];
    if (wGroup.length > 1) { conflicts.push({ p, reason: `webhook already grouped with ${wGroup.length - 1} other row(s)` }); continue; }
    if (mGroup.some(r => isWebhookRow(r))) { conflicts.push({ p, reason: "marker's group already holds an Aircall-confirmed row" }); continue; }
    if (mGroup.length > 2) { conflicts.push({ p, reason: `marker's group already holds ${mGroup.length} rows` }); continue; }
    actionable.push(p);
  }

  /* ── 3. Report ──────────────────────────────────────────────────────── */
  const canonicalAfter = new Map(canonicalNow);
  for (const p of actionable) canonicalAfter.set(p.webhookRowId, canonicalNow.get(p.markerRowId)!);
  const groupsAfter = new Set([...canonicalAfter.values()]).size;

  console.log("  ── PLAN ────────────────────────────────────────────────");
  console.log(`  raw calls rows ................. ${calls.length}   (${calls.filter(isMarkerRow).length} markers · ${calls.filter(isWebhookRow).length} webhooks)`);
  console.log(`  existing canonical groups ...... ${groupsBefore}`);
  console.log(`  new HIGH pairs (actionable) .... ${actionable.length}`);
  console.log(`  already linked ................. ${already.length}`);
  console.log(`  MEDIUM (15–120s) ............... ${rawMedium.length}   → NOT applied`);
  console.log(`  ambiguous ...................... ${why.ambiguous}   → NOT applied`);
  console.log(`  not mutual ..................... ${why.not_mutual}   → NOT applied`);
  console.log(`  LOW / unmatched ................ ${why.no_candidate}`);
  console.log(`  conflicts ...................... ${conflicts.length}`);
  for (const c of conflicts.slice(0, 10)) console.log(`      · ${c.p.webhookRowId.slice(0, 8)} ← ${c.p.markerRowId.slice(0, 8)}  ${c.reason}`);
  console.log(`  canonical groups ............... ${groupsBefore} → ${groupsAfter}  (−${groupsBefore - groupsAfter})`);

  console.log("\n  ── POR TENANT ──────────────────────────────────────────");
  const tenantName = new Map<string, string>();
  for (const s of sellerRows) if (s.company_bio_id) tenantName.set(String(s.company_bio_id), "");
  const perTenant = new Map<string, { rows: number; actionable: number; medium: number; groupsB: Set<string>; groupsA: Set<string> }>();
  for (const c of calls) {
    const t = tenantOf(c);
    const e = perTenant.get(t) ?? { rows: 0, actionable: 0, medium: 0, groupsB: new Set<string>(), groupsA: new Set<string>() };
    e.rows++; e.groupsB.add(canonicalNow.get(c.id)!); e.groupsA.add(canonicalAfter.get(c.id)!);
    perTenant.set(t, e);
  }
  const rowById = new Map<string, RawCallRow>(calls.map(c => [c.id, c] as [string, RawCallRow]));
  for (const p of actionable) perTenant.get(tenantOf(rowById.get(p.webhookRowId)!))!.actionable++;
  for (const p of rawMedium) perTenant.get(tenantOf(rowById.get(p.webhookRowId)!))!.medium++;
  for (const [t, e] of [...perTenant.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`  ${t.slice(0, 8).padEnd(10)} rows ${String(e.rows).padStart(5)} · HIGH ${String(e.actionable).padStart(4)} · MEDIUM ${String(e.medium).padStart(3)} · groups ${e.groupsB.size} → ${e.groupsA.size}`);
  }

  /* ── 4. Seller impact (proposed) ────────────────────────────────────── */
  const win = resolveWindow(FROM, TO);
  const scopedTenant = TENANT ?? "7c02e222-be59-416d-9434-acf4685f8590";
  const scoped = calls.filter(c => tenantOf(c) === scopedTenant);

  type Cell = { attempted: number; connected: number; notConnected: number; unknown: number };
  const blank = (): Cell => ({ attempted: 0, connected: 0, notConnected: 0, unknown: 0 });

  const legacy = new Map<string, Cell>();
  for (const c of realCallsInWindow(scoped as any[], win) as unknown as RawCallRow[]) {
    const o = callOwner(c, legacyOpts) ?? "UNATTRIBUTED";
    const cell = legacy.get(o) ?? legacy.set(o, blank()).get(o)!;
    cell.attempted++; if (isConnected(c as any)) cell.connected++;
  }
  const physical = toPhysicalCalls(scoped.map(c => ({ ...c, canonical_call_id: canonicalAfter.get(c.id)! })))
    .filter(p => p.isReal && inWindow(p.startedAt, win));
  const canon = new Map<string, Cell>();
  for (const p of physical) {
    const o = resolveCallSeller(p, ctx) ?? "UNATTRIBUTED";
    const cell = canon.get(o) ?? canon.set(o, blank()).get(o)!;
    cell.attempted++;
    if (p.connection === "confirmed_connected") cell.connected++;
    else if (p.connection === "confirmed_not_connected") cell.notConnected++;
    else cell.unknown++;
  }
  const rate = (c: number, n: number) => (c + n > 0 ? `${((c / (c + n)) * 100).toFixed(1)}%` : "—");
  const nm = (id: string) => (id === "UNATTRIBUTED" ? "Unattributed" : sellerName.get(id) ?? id.slice(0, 8));

  console.log(`\n  ── SELLER IMPACT — tenant ${scopedTenant.slice(0, 8)} · ${FROM ?? "all time"} → ${TO ?? "today"} ──`);
  console.log("  seller            legacy    canonical    diff      conn   notConn  unknown   conf.rate");
  const ids = [...new Set([...legacy.keys(), ...canon.keys()])].sort((a, b) => (canon.get(b)?.attempted ?? 0) - (canon.get(a)?.attempted ?? 0));
  const tl = blank(), tc = blank();
  for (const id of ids) {
    const l = legacy.get(id) ?? blank(), c = canon.get(id) ?? blank();
    tl.attempted += l.attempted; tl.connected += l.connected;
    tc.attempted += c.attempted; tc.connected += c.connected; tc.notConnected += c.notConnected; tc.unknown += c.unknown;
    console.log(`  ${nm(id).padEnd(17)} ${String(l.attempted).padStart(5)} ${String(c.attempted).padStart(11)} ${String(c.attempted - l.attempted).padStart(7)}  ${String(c.connected).padStart(7)} ${String(c.notConnected).padStart(8)} ${String(c.unknown).padStart(8)}   ${rate(c.connected, c.notConnected).padStart(8)}`);
  }
  console.log(`  ${"TOTAL".padEnd(17)} ${String(tl.attempted).padStart(5)} ${String(tc.attempted).padStart(11)} ${String(tc.attempted - tl.attempted).padStart(7)}  ${String(tc.connected).padStart(7)} ${String(tc.notConnected).padStart(8)} ${String(tc.unknown).padStart(8)}   ${rate(tc.connected, tc.notConnected).padStart(8)}`);

  const ws = callTotals(physical);
  const sumOk = tc.attempted === ws.attempted && tc.connected === ws.confirmedConnected
    && tc.notConnected === ws.confirmedNotConnected && tc.unknown === ws.unknown;
  console.log(`\n  Σ sellers + unattributed == workspace ...... ${sumOk ? "OK" : "MISMATCH"}`);
  const identity = ws.confirmedConnected + ws.confirmedNotConnected + ws.unknown === ws.attempted;
  console.log(`  connected + notConnected + unknown == attempted ... ${identity ? "OK" : "MISMATCH"}`);

  /* ── 5. Emit plan file ──────────────────────────────────────────────── */
  mkdirSync(OUT, { recursive: true });
  const planRows = actionable.map(p => ({
    batch: BATCH,
    webhook_row_id: p.webhookRowId,
    marker_row_id: p.markerRowId,
    proposed_canonical_call_id: canonicalNow.get(p.markerRowId)!,
    previous_canonical_call_id: canonicalNow.get(p.webhookRowId)!,
    confidence: p.confidence,
    time_delta_seconds: p.timeDeltaSeconds,
    phone_match: p.phoneMatch,
    candidates_considered: p.candidatesConsidered,
  }));
  writeFileSync(`${OUT}/plan-${BATCH}.json`, JSON.stringify({
    batch: BATCH, generated_at: new Date().toISOString(), applied: APPLY,
    totals: {
      rows: calls.length, groups_before: groupsBefore, groups_after: groupsAfter,
      high_actionable: actionable.length, already_linked: already.length,
      medium: rawMedium.length, ambiguous: why.ambiguous, not_mutual: why.not_mutual,
      unmatched: why.no_candidate, conflicts: conflicts.length,
    },
    plan: planRows,
  }, null, 2) + "\n");
  console.log(`\n  plan → ${OUT}/plan-${BATCH}.json`);

  if (!sumOk || !identity) { console.error("\n  PLAN INCONSISTENT — refusing to apply.\n"); process.exit(1); }
  if (conflicts.length > 0 && APPLY) console.log(`  (${conflicts.length} conflicts are skipped, not applied)`);

  /* ── 6. Apply ───────────────────────────────────────────────────────── */
  if (!APPLY) { console.log(`\n  DRY RUN — nothing written. Re-run with --apply to execute.\n`); return; }

  let applied = 0, failed = 0;
  for (const r of planRows) {
    const { error: planErr } = await svc.from("calls_recon_plan").insert(r);
    if (planErr) { console.error(`  plan insert failed for ${r.webhook_row_id}: ${planErr.message}`); failed++; continue; }
    // Optimistic: only if the identity is still what the plan was built on.
    // `.select()` so a row that moved underneath us is a visible no-op rather
    // than a silent one — 0 rows returned is a failure, not a success.
    const { data: touched, error: upErr } = await svc.from("calls")
      .update({ canonical_call_id: r.proposed_canonical_call_id })
      .eq("id", r.webhook_row_id)
      .eq("canonical_call_id", r.previous_canonical_call_id)
      .select("id");
    if (upErr) { console.error(`  update failed for ${r.webhook_row_id}: ${upErr.message}`); failed++; continue; }
    if (!touched || touched.length !== 1) {
      console.error(`  STALE: ${r.webhook_row_id} moved since the plan was built — skipped`);
      failed++; continue;
    }
    await svc.from("calls_recon_plan").update({ applied_at: new Date().toISOString() })
      .eq("batch", r.batch).eq("webhook_row_id", r.webhook_row_id);
    await svc.from("calls_recon_log").insert({
      canonical_call_id: r.proposed_canonical_call_id,
      row_ids: [r.marker_row_id, r.webhook_row_id],
      match_method: "backfill_high",
      confidence: "high",
      time_delta_seconds: r.time_delta_seconds,
      phone_match: r.phone_match,
      candidates_considered: r.candidates_considered,
      notes: `batch ${r.batch}`,
      reconciled_by: "scripts/backfill-3a2",
    });
    applied++;
  }
  console.log(`\n  APPLIED ${applied} · failed ${failed} · batch ${BATCH}\n`);
  if (failed) process.exit(1);
};

main().catch(e => { console.error(e); process.exit(1); });
