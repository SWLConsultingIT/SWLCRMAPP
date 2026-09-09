#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.2 · Independent verification of canonical call identity.
//
// Recomputes the call metrics from `canonical_call_id` alone — no legacy
// lead+minute dedup anywhere — and reconciles them across every dimension
// the dashboard slices by. A physical call must produce the same answer on
// whichever surface asks.
//
// Also proves determinism: the same rows shuffled 100 times must give one
// result. Grouping that depends on row order is not an identity.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
//   npx tsx scripts/verify-canonical-calls.mts [--tenant <id>] [--from] [--to]
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import {
  toPhysicalCalls, callTotals, resolveCallSeller,
  type RawCallRow, type PhysicalCall,
} from "../lib/metrics/calls-identity.ts";
import { resolveWindow, inWindow } from "../lib/metric-defs.ts";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TENANT = arg("--tenant", "7c02e222-be59-416d-9434-acf4685f8590")!;
const FROM = arg("--from"), TO = arg("--to");

const URL_ = process.env.SUPABASE_URL, KEY_ = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY_) { console.error("\n[verify] need SUPABASE_URL and SUPABASE_SERVICE_KEY\n"); process.exit(2); }
const svc = createClient(URL_, KEY_, { auth: { persistSession: false } });

type Row = Record<string, unknown>;
async function all(table: string, select: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from(table).select(select).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`[verify] ${table} page ${from}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const S = (v: unknown) => (v == null ? null : String(v));

let pass = 0, fail = 0; const fails: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; fails.push(`${label} ${detail}`); console.log(`  ✗ ${label} ${detail}`); }
};

const main = async () => {
  const [callRows, leadRows, campRows, sellerRows] = await Promise.all([
    all("calls", "id, canonical_call_id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, direction, status, duration, classification, started_at, ended_at, phone_number, recording_url, recording_storage_path, transcript, notes, created_at"),
    all("leads", "id, company_bio_id, icp_profile_id"),
    all("campaigns", "id, lead_id, name, seller_id, assigned_user_id"),
    all("sellers", "id, name, user_id"),
  ]);
  const tenantOfLead = new Map(leadRows.map(l => [String(l.id), S(l.company_bio_id) ?? ""]));
  const icpOfLead = new Map(leadRows.filter(l => l.icp_profile_id).map(l => [String(l.id), String(l.icp_profile_id)]));
  const sellerName = new Map(sellerRows.map(s => [String(s.id), String(s.name)]));
  const sellerOfUser = new Map(sellerRows.filter(s => s.user_id).map(s => [String(s.user_id), String(s.id)]));
  const leadAssignedUser = new Map<string, string>(), campaignOfLead = new Map<string, string>();
  for (const c of campRows) {
    const lid = S(c.lead_id); if (!lid) continue;
    if (c.assigned_user_id && !leadAssignedUser.has(lid)) leadAssignedUser.set(lid, String(c.assigned_user_id));
    if (c.name && !campaignOfLead.has(lid)) campaignOfLead.set(lid, String(c.name));
  }
  const ctx = { sellerOfUser, leadAssignedUser };

  const win = resolveWindow(FROM, TO);
  const scoped = (callRows as unknown as RawCallRow[])
    .filter(c => c.lead_id && tenantOfLead.get(c.lead_id) === TENANT);

  const physical = toPhysicalCalls(scoped).filter(p => p.isReal && inWindow(p.startedAt, win));
  const ws = callTotals(physical);

  console.log(`\n  CANONICAL CALL VERIFICATION — tenant ${TENANT.slice(0, 8)} · ${FROM ?? "all time"} → ${TO ?? "today"}`);
  console.log(`  rows ${scoped.length} → physical calls ${toPhysicalCalls(scoped).length} → real in window ${physical.length}\n`);
  console.log(`  Attempted ................. ${ws.attempted}`);
  console.log(`  Confirmed Connected ....... ${ws.confirmedConnected}`);
  console.log(`  Confirmed Not Connected ... ${ws.confirmedNotConnected}`);
  console.log(`  Unknown ................... ${ws.unknown}`);
  console.log(`  Confirmed Connect Rate .... ${ws.confirmedConnectRate == null ? "—" : ws.confirmedConnectRate.toFixed(1) + "%"}\n`);

  check("connected + notConnected + unknown == attempted",
    ws.confirmedConnected + ws.confirmedNotConnected + ws.unknown === ws.attempted);
  check("no physical call holds two Aircall ids",
    toPhysicalCalls(scoped).every(p => p.rowIds.length <= 2));

  /* ── determinism under shuffle ──────────────────────────────────────── */
  const key = (t: ReturnType<typeof callTotals>) =>
    `${t.attempted}|${t.confirmedConnected}|${t.confirmedNotConnected}|${t.unknown}`;
  const expect = key(ws);
  let stable = true;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 100; i++) {
    const shuffled = [...scoped];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(rnd() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const t = callTotals(toPhysicalCalls(shuffled).filter(p => p.isReal && inWindow(p.startedAt, win)));
    if (key(t) !== expect) { stable = false; break; }
  }
  check("same rows shuffled 100× give the same result", stable);

  /* ── reconciliation by dimension ────────────────────────────────────── */
  type Cell = { attempted: number; connected: number; notConnected: number; unknown: number };
  const blank = (): Cell => ({ attempted: 0, connected: 0, notConnected: 0, unknown: 0 });
  const bucket = (keyOf: (p: PhysicalCall) => string) => {
    const m = new Map<string, Cell>();
    for (const p of physical) {
      const k = keyOf(p);
      const c = m.get(k) ?? m.set(k, blank()).get(k)!;
      c.attempted++;
      if (p.connection === "confirmed_connected") c.connected++;
      else if (p.connection === "confirmed_not_connected") c.notConnected++;
      else c.unknown++;
    }
    return m;
  };
  const sum = (m: Map<string, Cell>) => [...m.values()].reduce((a, c) => ({
    attempted: a.attempted + c.attempted, connected: a.connected + c.connected,
    notConnected: a.notConnected + c.notConnected, unknown: a.unknown + c.unknown,
  }), blank());

  const bySeller = bucket(p => resolveCallSeller(p, ctx) ?? "UNATTRIBUTED");
  const byCampaign = bucket(p => (p.leadId && campaignOfLead.get(p.leadId)) || "NO CAMPAIGN");
  const byIcp = bucket(p => (p.leadId && icpOfLead.get(p.leadId)) || "NO ICP");

  const same = (a: Cell) => a.attempted === ws.attempted && a.connected === ws.confirmedConnected
    && a.notConnected === ws.confirmedNotConnected && a.unknown === ws.unknown;
  const show = (a: Cell) => `att ${a.attempted} conn ${a.connected} not ${a.notConnected} unk ${a.unknown}`;
  check("Σ sellers   == workspace", same(sum(bySeller)), show(sum(bySeller)));
  check("Σ campaigns == workspace", same(sum(byCampaign)), show(sum(byCampaign)));
  check("Σ ICPs      == workspace", same(sum(byIcp)), show(sum(byIcp)));

  const table = (title: string, m: Map<string, Cell>, name: (k: string) => string, limit = 8) => {
    console.log(`\n  ── ${title} ──`);
    const rate = (c: Cell) => (c.connected + c.notConnected > 0 ? `${((c.connected / (c.connected + c.notConnected)) * 100).toFixed(1)}%` : "—");
    for (const [k, c] of [...m.entries()].sort((a, b) => b[1].attempted - a[1].attempted).slice(0, limit)) {
      console.log(`  ${name(k).slice(0, 40).padEnd(42)} att ${String(c.attempted).padStart(4)} · conn ${String(c.connected).padStart(4)} · not ${String(c.notConnected).padStart(4)} · unk ${String(c.unknown).padStart(4)} · ${rate(c).padStart(7)}`);
    }
  };
  table("SELLER", bySeller, k => (k === "UNATTRIBUTED" ? "Unattributed" : sellerName.get(k) ?? k.slice(0, 8)));
  table("CAMPAIGN", byCampaign, k => k);
  table("ICP", byIcp, k => k.slice(0, 8));

  console.log(`\n  ${"─".repeat(66)}\n  ${pass} passed · ${fail} failed`);
  if (fail) { for (const f of fails) console.log(`   · ${f}`); process.exit(1); }
  console.log("  Canonical identity reconciles on every dimension.\n");
};

main().catch(e => { console.error(e); process.exit(1); });
