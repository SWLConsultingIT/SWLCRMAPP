import { NextRequest, NextResponse } from "next/server";
import { getDashboardData, getSellerActivity } from "@/lib/dashboard-data";
import { getUserScope } from "@/lib/scope";
import ExcelJS from "exceljs";

async function getBioId(): Promise<string | null> {
  const scope = await getUserScope();
  return scope.companyBioId ?? null;
}

export const runtime = "nodejs";
export const maxDuration = 60;

// Brand palette (ARGB for ExcelJS)
const GOLD       = "FFC9A83A";
const DARK       = "FF0C0E1B";
const ZEBRA      = "FFFFF8E8"; // very light warm tint
const WHITE      = "FFFFFFFF";
const BORDER_CLR = "FFD4B84A"; // slightly lighter gold for borders
const GRAY_TEXT  = "FF6B6B6B";

function pct(n: number) { return `${n}%`; }

type CellValue = string | number | null;

const thinBorder: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD9D0BB" } };
const tableBorder = {
  top:    thinBorder,
  left:   thinBorder,
  bottom: thinBorder,
  right:  thinBorder,
};

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
