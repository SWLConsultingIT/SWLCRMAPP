import { NextRequest, NextResponse } from "next/server";
import { getDashboardData, getSellerActivity } from "@/lib/dashboard-data";
import { getUserScope } from "@/lib/scope";

async function getBioId(): Promise<string | null> {
  const scope = await getUserScope();
  return scope.companyBioId ?? null;
}

export const runtime = "nodejs";
export const maxDuration = 60;

// Escape a CSV cell value (quote if contains comma, newline, or quote)
function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(...vals: unknown[]): string {
  return vals.map(cell).join(",");
}

function pct(n: number) { return `${n}%`; }

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

  const todayStr = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];
  const sep = () => lines.push("");

  // ── Overview: Pipeline KPIs ──────────────────────────────────────────────
  if (has("overview.kpis")) {
    lines.push("OVERVIEW – PIPELINE KPIs");
    lines.push(row("Metric", "Value"));
    lines.push(row("Total leads", headline.totalLeads));
    lines.push(row("Contacted", headline.contactedLeads));
    lines.push(row("Connected (LinkedIn)", headline.connectedLeads));
    lines.push(row("Replied", headline.repliedCount));
    lines.push(row("Positive", headline.positiveCount));
    lines.push(row("Won", headline.wonCount));
    lines.push(row("Response rate", pct(headline.responseRate)));
    lines.push(row("Conversion rate", pct(headline.conversionRate)));
    sep();
  }

  // ── Overview: ICP table ──────────────────────────────────────────────────
  if (has("overview.icps") && icpPerformance.length > 0) {
    lines.push("OVERVIEW – ICPs");
    lines.push(row("ICP", "Leads", "Flows", "Contacted", "Replied", "Positive", "Won", "Response rate", "Conversion rate"));
    for (const r of icpPerformance as Array<Record<string, unknown>>) {
      lines.push(row(
        r.name, r.leads, r.flows, r.contacted, r.replied, r.positive, r.won,
        pct(Number(r.responseRate)), pct(Number(r.conversionRate)),
      ));
    }
    sep();
  }

  // ── Outreach: Campaign performance ───────────────────────────────────────
  if (has("outreach.campaigns") && campaignPerformance.length > 0) {
    lines.push("OUTREACH – CAMPAIGN PERFORMANCE");
    lines.push(row("Campaign", "ICP", "Status", "Leads", "Sent", "LinkedIn", "Email", "Calls", "Uncontacted", "Replied", "Positive", "Negative", "Response rate", "Conversion rate"));
    for (const r of campaignPerformance as Array<Record<string, unknown>>) {
      lines.push(row(
        r.name, r.icp_profile_name ?? "—", r.status,
        r.leads, r.sent, r.sentLinkedin, r.sentEmail, r.sentCall,
        r.uncontactedLeads, r.replied, r.positive, r.negative,
        pct(Number(r.responseRate)), pct(Number(r.conversionRate)),
      ));
    }
    sep();
  }

  // ── Outreach: Channel breakdown ───────────────────────────────────────────
  if (has("outreach.channels") && channelBreakdown.length > 0) {
    lines.push("OUTREACH – CHANNEL BREAKDOWN");
    lines.push(row("Channel", "Sent", "Contacted", "Replied", "Positive", "Response rate", "Conversion rate"));
    for (const r of channelBreakdown) {
      lines.push(row(r.channel, r.sent, r.contacted, r.replied, r.positive, pct(r.responseRate), pct(r.conversionRate)));
    }
    sep();
  }

  // ── Channels: individual breakdown ───────────────────────────────────────
  const chMap: Record<string, (typeof channelBreakdown)[0]> = {};
  for (const c of channelBreakdown) chMap[c.channel] = c;

  if (has("channels.email") && chMap["email"]) {
    const e = chMap["email"];
    lines.push("CHANNELS – EMAIL");
    lines.push(row("Sent", "Contacted", "Replied", "Positive", "Response rate", "Conversion rate"));
    lines.push(row(e.sent, e.contacted, e.replied, e.positive, pct(e.responseRate), pct(e.conversionRate)));
    sep();
  }

  if (has("channels.linkedin") && chMap["linkedin"]) {
    const l = chMap["linkedin"];
    lines.push("CHANNELS – LINKEDIN");
    lines.push(row("Sent", "Contacted", "Replied", "Positive", "Response rate", "Conversion rate"));
    lines.push(row(l.sent, l.contacted, l.replied, l.positive, pct(l.responseRate), pct(l.conversionRate)));
    sep();
  }

  if (has("channels.calls") && callsBreakdown) {
    const c = callsBreakdown as Record<string, number>;
    lines.push("CHANNELS – CALLS");
    lines.push(row("Metric", "Value"));
    lines.push(row("Pending", c.pending));
    lines.push(row("Made", c.made));
    lines.push(row("Answered", c.answered));
    lines.push(row("Positive", c.positive));
    lines.push(row("Negative", c.negative));
    sep();
  }

  // ── Sellers: activity / leaderboard ──────────────────────────────────────
  const sellerRows = (sellerPerformance as Array<Record<string, unknown>>).map(s => {
    const act = activityMap.get(String(s.id ?? ""));
    const callOutcome = callOutcomesBySeller.find(x => x.sellerId === String(s.id ?? ""));
    return {
      name:        act?.displayName || String(s.name ?? "—"),
      contacted:   Number(s.contacted ?? 0),
      sent:        Number(s.sent ?? 0),
      replied:     Number(s.replied ?? 0),
      positive:    Number(s.positive ?? 0),
      active:      Number(s.active ?? 0),
      callsToday:  callOutcome?.byDay?.[todayStr]?.made ?? 0,
      callsMade:   callOutcome?.made ?? 0,
      callsAnswered: callOutcome?.answered ?? 0,
      callsInterested: callOutcome?.interested ?? 0,
    };
  });

  if ((has("sellers.activity") || has("sellers.table")) && sellerRows.length > 0) {
    lines.push("SELLERS – LEADERBOARD");
    lines.push(row("Seller", "Active campaigns", "Contacted", "Sent", "Replied", "Positive", "Calls today", "Calls (period)", "Answered", "Interested"));
    for (const s of sellerRows) {
      lines.push(row(s.name, s.active, s.contacted, s.sent, s.replied, s.positive, s.callsToday, s.callsMade, s.callsAnswered, s.callsInterested));
    }
    sep();
  }

  if (has("sellers.calls") && callOutcomesBySeller.length > 0) {
    lines.push("SELLERS – CALL OUTCOMES");
    lines.push(row("Seller", "Made", "Answered", "Interested", "Not interested", "Bad timing", "Voicemail", "Wrong number"));
    for (const r of callOutcomesBySeller) {
      lines.push(row(r.sellerName, r.made, r.answered, r.interested, r.notInterested, r.badTiming, r.voicemail, r.wrongNumber));
    }
    sep();
  }

  const csv = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);
  const filename = `GrowthAI-Report-${today}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
