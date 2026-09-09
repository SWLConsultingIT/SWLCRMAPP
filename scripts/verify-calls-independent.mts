#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.3 · INDEPENDENT verification of the canonical Calls metrics.
//
// Imports NOTHING from lib/metrics/* or lib/dashboard-data.ts. Every rule is
// re-implemented from the closed definitions, straight against the tables. A
// verification that calls the code it verifies is the same bug, twice.
//
// Emits JSON so the shadow harness can diff it against what the real
// dashboard aggregation produced.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
//   npx tsx scripts/verify-calls-independent.mts --tenant <id> [--from --to] [--json out.json]
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TENANT = arg("--tenant", "7c02e222-be59-416d-9434-acf4685f8590")!;
const FROM = arg("--from"), TO = arg("--to");
const JSON_OUT = arg("--json");

const URL_ = process.env.SUPABASE_URL, KEY_ = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY_) { console.error("\n[indep] need SUPABASE_URL and SUPABASE_SERVICE_KEY\n"); process.exit(2); }
const svc = createClient(URL_, KEY_, { auth: { persistSession: false } });

/* ── the definitions, re-declared here on purpose ─────────────────────── */
const CONVERSATIONAL = new Set([
  "positive", "interested", "meeting_booked", "meeting_intent",
  "follow_up", "needs_info", "callback", "negative", "not_interested",
  "other_person",
]);
const NON_CONVERSATIONAL = new Set(["voicemail", "wrong_number", "no_answer"]);

const OFFSET_MS = -180 * 60_000;               // America/Argentina/Buenos_Aires
const dayStart = (d: string) => Date.parse(`${d}T00:00:00.000Z`) - OFFSET_MS;
const dayEnd = (d: string) => Date.parse(`${d}T23:59:59.999Z`) - OFFSET_MS;
const LO = FROM ? dayStart(FROM) : null, HI = TO ? dayEnd(TO) : null;
const inWin = (iso: string | null) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return (LO === null || t >= LO) && (HI === null || t <= HI);
};

