import { NextRequest, NextResponse } from "next/server";
import { getDashboardData, getSellerActivity } from "@/lib/dashboard-data";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import ExcelJS from "exceljs";

async function getBioId(): Promise<string | null> {
  const scope = await getUserScope();
  return scope.companyBioId ?? null;
}

// Argentina is UTC-3 (no DST)
function toArgTime(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  };
}

function fmtDuration(secs: number | null) {
  if (!secs || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtClassification(cl: string | null) {
  const map: Record<string, string> = {
    positive:       "Interested",
    meeting_intent: "Interested",
    follow_up:      "Bad timing",
    voicemail:      "Voicemail",
    negative:       "Not interested",
    wrong_number:   "Wrong number",
    ambiguous:      "Ambiguous",
  };
  return cl ? (map[cl] ?? cl) : "Unclassified";
}

interface CallDetailRow {
  date: string;
  time: string;
  lead: string;
  company: string;
  seller: string;
  campaign: string;
  answered: string;
  outcome: string;
  duration: string;
}

async function getCallsDetail(bioId: string | null, from: string | null, to: string | null): Promise<CallDetailRow[]> {
  const supabase = await getSupabaseServer();

  // Fetch calls with lead info
  let q = (supabase as any)
    .from("calls")
    .select("id, lead_id, classification, duration, started_at, dialed_by_user_id, leads!inner(primary_first_name, primary_last_name, company_name, company_bio_id)")
    .order("started_at", { ascending: false });

  if (bioId) q = q.eq("leads.company_bio_id", bioId);
  // Use explicit Argentina UTC-3 offset so PostgREST compares against
  // midnight/end-of-day in Buenos Aires, not UTC.
  if (from)  q = q.gte("started_at", from + "T00:00:00-03:00");
  if (to)    q = q.lte("started_at", to   + "T23:59:59-03:00");

  const { data: callRows } = await q;
  if (!callRows?.length) return [];

  // Fetch campaigns (lead_id → seller_id, name)
  const leadIds = [...new Set((callRows as any[]).map((c: any) => c.lead_id).filter(Boolean))];
  const leadToCampaign = new Map<string, { name: string; sellerId: string | null }>();
  if (leadIds.length) {
    const BATCH = 500; // stay well under PostgREST 1000-row .in() limit
    for (let i = 0; i < leadIds.length; i += BATCH) {
      let cq = (supabase as any)
        .from("campaigns")
        .select("lead_id, name, seller_id")
        .in("lead_id", leadIds.slice(i, i + BATCH));
      if (bioId) cq = cq.eq("company_bio_id", bioId);
      const { data: campRows } = await cq;
      for (const c of campRows ?? []) {
        if (c.lead_id && !leadToCampaign.has(c.lead_id)) {
          leadToCampaign.set(c.lead_id, { name: c.name ?? "—", sellerId: c.seller_id ?? null });
        }
      }
    }
  }

  // Fetch sellers (id → name, user_id → name)
  const sellerIdToName = new Map<string, string>();
  const userIdToName   = new Map<string, string>();
  {
    let sq = (supabase as any).from("sellers").select("id, name, user_id");
    if (bioId) sq = sq.eq("company_bio_id", bioId);
    const { data: sellers } = await sq;
    for (const s of sellers ?? []) {
      if (s.id)      sellerIdToName.set(s.id, s.name ?? "—");
      if (s.user_id) userIdToName.set(s.user_id, s.name ?? "—");
    }
  }

  // Deduplicate by lead+minute (same call can appear as 2 DB rows)
  const seen = new Set<string>();
  const rows: CallDetailRow[] = [];

  for (const c of callRows as any[]) {
    const minute = (c.started_at ?? "").slice(0, 16);
    const dedupKey = `${c.lead_id ?? "?"}|${minute}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const lead       = c.leads as any;
    const firstName  = lead?.primary_first_name ?? "";
    const lastName   = lead?.primary_last_name  ?? "";
    const leadName   = `${firstName} ${lastName}`.trim() || "—";
    const company    = lead?.company_name ?? "—";
    const camp       = leadToCampaign.get(c.lead_id ?? "");
    const campName   = camp?.name ?? "—";

    // Seller: prefer dialer, fall back to flow owner
    const sellerName =
      (c.dialed_by_user_id ? userIdToName.get(c.dialed_by_user_id) : undefined) ??
      (camp?.sellerId       ? sellerIdToName.get(camp.sellerId)     : undefined) ??
      "—";

    const { date, time } = toArgTime(c.started_at);
    const answered       = (c.duration ?? 0) > 0;

    rows.push({
      date,
      time,
      lead:     leadName,
      company,
      seller:   sellerName,
      campaign: campName,
      answered: answered ? "Yes" : "No",
      outcome:  fmtClassification(c.classification),
      duration: fmtDuration(c.duration),
    });
  }

  return rows;
}

export const runtime = "nodejs";
export const maxDuration = 60;

// Brand palette (ARGB for ExcelJS)
const GOLD      = "FFC9A83A";
const DARK      = "FF0C0E1B";
const ZEBRA     = "FFFFF8E8";
const WHITE     = "FFFFFFFF";
const GRAY_TEXT = "FF6B6B6B";

function pct(n: number) { return `${n}%`; }

type CellValue = string | number | null;

const thinBorder: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD9D0BB" } };

function addSection(
  ws: ExcelJS.Worksheet,
  title: string,
  headers: string[],
  rows: CellValue[][],
) {
  const colCount = headers.length;

  // ── Title row ──
  const tRow = ws.addRow([title, ...Array(colCount - 1).fill("")]);
  tRow.height = 24;
  ws.mergeCells(tRow.number, 1, tRow.number, colCount);
  const tCell = tRow.getCell(1);
  tCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
  tCell.font      = { bold: true, color: { argb: GOLD }, size: 12, name: "Calibri" };
  tCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

  // ── Header row ──
  const hRow = ws.addRow(headers);
  hRow.height = 20;
  headers.forEach((_, i) => {
    const c = hRow.getCell(i + 1);
    c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
    c.font      = { bold: true, color: { argb: DARK }, size: 10, name: "Calibri" };
    c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "center", wrapText: false };
    c.border    = {
      top:    { style: "medium", color: { argb: DARK } },
      bottom: { style: "medium", color: { argb: DARK } },
      left:   i === 0 ? { style: "medium", color: { argb: DARK } } : thinBorder,
      right:  i === colCount - 1 ? { style: "medium", color: { argb: DARK } } : thinBorder,
    };
  });

  // ── Data rows ──
  rows.forEach((rowData, idx) => {
    const isZebra = idx % 2 === 1;
    const dRow = ws.addRow(rowData.map(v => v ?? ""));
    dRow.height = 17;
    dRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: isZebra ? ZEBRA : WHITE } };
      cell.font   = {
        size: 10,
        name: "Calibri",
        bold: colNum === 1,
        color: { argb: colNum === 1 ? DARK : "FF222222" },
      };
      cell.alignment = { vertical: "middle", horizontal: colNum === 1 ? "left" : "center" };
      cell.border = {
        top:    thinBorder,
        bottom: idx === rows.length - 1 ? { style: "medium", color: { argb: DARK } } : thinBorder,
        left:   colNum === 1 ? { style: "medium", color: { argb: DARK } } : thinBorder,
        right:  colNum === colCount ? { style: "medium", color: { argb: DARK } } : thinBorder,
      };
    });
  });

  // Spacer
  ws.addRow([]);
  ws.addRow([]);
}

function addReportTitle(ws: ExcelJS.Worksheet, sheetName: string, periodLabel: string) {
  const titleRow = ws.addRow(["GrowthAI — " + sheetName]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, 14);
  titleRow.height = 32;
  const c = titleRow.getCell(1);
  c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
  c.font      = { bold: true, color: { argb: GOLD }, size: 16, name: "Calibri" };
  c.alignment = { vertical: "middle", horizontal: "left", indent: 2 };

  const subRow = ws.addRow([periodLabel]);
  ws.mergeCells(subRow.number, 1, subRow.number, 14);
  subRow.height = 16;
  const s = subRow.getCell(1);
  s.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1F33" } };
  s.font      = { color: { argb: GRAY_TEXT }, size: 9, name: "Calibri", italic: true };
  s.alignment = { vertical: "middle", horizontal: "left", indent: 2 };

  ws.addRow([]);
}

function autoWidth(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col, i) => {
    let max = i === 0 ? 18 : 10;
    col.eachCell?.({ includeEmpty: false }, cell => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 4, 52);
  });
}

export async function GET(req: NextRequest) {
  const sp       = Object.fromEntries(req.nextUrl.searchParams.entries());
  const sections = new Set((sp.sections ?? "").split(",").filter(Boolean));
  const has      = (k: string) => sections.size === 0 || sections.has(k);

  const filters = {
    from:          sp.from     ?? null,
    to:            sp.to       ?? null,
    campaignNames: sp.campaign ? [sp.campaign] : undefined,
    sellerIds:     sp.seller   ? [sp.seller]   : undefined,
    icpIds:        sp.icp      ? [sp.icp]       : undefined,
  };

  const bioId = await getBioId();
  const [data, activityMap] = await Promise.all([
    getDashboardData(filters),
    getSellerActivity(bioId),
  ]);

  const {
    headline,
    channelBreakdown,
    icpPerformance,
    sellerPerformance,
    callOutcomesBySeller,
    campaignPerformance,
    callsBreakdown,
  } = data;

  const todayStr   = new Date().toISOString().slice(0, 10);
  const fromLabel  = sp.from ?? "—";
  const toLabel    = sp.to   ?? todayStr;
  const periodStr  = `Period: ${fromLabel} → ${toLabel}  ·  Generated: ${todayStr}`;

  const wb = new ExcelJS.Workbook();
  wb.creator  = "GrowthAI";
  wb.created  = new Date();
  wb.modified = new Date();

  // ── Sheet 1: Overview ────────────────────────────────────────────────────
  if (has("overview.kpis") || has("overview.icps")) {
    const ws = wb.addWorksheet("Overview", {
      properties: { tabColor: { argb: GOLD } },
    });
    ws.views = [{ showGridLines: false }];
    addReportTitle(ws, "Overview", periodStr);

    if (has("overview.kpis")) {
      addSection(ws, "PIPELINE KPIs", ["Metric", "Value"], [
        ["Total leads",          headline.totalLeads],
        ["Contacted",            headline.contactedLeads],
        ["Connected (LinkedIn)", headline.connectedLeads],
        ["Replied",              headline.repliedCount],
        ["Positive",             headline.positiveCount],
        ["Won",                  headline.wonCount],
        ["Response rate",        pct(headline.responseRate)],
        ["Conversion rate",      pct(headline.conversionRate)],
      ]);
    }

    if (has("overview.icps") && icpPerformance.length > 0) {
      addSection(
        ws,
        "ICP PERFORMANCE",
        ["ICP", "Leads", "Flows", "Contacted", "Replied", "Positive", "Won", "Response rate", "Conv. rate"],
        (icpPerformance as Array<Record<string, unknown>>).map(r => [
          String(r.name ?? ""),
          Number(r.leads ?? 0),
          Number(r.flows ?? 0),
          Number(r.contacted ?? 0),
          Number(r.replied ?? 0),
          Number(r.positive ?? 0),
          Number(r.won ?? 0),
          pct(Number(r.responseRate ?? 0)),
          pct(Number(r.conversionRate ?? 0)),
        ]),
      );
    }

    autoWidth(ws);
  }

  // ── Sheet 2: Campaigns ───────────────────────────────────────────────────
  if (has("outreach.campaigns") || has("outreach.channels")) {
    const ws = wb.addWorksheet("Campaigns", {
      properties: { tabColor: { argb: GOLD } },
    });
    ws.views = [{ showGridLines: false }];
    addReportTitle(ws, "Campaigns", periodStr);

    if (has("outreach.campaigns") && campaignPerformance.length > 0) {
      addSection(
        ws,
        "CAMPAIGN PERFORMANCE",
        ["Campaign", "ICP", "Status", "Leads", "Sent", "LinkedIn", "Email", "Calls", "Uncontacted", "Replied", "Positive", "Negative", "Resp. rate", "Conv. rate"],
        (campaignPerformance as Array<Record<string, unknown>>).map(r => [
          String(r.name ?? ""),
          String(r.icp_profile_name ?? "—"),
          String(r.status ?? ""),
          Number(r.leads ?? 0),
          Number(r.sent ?? 0),
          Number(r.sentLinkedin ?? 0),
          Number(r.sentEmail ?? 0),
          Number(r.sentCall ?? 0),
          Number(r.uncontactedLeads ?? 0),
          Number(r.replied ?? 0),
          Number(r.positive ?? 0),
          Number(r.negative ?? 0),
          pct(Number(r.responseRate ?? 0)),
          pct(Number(r.conversionRate ?? 0)),
        ]),
      );
    }

    if (has("outreach.channels") && channelBreakdown.length > 0) {
      addSection(
        ws,
        "CHANNEL BREAKDOWN",
        ["Channel", "Sent", "Contacted", "Replied", "Positive", "Response rate", "Conv. rate"],
        channelBreakdown.map(r => [
          r.channel, r.sent, r.contacted, r.replied, r.positive,
          pct(r.responseRate), pct(r.conversionRate),
        ]),
      );
    }

    autoWidth(ws);
  }

  // ── Sheet 3: Channels ────────────────────────────────────────────────────
  if (has("channels.email") || has("channels.linkedin") || has("channels.calls")) {
    const ws = wb.addWorksheet("Channels", {
      properties: { tabColor: { argb: GOLD } },
    });
    ws.views = [{ showGridLines: false }];
    addReportTitle(ws, "Channels", periodStr);

    const chMap: Record<string, typeof channelBreakdown[0]> = {};
    for (const c of channelBreakdown) chMap[c.channel] = c;

    if (has("channels.email") && chMap["email"]) {
      const e = chMap["email"];
      addSection(ws, "EMAIL", ["Sent", "Contacted", "Replied", "Positive", "Response rate", "Conv. rate"], [
        [e.sent, e.contacted, e.replied, e.positive, pct(e.responseRate), pct(e.conversionRate)],
      ]);
    }

    if (has("channels.linkedin") && chMap["linkedin"]) {
      const l = chMap["linkedin"];
      addSection(ws, "LINKEDIN", ["Sent", "Contacted", "Replied", "Positive", "Response rate", "Conv. rate"], [
        [l.sent, l.contacted, l.replied, l.positive, pct(l.responseRate), pct(l.conversionRate)],
      ]);
    }

    if (has("channels.calls") && callsBreakdown) {
      const c = callsBreakdown as Record<string, number>;
      addSection(ws, "CALLS", ["Metric", "Value"], [
        ["Pending",  c.pending  ?? 0],
        ["Made",     c.made     ?? 0],
        ["Answered", c.answered ?? 0],
        ["Positive", c.positive ?? 0],
        ["Negative", c.negative ?? 0],
      ]);
    }

    autoWidth(ws);
  }

  // ── Sheet 4: Sellers ─────────────────────────────────────────────────────
  if (has("sellers.activity") || has("sellers.table") || has("sellers.calls")) {
    const ws = wb.addWorksheet("Sellers", {
      properties: { tabColor: { argb: GOLD } },
    });
    ws.views = [{ showGridLines: false }];
    addReportTitle(ws, "Sellers", periodStr);

    const sellerRows = (sellerPerformance as Array<Record<string, unknown>>).map(s => {
      const act         = activityMap.get(String(s.id ?? ""));
      const callOutcome = callOutcomesBySeller.find(x => x.sellerId === String(s.id ?? ""));
      return {
        name:            act?.displayName || String(s.name ?? "—"),
        active:          Number(s.active ?? 0),
        contacted:       Number(s.contacted ?? 0),
        sent:            Number(s.sent ?? 0),
        replied:         Number(s.replied ?? 0),
        positive:        Number(s.positive ?? 0),
        callsToday:      callOutcome?.byDay?.[todayStr]?.made ?? 0,
        callsMade:       callOutcome?.made ?? 0,
        callsAnswered:   callOutcome?.answered ?? 0,
        callsInterested: callOutcome?.interested ?? 0,
      };
    });

    if ((has("sellers.activity") || has("sellers.table")) && sellerRows.length > 0) {
      addSection(
        ws,
        "SELLERS LEADERBOARD",
        ["Seller", "Active flows", "Contacted", "Sent", "Replied", "Positive", "Calls today", "Calls (period)", "Answered", "Interested"],
        sellerRows.map(s => [
          s.name, s.active, s.contacted, s.sent, s.replied, s.positive,
          s.callsToday, s.callsMade, s.callsAnswered, s.callsInterested,
        ]),
      );
    }

    if (has("sellers.calls") && callOutcomesBySeller.length > 0) {
      addSection(
        ws,
        "CALL OUTCOMES BY SELLER",
        ["Seller", "Made", "Answered", "Interested", "Not interested", "Bad timing", "Voicemail", "Wrong number"],
        callOutcomesBySeller.map(r => [
          r.sellerName, r.made, r.answered, r.interested,
          r.notInterested, r.badTiming, r.voicemail, r.wrongNumber,
        ]),
      );
    }

    autoWidth(ws);
  }

  // ── Sheet 5: Calls Detail ────────────────────────────────────────────────
  // Always included — this is the main reason people export
  {
    const ws = wb.addWorksheet("Calls Detail", {
      properties: { tabColor: { argb: GOLD } },
    });
    // ySplit:5 freezes rows 1-5: title + subtitle + spacer + section title + header
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 0, ySplit: 5 }];
    addReportTitle(ws, "Calls Detail", periodStr);

    const callDetail = await getCallsDetail(bioId, sp.from ?? null, sp.to ?? null);

    if (callDetail.length > 0) {
      addSection(
        ws,
        "CALL LOG — one row per call",
        ["Date", "Time", "Lead", "Company", "Seller", "Campaign", "Answered", "Outcome", "Duration"],
        callDetail.map(r => [
          r.date, r.time, r.lead, r.company, r.seller, r.campaign, r.answered, r.outcome, r.duration,
        ]),
      );
    } else {
      ws.addRow(["No calls found for the selected period."]);
    }

    // Widen columns: lead/company/campaign need more space
    ws.columns.forEach((col, i) => {
      const mins = [12, 7, 22, 22, 16, 30, 10, 16, 10];
      let max = mins[i] ?? 10;
      col.eachCell?.({ includeEmpty: false }, cell => {
        const len = cell.value != null ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 50);
    });
  }

  // ── Serialize ────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const today  = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="GrowthAI-Report-${today}.xlsx"`,
    },
  });
}
