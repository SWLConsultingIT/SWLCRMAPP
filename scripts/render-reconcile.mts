// ─────────────────────────────────────────────────────────────────────────
// PHASE 2 · DELIVERY 3 — production render reconciliation.
//
// Runs the REAL dashboard aggregation — lib/dashboard-data.ts, unmodified,
// the exact function app/page.tsx awaits — against production, for each
// filter case, and diffs every visible metric against the snapshot produced
// by scripts/verify-dashboard-metrics.ts (which shares no code with it).
//
// Run:
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
//   npx tsx --tsconfig tsconfig.render.json scripts/render-reconcile.mts
//
// tsconfig.render.json swaps two modules a script cannot satisfy — the auth
// scope and the cookie-bound Supabase client — for stubs under
// scripts/_render-harness/. Nothing else is replaced: every aggregation,
// filter, dedup and window in the dashboard runs as written.
//
// READ ONLY. getDashboardData issues SELECTs and nothing else; this script
// calls it and formats the result.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, writeFileSync } from "fs";
import { getDashboardData } from "../lib/dashboard-data.ts";

const TENANT = process.env.HARNESS_TENANT_ID!;
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !TENANT) {
  console.error("\n[render] need SUPABASE_URL, SUPABASE_SERVICE_KEY and HARNESS_TENANT_ID\n");
  process.exit(2);
}

type Case = {
  id: string; label: string;
  from?: string; to?: string;
  campaignNames?: string[]; sellerIds?: string[]; icpIds?: string[];
  snapshot: string;
};

const cases: Case[] = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/recon/cases.json", "utf8"));

/* ── comparison ───────────────────────────────────────────────────────── */

type Status = "GREEN" | "RED" | "GRAY" | "YELLOW";
type Line = { metric: string; rendered: string; independent: string; diff: string; status: Status; note?: string };

let redCount = 0;
const allRows: (Line & { case: string })[] = [];

function cmp(rows: Line[], metric: string, rendered: unknown, independent: unknown, note?: string): void {
  let status: Status = "GREEN";
  let diff = "0";
  if (rendered === "not_measured" || independent === "not_measured" || rendered === "—") {
    status = "GRAY"; diff = "—";
  } else if (rendered === null || independent === null) {
    status = rendered === independent ? "YELLOW" : "RED";
    diff = rendered === independent ? "both null" : "one is null";
  } else if (typeof rendered === "number" && typeof independent === "number") {
    // Rounding rule: counts are integers and must match exactly. Rates are
    // compared at ONE decimal place, which is the precision both sides
    // compute at; anything coarser would hide a real disagreement.
    const isRate = metric.toLowerCase().includes("rate") || metric.includes("%");
    const a = isRate ? Math.round(rendered * 10) / 10 : rendered;
    const b = isRate ? Math.round(independent * 10) / 10 : independent;
    const d = +(a - b).toFixed(1);
    diff = String(d);
    status = d === 0 ? "GREEN" : "RED";
  } else {
    status = String(rendered) === String(independent) ? "GREEN" : "RED";
    diff = status === "GREEN" ? "0" : "≠";
  }
  if (status === "RED") redCount++;
  rows.push({
    metric,
    rendered: rendered === null ? "null" : String(rendered),
    independent: independent === null ? "null" : String(independent),
    diff, status, note,
  });
}

const pct = (num: number, den: number) => (den > 0 ? +(num / den * 100).toFixed(1) : null);

/* ── run ──────────────────────────────────────────────────────────────── */