type Row = Record<string, any>;
async function all(table: string, select: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from(table).select(select).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`[indep] ${table} page ${from}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

type Totals = { attempted: number; connected: number; notConnected: number; unknown: number; rate: number | null };
const blank = (): Totals => ({ attempted: 0, connected: 0, notConnected: 0, unknown: 0, rate: null });
const finish = (t: Totals) => { const d = t.connected + t.notConnected; t.rate = d > 0 ? Math.round((t.connected / d) * 1000) / 10 : null; return t; };

const main = async () => {
  const [callRows, leadRows, campRows, sellerRows] = await Promise.all([
    all("calls", "id, canonical_call_id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, classification, started_at, created_at, phone_number"),
    all("leads", "id, company_bio_id, icp_profile_id"),
    all("campaigns", "id, lead_id, name, assigned_user_id"),
    all("sellers", "id, name, user_id, company_bio_id"),
  ]);

  const tenantOfLead = new Map(leadRows.map(l => [String(l.id), String(l.company_bio_id ?? "")]));
  const icpOfLead = new Map(leadRows.filter(l => l.icp_profile_id).map(l => [String(l.id), String(l.icp_profile_id)]));
  // Sellers MUST be tenant-scoped. The same person can hold a seller row in
  // several tenants; an unscoped user→seller map silently attributes a call
  // to the wrong tenant's seller row, which is what made Lucia read 265 here
  // and 264 in the dashboard on the first run.
  const tenantSellers = sellerRows.filter(s => String(s.company_bio_id ?? "") === TENANT);
  const sellerName = new Map(tenantSellers.map(s => [String(s.id), String(s.name)]));
  const sellerOfUser = new Map(tenantSellers.filter(s => s.user_id).map(s => [String(s.user_id), String(s.id)]));
  const tenantSellerIds = new Set(tenantSellers.map(s => String(s.id)));
  const assignedUserOfLead = new Map<string, string>(), campaignOfLead = new Map<string, string>();
  for (const c of campRows) {
    const lid = String(c.lead_id ?? ""); if (!lid) continue;
    if (c.assigned_user_id && !assignedUserOfLead.has(lid)) assignedUserOfLead.set(lid, String(c.assigned_user_id));
    if (c.name && !campaignOfLead.has(lid)) campaignOfLead.set(lid, String(c.name));
  }

  // Tenant scope, then GROUP BY canonical_call_id. No lead+minute anywhere.
  const scoped = callRows.filter(c => c.lead_id && tenantOfLead.get(String(c.lead_id)) === TENANT);
  const groups = new Map<string, Row[]>();
  for (const c of scoped) {
    const k = String(c.canonical_call_id ?? c.id);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
  }

  type Call = { id: string; leadId: string | null; startedAt: string | null; outcome: string | null; dialer: string | null; sellerId: string | null };
  const calls: Call[] = [];
  for (const [cid, rows] of groups) {
    // Real = Aircall confirmed it, or a human classified it.
    const isReal = rows.some(r => r.aircall_call_id != null || (r.classification ?? "") !== "");
    if (!isReal) continue;
    // started_at: the Aircall row wins, else the marker.
    const wh = rows.filter(r => r.aircall_call_id != null);
    const startedAt = (wh[0]?.started_at ?? rows[0]?.started_at) as string | null;
    if (!inWin(startedAt)) continue;
    // The human's outcome, from whichever row carries it; latest created wins.
    const classified = rows.filter(r => (r.classification ?? "").trim() !== "")
      .sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0) || String(a.id).localeCompare(String(b.id)));
    const outcome = classified[0]?.classification?.toLowerCase().trim() ?? null;
    const markers = rows.filter(r => r.aircall_call_id == null);
    calls.push({
      id: cid,
      leadId: (markers[0]?.lead_id ?? rows[0]?.lead_id ?? null) as string | null,
      startedAt, outcome,
      dialer: (rows.find(r => r.dialed_by_user_id)?.dialed_by_user_id ?? null) as string | null,
      sellerId: (rows.find(r => r.seller_id)?.seller_id ?? null) as string | null,
    });
  }

  const state = (o: string | null) => {
    const c = (o ?? "").toLowerCase().trim();
    if (!c) return "unknown";
    if (CONVERSATIONAL.has(c)) return "connected";
    if (NON_CONVERSATIONAL.has(c)) return "notConnected";
    return "unknown";
  };
  const tally = (list: Call[]) => {
    const t = blank();
    for (const c of list) {
      t.attempted++;
      const s = state(c.outcome);
      if (s === "connected") t.connected++;
      else if (s === "notConnected") t.notConnected++;
      else t.unknown++;
    }
    return finish(t);
  };
  const owner = (c: Call) => {
    if (c.dialer && sellerOfUser.has(c.dialer)) return sellerOfUser.get(c.dialer)!;
    if (c.sellerId && tenantSellerIds.has(c.sellerId)) return c.sellerId;
    if (c.leadId) {
      const u = assignedUserOfLead.get(c.leadId);
      if (u && sellerOfUser.has(u)) return sellerOfUser.get(u)!;
    }
    return "UNATTRIBUTED";
  };
  const groupBy = (keyOf: (c: Call) => string) => {
    const m = new Map<string, Call[]>();
    for (const c of calls) (m.get(keyOf(c)) ?? m.set(keyOf(c), []).get(keyOf(c))!).push(c);
    return Object.fromEntries([...m.entries()].map(([k, v]) => [k, tally(v)]));
  };

  const result = {
    tenant: TENANT, from: FROM ?? null, to: TO ?? null,
    workspace: tally(calls),
    bySeller: groupBy(owner),
    byCampaign: groupBy(c => (c.leadId && campaignOfLead.get(c.leadId)) || "NO CAMPAIGN"),
    byIcp: groupBy(c => (c.leadId && icpOfLead.get(c.leadId)) || "NO ICP"),
    sellerNames: Object.fromEntries(sellerName),
  };

  const w = result.workspace;
  console.log(`\n  INDEPENDENT — tenant ${TENANT.slice(0, 8)} · ${FROM ?? "all time"} → ${TO ?? "today"}`);
  console.log(`  attempted ${w.attempted} · connected ${w.connected} · notConnected ${w.notConnected} · unknown ${w.unknown} · rate ${w.rate ?? "—"}%`);
  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + "\n"); console.log(`  → ${JSON_OUT}\n`); }
};

main().catch(e => { console.error(e); process.exit(1); });
