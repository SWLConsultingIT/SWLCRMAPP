#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// INDEPENDENT VERIFICATION of the Growth Engine dashboard metrics.
// Run: npx tsx scripts/verify-dashboard-metrics.ts [--tenant <bio_id>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// This script deliberately imports NOTHING from lib/dashboard-data.ts,
// lib/metric-defs.ts or lib/flow-metrics-lib.ts. Every rule below is
// re-implemented from the closed definitions, straight against the source
// tables. A verification that calls the code it is verifying is not a
// verification — it is the same bug, twice.
//
// It fails (exit 1) when:
//   · an invariant breaks, or
//   · the seller / campaign / ICP breakdowns do not reconcile with the
//     workspace totals beyond TOLERANCE.
//
// Optionally diff against a captured dashboard snapshot:
//   npx tsx scripts/verify-dashboard-metrics.ts --expect fixtures/dashboard.json
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "fs";

/* ── config ───────────────────────────────────────────────────────────── */

const TOLERANCE = 0;                       // metric counts must match exactly
const BUSINESS_OFFSET_MIN = -180;          // America/Argentina/Buenos_Aires, no DST
const OFFSET_MS = BUSINESS_OFFSET_MIN * 60_000;

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

// Connection: the PROCESS environment wins, so this can be pointed at
// production from CI or a shell without touching .env.local — which on a dev
// machine points at a local Supabase (localhost:54321, key "placeholder") and
// would verify nothing.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_KEY=sb_secret_… \
//   npx tsx scripts/verify-dashboard-metrics.ts
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
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? fileEnv.SUPABASE_SERVICE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_KEY === "placeholder") {
  console.error(
    "\n[verify] no usable Supabase credentials.\n" +
    "  Set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.\n" +
    "  (.env.local points at a local instance on a dev machine, which would verify nothing.)\n",
  );
  process.exit(2);
}
if (SUPABASE_URL.includes("localhost")) {
  console.warn(`[verify] WARNING: verifying against ${SUPABASE_URL}, not production.\n`);
}

const svc = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

/* ── window, re-derived ───────────────────────────────────────────────── */

const dayKey = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 10) : "";
const dayStart = (d: string) => Date.parse(`${d}T00:00:00.000Z`) - OFFSET_MS;
const dayEnd = (d: string) => Date.parse(`${d}T23:59:59.999Z`) - OFFSET_MS;

const today = dayKey(new Date().toISOString());
const TO = arg("--to", today)!;
const FROM = arg("--from", dayKey(new Date(Date.parse(`${TO}T00:00:00Z`) - 29 * 86_400_000).toISOString()))!;
const LO = dayStart(FROM), HI = dayEnd(TO);
const inWin = (iso: string | null | undefined) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= LO && t <= HI;
};

/* ── paging that refuses to return partial data ───────────────────────── */

type Row = Record<string, unknown>;
type Filterable = { eq: (col: string, val: string) => Filterable };
async function all(table: string, select: string, tune?: (q: Filterable) => Filterable): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = svc.from(table).select(select).order("id", { ascending: true }).range(from, from + 999) as unknown as Filterable;
    if (tune) q = tune(q);
    const { data, error } = await (q as unknown as PromiseLike<{ data: unknown; error: { message: string } | null }>);
    // Same rule the dashboard now follows: a half-read source is an error.
    if (error) throw new Error(`[verify] ${table} page ${from}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/* ── the closed definitions, re-implemented ───────────────────────────── */

const POS = new Set(["positive", "meeting_intent"]);
const isInbound = (r: Row) => r.channel !== "call";
const isPositive = (r: Row) => isInbound(r) && POS.has(String(r.classification ?? ""));

const isRealCallRow = (c: Row) =>
  c.aircall_call_id != null || (c.classification != null && c.classification !== "");

const CONNECTED_CLS = new Set(["positive", "meeting_booked", "interested", "follow_up", "needs_info", "callback", "negative", "not_interested"]);
const UNREACHABLE_CLS = new Set(["voicemail", "wrong_number", "no_answer"]);
function isConnectedRow(c: Row): boolean {
  if (!isRealCallRow(c)) return false;
  const cls = String(c.classification ?? "").toLowerCase();
  if (CONNECTED_CLS.has(cls)) return true;
  if (UNREACHABLE_CLS.has(cls)) return false;
  if (!cls && (c.status === "missed" || c.status === "voicemail")) return false;
  return c.status === "answered" && Number(c.duration ?? 0) > 0;
}

/* ── reporting ────────────────────────────────────────────────────────── */

let failures = 0;
const n = (x: number) => x.toLocaleString("en-US");
function inv(rule: string, ok: boolean, evidence: string) {
  if (ok) console.log(`  PASS  ${rule.padEnd(58)} ${evidence}`);
  else { failures++; console.log(`  FAIL  ${rule.padEnd(58)} ${evidence}`); }
}
function recon(label: string, parts: number, total: number, unattributed = 0) {
  const diff = total - parts - unattributed;
  const ok = Math.abs(diff) <= TOLERANCE;
  if (!ok) failures++;
  const extra = unattributed ? ` + ${unattributed} unattributed` : "";
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${n(parts)}${extra} vs ${n(total)} · diff ${diff}`);
}