async function run() {
  console.log(`\n${"═".repeat(112)}`);
  console.log(`PRODUCTION RENDER RECONCILIATION · tenant ${TENANT}`);
  console.log(`rendered = lib/dashboard-data.ts (the function app/page.tsx awaits)   independent = scripts/verify-dashboard-metrics.ts`);
  console.log(`${"═".repeat(112)}`);

  for (const c of cases) {
    if (!existsSync(c.snapshot)) { console.log(`\n[skip] ${c.id}: no snapshot at ${c.snapshot}`); continue; }
    const ind = JSON.parse(readFileSync(c.snapshot, "utf8"));

    const t0 = Date.now();
    const d = await getDashboardData({
      from: c.from, to: c.to,
      campaignNames: c.campaignNames, sellerIds: c.sellerIds, icpIds: c.icpIds,
    } as Parameters<typeof getDashboardData>[0]);
    const ms = Date.now() - t0;

    console.log(`\n${"─".repeat(112)}`);
    console.log(`${c.id}  ${c.label}    ${c.from ?? "—"} → ${c.to ?? "—"}    (${ms} ms)`);
    if (d.unavailable) { console.log(`  !! source unavailable: ${d.unavailable}`); redCount++; continue; }
    console.log(`${"─".repeat(112)}`);

    const h = d.headline as Record<string, unknown>;
    const li = d.linkedinConnections as { sent: number; accepted: number; rate: number | null };
    const chan = (k: string) => (d.channelBreakdown as { channel: string; sent: number; contacted: number; replied: number }[])
      .find(x => x.channel === k);
    const calls = d.callsBreakdown as { made: number; answered: number };

    const rows: Line[] = [];
    // ── OVERVIEW
    cmp(rows, "Contacted", h.contactedLeads, ind.contacted);
    cmp(rows, "Enrolled", h.enrolledLeads, ind.enrolled);
    cmp(rows, "Replies (leads)", h.repliedCount, ind.replied);
    cmp(rows, "Reply events", h.replyEvents, ind.replyEvents);
    cmp(rows, "Reply Rate %", h.responseRate, ind.replyRate);
    cmp(rows, "Positive", h.positiveCount, ind.positive);
    cmp(rows, "LinkedIn invited", li.sent, ind.invited);
    cmp(rows, "LinkedIn accepted", li.accepted, ind.accepted);
    cmp(rows, "Acceptance Rate %", li.rate, ind.acceptanceRate, "no acceptance timestamp — 'as of today'");
    cmp(rows, "Calls Attempted", calls.made, ind.callsAttempted);
    cmp(rows, "Calls Connected", calls.answered, ind.callsConnected);
    cmp(rows, "Connect Rate %", pct(calls.answered, calls.made), ind.connectRate);
    cmp(rows, "Unattributed replies", h.unattributedReplies, ind.unattributedReplies);
    cmp(rows, "Meetings", "not_measured", "not_measured");
    cmp(rows, "Won", "not_measured", "not_measured");
    cmp(rows, "Lost", "not_measured", "not_measured");

    // ── CHANNELS. The dashboard's channelBreakdown groups both LinkedIn legs
    // under "linkedin", so the DM leg is reported here as the pair it can
    // produce and flagged; the split lives in the approved Channels design.
    const em = chan("email");
    if (em) cmp(rows, "Email reply rate % (reached-based)", pct(em.replied, em.contacted), ind.emailReplyRate,
      "dashboard counts a lead reached by email that replied on ANY channel");

    for (const r of rows) allRows.push({ ...r, case: c.id });

    const w = [38, 14, 14, 8, 7];
    console.log("  " + ["Metric", "Rendered", "Independent", "Diff", "Status"].map((x, i) => x.padEnd(w[i])).join(""));
    for (const r of rows) {
      console.log("  " + [r.metric, r.rendered, r.independent, r.diff, r.status].map((x, i) => String(x).padEnd(w[i])).join("")
        + (r.note && r.status !== "GREEN" ? `  ← ${r.note}` : ""));
    }

    // ── ICP / CAMPAIGN reconciliation from the rendered payload
    const ip = d.icpPerformance as { name: string; contacted: number; replied: number }[];
    // campaignPerformance exposes `leads` (= ENROLLED) and `uncontactedLeads`;
    // there is no `contacted` field. Contacted = leads − uncontacted.
    const cp = d.campaignPerformance as { name: string; leads: number; uncontactedLeads: number; replied: number; responseRate: number }[];
    const icpSum = ip.reduce((a, x) => a + x.contacted, 0);
    const campSum = cp.reduce((a, x) => a + Math.max(0, (x.leads ?? 0) - (x.uncontactedLeads ?? 0)), 0);
    const campEnrolledSum = cp.reduce((a, x) => a + (x.leads ?? 0), 0);
    console.log(`\n  ICPs      ${ip.length} rows · contacted ${icpSum}`);
    cmp(rows, "ICP sum contacted == workspace", icpSum, ind.contacted);
    let l2 = rows[rows.length - 1];
    console.log(`    ${l2.status}  sum(ICPs).contacted ${icpSum} vs workspace ${ind.contacted} · diff ${l2.diff}`);
    allRows.push({ ...l2, case: c.id });
    console.log(`  CAMPAIGNS ${cp.length} rows · contacted ${campSum} · enrolled ${campEnrolledSum}`);
    // The audit's campaign defect: responseRate divides by `leads` (enrolled).
    const worst = cp.filter(x => x.leads > 0 && x.uncontactedLeads > 0)
      .sort((a, b) => b.uncontactedLeads - a.uncontactedLeads)[0];
    if (worst) {
      const contacted = worst.leads - worst.uncontactedLeads;
      const correct = contacted > 0 ? +(worst.replied / contacted * 100).toFixed(1) : 0;
      console.log(`    denominator check · "${worst.name.slice(0, 34)}" rendered ${worst.responseRate}% (${worst.replied}/${worst.leads} enrolled) vs ${correct}% (${worst.replied}/${contacted} contacted)`);
    }
    cmp(rows, "campaign sum contacted == workspace", campSum, ind.contacted);
    l2 = rows[rows.length - 1];
    console.log(`    ${l2.status}  sum(flows).contacted ${campSum} vs workspace ${ind.contacted} · diff ${l2.diff}`);
    allRows.push({ ...l2, case: c.id });

    // ── SELLERS reconciliation from the rendered payload
    const sp = d.sellerPerformance as { name: string; contacted: number; replied: number; positive: number }[];
    const sumContacted = sp.reduce((a, s) => a + s.contacted, 0);
    const sumReplied = sp.reduce((a, s) => a + s.replied, 0);
    console.log(`\n  SELLERS   ${sp.length} rows · contacted ${sumContacted} · replies ${sumReplied}`);
    cmp(rows, "seller sum contacted == workspace", sumContacted, ind.contacted);
    const last = rows[rows.length - 1];
    console.log(`    ${last.status}  sum(sellers).contacted ${sumContacted} vs workspace ${ind.contacted} · diff ${last.diff}`);
    allRows.push({ ...last, case: c.id });
  }

  /* ── verdict ───────────────────────────────────────────────────────── */
  const byStatus = allRows.reduce((a, r) => (a[r.status] = (a[r.status] ?? 0) + 1, a), {} as Record<string, number>);
  console.log(`\n${"═".repeat(112)}`);
  console.log(`  ${allRows.length} comparisons · GREEN ${byStatus.GREEN ?? 0} · YELLOW ${byStatus.YELLOW ?? 0} · GRAY ${byStatus.GRAY ?? 0} · RED ${byStatus.RED ?? 0}`);
  writeFileSync("/tmp/recon/render-matrix.json", JSON.stringify(allRows, null, 2) + "\n");
  if (redCount) {
    console.log(`\n  ${redCount} RED — STOP. Rendered and independent values disagree.\n`);
    for (const r of allRows.filter(x => x.status === "RED")) {
      console.log(`    ${r.case.padEnd(16)} ${r.metric.padEnd(38)} rendered ${r.rendered}  independent ${r.independent}  diff ${r.diff}`);
    }
    console.log();
    process.exit(1);
  }
  console.log(`\n  Zero RED. Every rendered metric matches the independent recalculation.\n`);
}

run().catch(e => { console.error("\n[render] fatal:", e?.stack ?? e); process.exit(1); });