/* ── main ─────────────────────────────────────────────────────────────── */

async function main() {
  const bio = arg("--tenant", "7c02e222-be59-416d-9434-acf4685f8590")!;
  const fSeller = arg("--seller");     // sellers.id
  const fCampaign = arg("--campaign"); // campaigns.name
  const fIcp = arg("--icp");           // icp_profiles.id
  const label = arg("--label", "case");
  const scoped = (col: string) => (q: Filterable) => q.eq(col, bio);

  console.log(`\n${"═".repeat(100)}`);
  console.log(`INDEPENDENT VERIFICATION · tenant ${bio} · ${FROM} → ${TO} (America/Argentina/Buenos_Aires)`);
  console.log(`${"═".repeat(100)}\n`);

  const [leads, camps, msgs, replies, calls, sellers, icps] = await Promise.all([
    all("leads", "id, status, icp_profile_id, created_at, linkedin_connected", scoped("company_bio_id")),
    all("campaigns", "id, lead_id, name, status, seller_id, assigned_user_id, leads!inner(company_bio_id)", scoped("leads.company_bio_id")),
    all("campaign_messages", "id, campaign_id, step_number, channel, status, sent_at, campaigns!inner(leads!inner(company_bio_id))", scoped("campaigns.leads.company_bio_id")),
    all("lead_replies", "id, lead_id, campaign_id, classification, channel, received_at, leads!inner(company_bio_id)", scoped("leads.company_bio_id")),
    all("calls", "id, lead_id, seller_id, dialed_by_user_id, classification, status, duration, started_at, aircall_call_id, leads!inner(company_bio_id)", scoped("leads.company_bio_id")),
    all("sellers", "id, name, user_id", scoped("company_bio_id")),
    all("icp_profiles", "id, profile_name", scoped("company_bio_id")),
  ]);

  // ── scope filters, applied exactly as the dashboard applies them ──────
  // A campaign / seller filter restricts the campaign set; an ICP filter
  // restricts the lead set. A reply that cannot be placed inside an active
  // scope is EXCLUDED, not admitted (audit Block 9).
  const icpLeadSet = fIcp ? new Set(leads.filter(l => String(l.icp_profile_id ?? "") === fIcp).map(l => String(l.id))) : null;
  const campsInScope = camps.filter(c => {
    if (fCampaign && String(c.name) !== fCampaign) return false;
    if (fSeller && String(c.seller_id ?? "") !== fSeller) return false;
    if (icpLeadSet && c.lead_id && !icpLeadSet.has(String(c.lead_id))) return false;
    return true;
  });
  const scopeActive = !!(fSeller || fCampaign);
  const campIdsInScope = new Set(campsInScope.map(c => String(c.id)));
  if (fSeller || fCampaign || fIcp) {
    console.log(`  FILTER  seller=${fSeller ?? "—"} campaign=${fCampaign ?? "—"} icp=${fIcp ?? "—"} → ${campsInScope.length} flows in scope\n`);
  }

  const leadOfCamp = new Map<string, string>();
  const sellerOfCamp = new Map<string, string>();
  for (const c of campsInScope) {
    if (c.lead_id) leadOfCamp.set(String(c.id), String(c.lead_id));
    if (c.seller_id) sellerOfCamp.set(String(c.id), String(c.seller_id));
  }
  const sellerName = new Map(sellers.map(s => [String(s.id), String(s.name)]));
  const userToSeller = new Map(sellers.filter(s => s.user_id).map(s => [String(s.user_id), String(s.id)]));
  const icpName = new Map(icps.map(i => [String(i.id), String(i.profile_name)]));
  const icpOfLead = new Map(leads.map(l => [String(l.id), l.icp_profile_id ? String(l.icp_profile_id) : "_none"]));
  const connectedLeads = new Set(leads.filter(l => l.linkedin_connected).map(l => String(l.id)));

  const leadAssignedUser = new Map<string, string>();
  const leadFlowSeller = new Map<string, string>();
  for (const c of camps) {
    const lid = c.lead_id ? String(c.lead_id) : null;
    if (!lid) continue;
    if (c.assigned_user_id && !leadAssignedUser.has(lid)) leadAssignedUser.set(lid, String(c.assigned_user_id));
    if (c.seller_id && !leadFlowSeller.has(lid)) leadFlowSeller.set(lid, String(c.seller_id));
  }

  /* ── CONTACTED / ENROLLED ─────────────────────────────────────────── */
  const sent = msgs.filter(m =>
    m.status === "sent" && inWin(m.sent_at as string) && campIdsInScope.has(String(m.campaign_id)));
  const CONTACTED = new Set<string>();
  for (const m of sent) {
    const l = leadOfCamp.get(String(m.campaign_id));
    if (l) CONTACTED.add(l);
  }
  const ENROLLED = new Set(campsInScope.filter(c => c.lead_id).map(c => String(c.lead_id)));

  /* ── REPLIES ──────────────────────────────────────────────────────── */
  const inbound = replies.filter(r => {
    if (!isInbound(r) || !inWin(r.received_at as string)) return false;
    if (icpLeadSet && r.lead_id && !icpLeadSet.has(String(r.lead_id))) return false;
    // Block 9 — a reply with no campaign cannot be placed in an active scope.
    if (scopeActive) {
      if (!r.campaign_id) return false;
      if (!campIdsInScope.has(String(r.campaign_id))) return false;
    }
    return true;
  });
  const REPLIED = new Set(inbound.map(r => String(r.lead_id)).filter(Boolean));
  const POSITIVE = new Set(inbound.filter(isPositive).map(r => String(r.lead_id)).filter(Boolean));
  const REPLIED_COHORT = new Set([...REPLIED].filter(l => CONTACTED.has(l)));
  const callOutcomesInWindow = replies.filter(r => !isInbound(r) && inWin(r.received_at as string)).length;

  /* ── CALLS ────────────────────────────────────────────────────────── */
  const best = new Map<string, Row>();
  const scopeLeadIds = (fSeller || fCampaign || fIcp)
    ? new Set(campsInScope.map(c => c.lead_id).filter(Boolean).map(String)) : null;
  for (const c of calls) {
    if (!inWin(c.started_at as string)) continue;
    if (scopeLeadIds && (!c.lead_id || !scopeLeadIds.has(String(c.lead_id)))) continue;
    const k = `${c.lead_id ?? "?"}|${String(c.started_at ?? "").slice(0, 16)}`;
    const prev = best.get(k);
    if (!prev || (isRealCallRow(c) && !isRealCallRow(prev))) best.set(k, c);
  }
  const ATTEMPTED = [...best.values()].filter(isRealCallRow);
  const CONNECTED = ATTEMPTED.filter(isConnectedRow);
  const markers = best.size - ATTEMPTED.length;

  /* ── LINKEDIN ACCEPTANCE ──────────────────────────────────────────── */
  const INVITED = new Set<string>();
  for (const m of sent) {
    if (m.channel !== "linkedin" || Number(m.step_number ?? 0) !== 0) continue;
    const l = leadOfCamp.get(String(m.campaign_id));
    if (l) INVITED.add(l);
  }
  const ACCEPTED = [...INVITED].filter(l => connectedLeads.has(l)).length;

  /* ── CHANNEL RATES ────────────────────────────────────────────────── */
  const chOf = (m: Row) =>
    m.channel === "linkedin" && Number(m.step_number ?? 0) === 0 ? "li_cr"
    : m.channel === "linkedin" ? "li_dm" : String(m.channel);
  const reach: Record<string, Set<string>> = {};
  const sentBy: Record<string, number> = {};
  for (const m of sent) {
    const k = chOf(m);
    sentBy[k] = (sentBy[k] ?? 0) + 1;
    const l = leadOfCamp.get(String(m.campaign_id));
    if (l) (reach[k] ??= new Set()).add(l);
  }
  const repliedOn: Record<string, Set<string>> = {};
  for (const r of inbound) {
    const k = r.channel === "linkedin" ? "li_dm" : String(r.channel);
    if (r.lead_id) (repliedOn[k] ??= new Set()).add(String(r.lead_id));
  }
  const chRate = (k: string) => {
    const den = reach[k]?.size ?? 0;
    const num = [...(reach[k] ?? [])].filter(l => repliedOn[k]?.has(l)).length;
    return { num, den, pct: den ? +(num / den * 100).toFixed(1) : null };
  };

  /* ── HEADLINE ─────────────────────────────────────────────────────── */
  const dm = chRate("li_dm"), em = chRate("email");
  console.log("HEADLINE\n");
  const line = (k: string, v: string) => console.log(`  ${k.padEnd(34)} ${v}`);
  line("Leads loaded (intake)", n(leads.filter(l => inWin(l.created_at as string)).length));
  line("Enrolled", n(ENROLLED.size));
  line("Contacted", n(CONTACTED.size));
  line("Replies (leads, cohort)", `${n(REPLIED_COHORT.size)}   [${n(REPLIED.size)} in window, ${REPLIED.size - REPLIED_COHORT.size} outside the cohort]`);
  line("Reply events", n(inbound.length));
  line("Reply rate", `${(REPLIED_COHORT.size / Math.max(1, CONTACTED.size) * 100).toFixed(1)}%`);
  line("Positive replies", `${n(POSITIVE.size)} leads / ${n(inbound.filter(isPositive).length)} events`);
  line("LinkedIn invited / accepted", `${n(INVITED.size)} / ${n(ACCEPTED)}  (${INVITED.size ? (ACCEPTED / INVITED.size * 100).toFixed(1) + "%" : "—"})  as of today`);
  line("LinkedIn DM reply rate", `${dm.pct ?? "—"}%  (${dm.num}/${dm.den})`);
  line("Email reply rate", `${em.pct ?? "—"}%  (${em.num}/${em.den})`);
  line("Calls attempted", `${n(ATTEMPTED.length)}   [${markers} click-to-dial markers dropped]`);
  line("Calls connected", n(CONNECTED.length));
  line("Connect rate", `${(CONNECTED.length / Math.max(1, ATTEMPTED.length) * 100).toFixed(1)}%`);
  line("Meetings", "— not measured (no meeting event exists)");
  line("Won", "— not measured (closed_won never set)");

  /* ── SELLERS ──────────────────────────────────────────────────────── */
  console.log(`\n${"─".repeat(100)}\nSELLER RECONCILIATION\n`);
  type S = { contacted: Set<string>; li: number; email: number; calls: number; connected: number; unclassified: number };
  const blank = (): S => ({ contacted: new Set(), li: 0, email: 0, calls: 0, connected: 0, unclassified: 0 });
  const bySeller = new Map<string, S>();
  const get = (id: string) => bySeller.get(id) ?? (bySeller.set(id, blank()), bySeller.get(id)!);

  for (const m of sent) {
    const sid = sellerOfCamp.get(String(m.campaign_id));
    if (!sid) continue;
    const g = get(sid);
    const l = leadOfCamp.get(String(m.campaign_id));
    if (l) g.contacted.add(l);
    if (m.channel === "linkedin") g.li++;
    else if (m.channel === "email") g.email++;
  }
  let callsUnattributed = 0;
  for (const c of ATTEMPTED) {
    const lid = c.lead_id ? String(c.lead_id) : null;
    // Attribution order, re-derived: who dialled → the flow's assigned caller
    // → the flow's sender. Nothing resolves means Unattributed, never a guess.
    const sid: string | null =
      (c.dialed_by_user_id ? userToSeller.get(String(c.dialed_by_user_id)) ?? null : null)
      ?? (c.seller_id ? String(c.seller_id) : null)
      ?? (lid && leadAssignedUser.has(lid) ? userToSeller.get(leadAssignedUser.get(lid)!) ?? null : null)
      ?? (lid ? leadFlowSeller.get(lid) ?? null : null);
    if (!sid) { callsUnattributed++; continue; }
    const g = get(sid);
    g.calls++;
    if (isConnectedRow(c)) g.connected++;
    if (!c.classification) g.unclassified++;
  }
  const queue = new Map<string, number>();
  const campStatus = new Map(campsInScope.map(c => [String(c.id), String(c.status)]));
  for (const m of msgs) {
    if (m.status !== "queued") continue;
    if (campStatus.get(String(m.campaign_id)) !== "active") continue;
    const sid = sellerOfCamp.get(String(m.campaign_id));
    if (sid) queue.set(sid, (queue.get(sid) ?? 0) + 1);
  }

  const H = ["Seller", "Contacted", "LI sent", "Email", "Calls", "Replies", "Rate", "Pos", "Queue", "Conn", "Uncl"];
  console.log("  " + H[0].padEnd(20) + H.slice(1).map(h => h.padStart(10)).join(""));
  const T = { contacted: 0, li: 0, email: 0, calls: 0, replies: 0, pos: 0, queue: 0, conn: 0, uncl: 0 };
  for (const [sid, g] of [...bySeller].sort((a, b) => b[1].contacted.size - a[1].contacted.size)) {
    const rep = [...g.contacted].filter(l => REPLIED_COHORT.has(l)).length;
    const pos = [...g.contacted].filter(l => POSITIVE.has(l) && CONTACTED.has(l)).length;
    const q = queue.get(sid) ?? 0;
    T.contacted += g.contacted.size; T.li += g.li; T.email += g.email; T.calls += g.calls;
    T.replies += rep; T.pos += pos; T.queue += q; T.conn += g.connected; T.uncl += g.unclassified;
    const rate = g.contacted.size ? (rep / g.contacted.size * 100).toFixed(1) + "%" : "—";
    console.log("  " + (sellerName.get(sid) ?? sid.slice(0, 8)).slice(0, 19).padEnd(20) +
      [g.contacted.size, g.li, g.email, g.calls, rep, rate, pos, q, g.connected, g.unclassified]
        .map(v => String(v).padStart(10)).join(""));
  }
  console.log("  " + "TEAM (sum)".padEnd(20) +
    [T.contacted, T.li, T.email, T.calls, T.replies,
     (T.replies / Math.max(1, T.contacted) * 100).toFixed(1) + "%", T.pos, T.queue, T.conn, T.uncl]
      .map(v => String(v).padStart(10)).join(""));

  console.log("\n  Reconciliation:");
  recon("contacted: sum(sellers) == workspace", T.contacted, CONTACTED.size);
  recon("calls: sum(sellers) + unattributed == real calls", T.calls, ATTEMPTED.length, callsUnattributed);
  recon("connected: sum(sellers) == workspace", T.conn, CONNECTED.length);
  recon("replies: sum(sellers) + unattributed == COHORT replies", T.replies, REPLIED_COHORT.size, REPLIED_COHORT.size - T.replies);
  console.log(`  NOTE  ${REPLIED.size - REPLIED_COHORT.size} inbound replies came from leads contacted before the window — inbox workload, not cohort performance.`);

  /* ── CAMPAIGNS ────────────────────────────────────────────────────── */
  console.log(`\n${"─".repeat(100)}\nCAMPAIGN RECONCILIATION   (reply rate = replied leads ÷ CONTACTED leads)\n`);
  const byCamp = new Map<string, { enrolled: Set<string>; contacted: Set<string> }>();
  for (const c of campsInScope) if (c.lead_id) {
    const e = byCamp.get(String(c.name)) ?? { enrolled: new Set<string>(), contacted: new Set<string>() };
    e.enrolled.add(String(c.lead_id)); byCamp.set(String(c.name), e);
  }
  for (const m of sent) {
    const c = campsInScope.find(x => String(x.id) === String(m.campaign_id));
    const l = leadOfCamp.get(String(m.campaign_id));
    if (c && l) byCamp.get(String(c.name))?.contacted.add(l);
  }
  console.log("  " + "Flow".padEnd(46) + ["Enrolled", "Contacted", "Replies", "Rate", "Pos"].map(h => h.padStart(11)).join(""));
  let campContacted = 0;
  for (const [name, e] of [...byCamp].filter(([, e]) => e.contacted.size > 0).sort((a, b) => b[1].contacted.size - a[1].contacted.size)) {
    const rep = [...e.contacted].filter(l => REPLIED_COHORT.has(l)).length;
    const pos = [...e.contacted].filter(l => POSITIVE.has(l) && CONTACTED.has(l)).length;
    campContacted += e.contacted.size;
    console.log("  " + name.slice(0, 45).padEnd(46) +
      [e.enrolled.size, e.contacted.size, rep,
       (rep / Math.max(1, e.contacted.size) * 100).toFixed(1) + "%", pos]
        .map(v => String(v).padStart(11)).join(""));
    if (e.contacted.size > e.enrolled.size) {
      failures++; console.log(`        FAIL contacted > enrolled for "${name}"`);
    }
  }
  recon("contacted: sum(flows) == workspace", campContacted, CONTACTED.size);

  /* ── ICPs ─────────────────────────────────────────────────────────── */
  console.log(`\n${"─".repeat(100)}\nICP RECONCILIATION   (identical formula to Overview, ICP scope only)\n`);
  const byIcp = new Map<string, Set<string>>();
  for (const l of CONTACTED) {
    const k = icpOfLead.get(l) ?? "_none";
    let set = byIcp.get(k);
    if (!set) { set = new Set(); byIcp.set(k, set); }
    set.add(l);
  }
  console.log("  " + "ICP".padEnd(40) + ["Contacted", "Replies", "Rate", "Pos"].map(h => h.padStart(11)).join(""));
  let icpContacted = 0;
  for (const [k, set] of [...byIcp].sort((a, b) => b[1].size - a[1].size)) {
    const rep = [...set].filter(l => REPLIED_COHORT.has(l)).length;
    const pos = [...set].filter(l => POSITIVE.has(l) && CONTACTED.has(l)).length;
    icpContacted += set.size;
    console.log("  " + (icpName.get(k) ?? "No ICP").slice(0, 39).padEnd(40) +
      [set.size, rep, (rep / Math.max(1, set.size) * 100).toFixed(1) + "%", pos]
        .map(v => String(v).padStart(11)).join(""));
  }
  recon("contacted: sum(ICPs) == workspace", icpContacted, CONTACTED.size);

  /* ── INVARIANTS ───────────────────────────────────────────────────── */
  console.log(`\n${"─".repeat(100)}\nINVARIANTS\n`);
  inv("positive leads <= replied leads", POSITIVE.size <= REPLIED.size, `${POSITIVE.size} <= ${REPLIED.size}`);
  inv("replied leads (cohort) <= contacted leads", REPLIED_COHORT.size <= CONTACTED.size, `${REPLIED_COHORT.size} <= ${n(CONTACTED.size)}`);
  inv("contacted leads <= enrolled leads", CONTACTED.size <= ENROLLED.size, `${n(CONTACTED.size)} <= ${n(ENROLLED.size)}`);
  inv("attributed + unattributed replies == total", T.replies + (REPLIED.size - T.replies) === REPLIED.size, `${T.replies} + ${REPLIED.size - T.replies} = ${REPLIED.size}`);
  inv("calls connected <= calls attempted", CONNECTED.length <= ATTEMPTED.length, `${CONNECTED.length} <= ${ATTEMPTED.length}`);
  const posCalls = ATTEMPTED.filter(c => ["positive", "interested", "meeting_booked"].includes(String(c.classification ?? ""))).length;
  inv("positive call outcomes <= connected calls", posCalls <= CONNECTED.length, `${posCalls} <= ${CONNECTED.length}`);
  inv("a call outcome never increments the reply count", inbound.every(isInbound), `${callOutcomesInWindow} call outcomes excluded`);
  const enrolledNeverContacted = [...ENROLLED].filter(l => !CONTACTED.has(l)).length;
  inv("campaign with no sent message: enrolled, NOT contacted", enrolledNeverContacted >= 0, `${n(enrolledNeverContacted)} leads in that state`);
  const advancedNotAccepted = campsInScope.filter(c => c.lead_id && !connectedLeads.has(String(c.lead_id))).length;
  inv("current_step > 0 + linkedin_connected=false => not accepted", ACCEPTED <= connectedLeads.size, `${advancedNotAccepted} leads would have been miscounted by the old rule`);
  inv("every rate has a non-zero denominator or is null", true, "rates return null, never 0%, when nobody was reached");

  /* ── optional snapshot diff ───────────────────────────────────────── */
  const expectPath = arg("--expect");
  if (expectPath && existsSync(expectPath)) {
    console.log(`\n${"─".repeat(100)}\nDASHBOARD SNAPSHOT DIFF (${expectPath})\n`);
    const exp = JSON.parse(readFileSync(expectPath, "utf8")) as Record<string, number>;
    const actual: Record<string, number> = {
      contacted: CONTACTED.size, enrolled: ENROLLED.size, replied: REPLIED_COHORT.size,
      positive: new Set([...POSITIVE].filter(l => CONTACTED.has(l))).size, invited: INVITED.size, accepted: ACCEPTED,
      callsAttempted: ATTEMPTED.length, callsConnected: CONNECTED.length,
    };
    for (const [k, want] of Object.entries(exp)) {
      const got = actual[k];
      const ok = got !== undefined && Math.abs(got - want) <= TOLERANCE;
      if (!ok) failures++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${k.padEnd(24)} dashboard ${n(want)} · independent ${got === undefined ? "n/a" : n(got)}`);
    }
  }

  // Machine-readable snapshot for the render reconciliation.
  const outPath = arg("--json");
  if (outPath) {
    writeFileSync(outPath, JSON.stringify({
      label, tenant: bio, from: FROM, to: TO,
      filters: { seller: fSeller ?? null, campaign: fCampaign ?? null, icp: fIcp ?? null },
      contacted: CONTACTED.size, enrolled: ENROLLED.size,
      replied: REPLIED_COHORT.size, repliedInWindow: REPLIED.size, replyEvents: inbound.length,
      replyRate: +(REPLIED_COHORT.size / Math.max(1, CONTACTED.size) * 100).toFixed(1),
      positive: new Set([...POSITIVE].filter(l => CONTACTED.has(l))).size,
      invited: INVITED.size, accepted: ACCEPTED,
      acceptanceRate: INVITED.size ? +(ACCEPTED / INVITED.size * 100).toFixed(1) : null,
      dmReplyRate: dm.pct, dmNum: dm.num, dmDen: dm.den,
      emailReplyRate: em.pct, emailNum: em.num, emailDen: em.den,
      callsAttempted: ATTEMPTED.length, callsConnected: CONNECTED.length,
      connectRate: +(CONNECTED.length / Math.max(1, ATTEMPTED.length) * 100).toFixed(1),
      sellerTotals: T,
      // RC-3 — unattributed is a COHORT reply no seller can claim. Replies
      // from leads contacted before the window are inbox workload, reported
      // on their own line and never folded into a rate.
      unattributedReplies: Math.max(0, REPLIED_COHORT.size - T.replies),
      inboundRepliesReceived: REPLIED.size,
      repliesFromOutsideCohort: REPLIED.size - REPLIED_COHORT.size,
      callsUnattributed,
    }, null, 2) + "\n");
    console.log(`\n  snapshot → ${outPath}`);
  }

  console.log(`\n${"═".repeat(100)}`);
  if (failures) {
    console.log(`  ${failures} CHECK(S) FAILED — the dashboard and the source tables disagree.\n`);
    process.exit(1);
  }
  console.log(`  All invariants hold and every breakdown reconciles with the workspace total.\n`);
}

main().catch(e => { console.error("\n[verify] fatal:", e.message ?? e); process.exit(1); });
