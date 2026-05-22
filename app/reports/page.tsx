import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { C } from "@/lib/design";
import {
  TrendingUp, TrendingDown, MessageSquare, Target, Zap,
  Share2, Mail, Phone, Trophy, ArrowUp, ArrowDown, Minus,
  Sparkles, AlertTriangle, Lightbulb, CheckCircle2,
} from "lucide-react";
import PageHero from "@/components/PageHero";
import CollapsibleCard from "@/components/CollapsibleCard";
import TermTooltip from "@/components/TermTooltip";
import Link from "next/link";

// Inline tiny SVG sparkline. Pure SVG keeps the bundle free of chart libs
// and renders fine in RSC since we only ship serialisable props down.
function Sparkline({ data, color, width = 88, height = 28 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  if (!data || data.length === 0) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(1, max - min);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(data.length - 1) * stepX} cy={lastY} r={2.4} fill={color} />
    </svg>
  );
}

const gold = "var(--brand, #c9a83a)";

type ReportFilters = {
  from: string | null;
  to: string | null;
  campaignNames: string[];
  sellerIds: string[];
  icpIds: string[];
};

async function getReportData(filters: ReportFilters) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const leadsQ = supabase.from("leads").select("id, status, lead_score, is_priority, icp_profile_id, created_at");
  const campsQ = supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, created_at, leads!inner(company_bio_id)");
  const repliesQ = supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at, leads!inner(company_bio_id)");
  const msgsQ = supabase.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, campaigns!inner(leads!inner(company_bio_id))");
  const profilesQ = supabase.from("icp_profiles").select("id, profile_name").eq("status", "approved");
  const sellersQ = supabase.from("sellers").select("id, name, active, company_bio_id");

  const [
    { data: allLeads },
    { data: allCampaigns },
    { data: allReplies },
    { data: allMessages },
    { data: allProfiles },
    { data: allSellers },
  ] = await Promise.all([
    bioId ? leadsQ.eq("company_bio_id", bioId) : leadsQ,
    bioId ? campsQ.eq("leads.company_bio_id", bioId) : campsQ,
    bioId ? repliesQ.eq("leads.company_bio_id", bioId) : repliesQ,
    bioId ? msgsQ.eq("campaigns.leads.company_bio_id", bioId) : msgsQ,
    bioId ? profilesQ.eq("company_bio_id", bioId) : profilesQ,
    bioId ? sellersQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`) : sellersQ,
  ]) as any;

  // In-memory filtering: this page already pulls all tenant rows for
  // aggregation, so applying date / campaign / seller / ICP filters here
  // costs one extra pass instead of a redesign of every group-by.
  const fromMs = filters.from ? new Date(`${filters.from}T00:00:00Z`).getTime() : null;
  const toMs   = filters.to   ? new Date(`${filters.to}T23:59:59Z`).getTime()   : null;
  const campSet = filters.campaignNames.length > 0 ? new Set(filters.campaignNames) : null;
  const sellerSet = filters.sellerIds.length > 0 ? new Set(filters.sellerIds) : null;
  const icpSet = filters.icpIds.length > 0 ? new Set(filters.icpIds) : null;

  const leads = (allLeads ?? []).filter((l: any) => {
    if (icpSet && !icpSet.has(l.icp_profile_id)) return false;
    if (fromMs && new Date(l.created_at).getTime() < fromMs) return false;
    if (toMs   && new Date(l.created_at).getTime() > toMs)   return false;
    return true;
  });
  const leadIdSet = new Set(leads.map((l: any) => l.id));

  const campaigns = (allCampaigns ?? []).filter((c: any) => {
    if (campSet && !campSet.has(c.name)) return false;
    if (sellerSet && !sellerSet.has(c.seller_id)) return false;
    if (icpSet && c.lead_id && !leadIdSet.has(c.lead_id)) return false; // narrow via leads filter
    return true;
  });
  const campaignIdSet = new Set(campaigns.map((c: any) => c.id));

  const replies = (allReplies ?? []).filter((r: any) => {
    if (fromMs && new Date(r.received_at).getTime() < fromMs) return false;
    if (toMs   && new Date(r.received_at).getTime() > toMs)   return false;
    if (icpSet && r.lead_id && !leadIdSet.has(r.lead_id)) return false;
    if ((campSet || sellerSet) && r.campaign_id && !campaignIdSet.has(r.campaign_id)) return false;
    return true;
  });
  const messages = (allMessages ?? []).filter((m: any) => {
    if (fromMs && m.sent_at && new Date(m.sent_at).getTime() < fromMs) return false;
    if (toMs   && m.sent_at && new Date(m.sent_at).getTime() > toMs)   return false;
    if ((campSet || sellerSet || icpSet) && m.campaign_id && !campaignIdSet.has(m.campaign_id)) return false;
    return true;
  });
  const profiles = allProfiles ?? [];

  const profileMap: Record<string, string> = {};
  for (const p of profiles) profileMap[p.id] = p.profile_name;

  // ── Global KPIs ──
  const totalLeads = leads.length;
  const leadsWithCampaign = new Set(campaigns.map((c: any) => c.lead_id).filter(Boolean));
  const contactedLeads = leadsWithCampaign.size;
  const repliedLeadIds = new Set(replies.map((r: any) => r.lead_id));
  const repliedCount = repliedLeadIds.size;
  const positiveReplies = replies.filter((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
  const positiveLeadIds = new Set(positiveReplies.map((r: any) => r.lead_id));
  const positiveCount = positiveLeadIds.size;

  const responseRate = contactedLeads > 0 ? Math.round((repliedCount / contactedLeads) * 100) : 0;
  const conversionRate = contactedLeads > 0 ? Math.round((positiveCount / contactedLeads) * 100) : 0;

  // Avg steps to convert
  const stepsToConvert: number[] = [];
  for (const c of campaigns) {
    if (positiveLeadIds.has(c.lead_id)) {
      stepsToConvert.push(c.current_step ?? 0);
    }
  }
  const avgSteps = stepsToConvert.length > 0 ? Math.round(stepsToConvert.reduce((a, b) => a + b, 0) / stepsToConvert.length * 10) / 10 : 0;

  // ── Campaign comparison ──
  const campGroups: Record<string, {
    name: string; channels: Set<string>; leads: Set<string>;
    replied: Set<string>; positive: Set<string>; msgsSent: number;
    totalSteps: number; stepSum: number;
  }> = {};

  for (const c of campaigns) {
    if (!campGroups[c.name]) campGroups[c.name] = { name: c.name, channels: new Set(), leads: new Set(), replied: new Set(), positive: new Set(), msgsSent: 0, totalSteps: 0, stepSum: 0 };
    const g = campGroups[c.name];
    g.channels.add(c.channel);
    if (c.lead_id) g.leads.add(c.lead_id);
    if (c.lead_id && repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
    if (c.lead_id && positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
    const ts = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
    g.totalSteps = Math.max(g.totalSteps, ts);
    g.stepSum += c.current_step ?? 0;
  }

  // Count sent messages per campaign name
  const campIdToName: Record<string, string> = {};
  for (const c of campaigns) campIdToName[c.id] = c.name;
  for (const m of messages) {
    if (m.sent_at && campIdToName[m.campaign_id]) {
      const name = campIdToName[m.campaign_id];
      if (campGroups[name]) campGroups[name].msgsSent++;
    }
  }

  const campaignComparison = Object.values(campGroups).map(g => ({
    name: g.name,
    channels: [...g.channels],
    leads: g.leads.size,
    msgsSent: g.msgsSent,
    replied: g.replied.size,
    positive: g.positive.size,
    responseRate: g.leads.size > 0 ? Math.round((g.replied.size / g.leads.size) * 100) : 0,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
    totalSteps: g.totalSteps,
  })).sort((a, b) => b.conversionRate - a.conversionRate);

  // Best campaign
  const bestCampaign = campaignComparison.length > 0 ? campaignComparison[0] : null;

  // ── ICP Profile performance ──
  const profileGroups: Record<string, { name: string; leads: number; contacted: number; replied: number; positive: number }> = {};
  for (const l of leads) {
    if (!l.icp_profile_id) continue;
    const name = profileMap[l.icp_profile_id] ?? "Unknown";
    if (!profileGroups[l.icp_profile_id]) profileGroups[l.icp_profile_id] = { name, leads: 0, contacted: 0, replied: 0, positive: 0 };
    const g = profileGroups[l.icp_profile_id];
    g.leads++;
    if (leadsWithCampaign.has(l.id)) g.contacted++;
    if (repliedLeadIds.has(l.id)) g.replied++;
    if (positiveLeadIds.has(l.id)) g.positive++;
  }
  const profilePerformance = Object.values(profileGroups).sort((a, b) => b.positive - a.positive);

  // ── Channel analysis ──
  const channelStats: Record<string, { contacted: Set<string>; replied: Set<string>; positive: Set<string> }> = {};
  for (const c of campaigns) {
    if (!channelStats[c.channel]) channelStats[c.channel] = { contacted: new Set(), replied: new Set(), positive: new Set() };
    if (c.lead_id) {
      channelStats[c.channel].contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) channelStats[c.channel].replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) channelStats[c.channel].positive.add(c.lead_id);
    }
  }
  const channelAnalysis = Object.entries(channelStats).map(([ch, s]) => ({
    channel: ch,
    contacted: s.contacted.size,
    replied: s.replied.size,
    positive: s.positive.size,
    responseRate: s.contacted.size > 0 ? Math.round((s.replied.size / s.contacted.size) * 100) : 0,
    conversionRate: s.contacted.size > 0 ? Math.round((s.positive.size / s.contacted.size) * 100) : 0,
  })).sort((a, b) => b.responseRate - a.responseRate);

  const bestChannel = channelAnalysis.length > 0 ? channelAnalysis[0] : null;

  // ── Reply classification breakdown ──
  const replyBreakdown: Record<string, number> = {};
  for (const r of replies) {
    const cls = r.classification ?? "unclassified";
    replyBreakdown[cls] = (replyBreakdown[cls] ?? 0) + 1;
  }

  // ── Response by step number ──
  const replyByCampId: Record<string, string> = {};
  for (const r of replies) {
    if (r.campaign_id) replyByCampId[r.campaign_id] = r.classification;
  }
  const stepReplies: Record<number, { total: number; replied: number }> = {};
  for (const c of campaigns) {
    const step = c.current_step ?? 0;
    if (!stepReplies[step]) stepReplies[step] = { total: 0, replied: 0 };
    stepReplies[step].total++;
    if (c.lead_id && repliedLeadIds.has(c.lead_id)) stepReplies[step].replied++;
  }

  // ── Seller performance ──
  const sellerMap: Record<string, string> = {};
  for (const s of allSellers ?? []) sellerMap[s.id] = s.name;
  const sellerGroups: Record<string, { name: string; contacted: Set<string>; replied: Set<string>; positive: Set<string>; activeCampaigns: number }> = {};
  for (const c of campaigns) {
    if (!c.seller_id) continue;
    const sName = sellerMap[c.seller_id] ?? "Unassigned";
    if (!sellerGroups[c.seller_id]) sellerGroups[c.seller_id] = { name: sName, contacted: new Set(), replied: new Set(), positive: new Set(), activeCampaigns: 0 };
    const g = sellerGroups[c.seller_id];
    if (c.lead_id) {
      g.contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
    }
    if (c.status === "active") g.activeCampaigns++;
  }
  const sellerPerformance = Object.values(sellerGroups).map(g => ({
    name: g.name,
    contacted: g.contacted.size,
    replied: g.replied.size,
    positive: g.positive.size,
    active: g.activeCampaigns,
    conversionRate: g.contacted.size > 0 ? Math.round((g.positive.size / g.contacted.size) * 100) : 0,
    responseRate: g.contacted.size > 0 ? Math.round((g.replied.size / g.contacted.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive);
  const topSeller = sellerPerformance[0] ?? null;

  // ── Forecast (projected positive conversions this month) ──
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const last30Positive = positiveReplies.filter((r: any) => new Date(r.received_at).getTime() >= thirtyDaysAgo).length;
  const dailyRate = last30Positive / 30;
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const forecastMonthly = Math.round(dailyRate * daysInMonth);
  const activeLeadCount = campaigns.filter((c: any) => c.status === "active").length;
  const forecastFromPipeline = Math.round(activeLeadCount * (conversionRate / 100));

  // ── Weekly trend (last 8 weeks) ──
  const weeklyReplies: { week: string; replies: number; positive: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(Date.now() - (i + 1) * 7 * 86400000);
    const weekEnd = new Date(Date.now() - i * 7 * 86400000);
    const weekLabel = weekStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    const weekReps = replies.filter((r: any) => {
      const d = new Date(r.received_at);
      return d >= weekStart && d < weekEnd;
    });
    weeklyReplies.push({
      week: weekLabel,
      replies: weekReps.length,
      positive: weekReps.filter((r: any) => r.classification === "positive" || r.classification === "meeting_intent").length,
    });
  }

  // ── Prior period delta ──
  // Compute the same headline metrics over the equivalent window immediately
  // before the active filter window. Enables ↑/↓ deltas in the hero. If no
  // filter is set, defaults to last 30 days vs prior 30 days.
  const periodMs =
    fromMs && toMs ? (toMs - fromMs)
    : 30 * 86400000;
  const priorTo = fromMs ?? (Date.now() - 30 * 86400000);
  const priorFrom = priorTo - periodMs;
  const priorReplies = (allReplies ?? []).filter((r: any) => {
    const t = new Date(r.received_at).getTime();
    return t >= priorFrom && t < priorTo;
  });
  const priorPositive = priorReplies.filter((r: any) =>
    r.classification === "positive" || r.classification === "meeting_intent"
  ).length;
  const priorReplied = new Set(priorReplies.map((r: any) => r.lead_id)).size;
  const prior = { positive: priorPositive, replied: priorReplied };

  function pctDelta(curr: number, prev: number): number | null {
    if (prev === 0) return curr > 0 ? 100 : null;
    return Math.round(((curr - prev) / prev) * 100);
  }
  const deltaPositive = pctDelta(positiveCount, prior.positive);
  const deltaReplied  = pctDelta(repliedCount, prior.replied);

  // ── Auto-insights — short natural-language strings the hero surfaces below
  // the headline numbers. Generated server-side from the same aggregates the
  // page already computes; no extra round-trip. We cap at 3 so the strip
  // stays scannable.
  const insights: { tone: "positive" | "warning" | "neutral"; text: string }[] = [];
  if (deltaPositive !== null && deltaPositive >= 15) {
    insights.push({ tone: "positive", text: `Positive replies up ${deltaPositive}% vs prior period — momentum is building.` });
  } else if (deltaPositive !== null && deltaPositive <= -15) {
    insights.push({ tone: "warning", text: `Positive replies down ${Math.abs(deltaPositive)}% vs prior period — investigate which campaign cooled off.` });
  }
  if (bestChannel && channelAnalysis.length >= 2) {
    const worst = channelAnalysis[channelAnalysis.length - 1];
    const gap = bestChannel.responseRate - worst.responseRate;
    if (gap >= 10) {
      const a = channelMetaLocal[bestChannel.channel]?.label ?? bestChannel.channel;
      const b = channelMetaLocal[worst.channel]?.label ?? worst.channel;
      insights.push({ tone: "neutral", text: `${a} is outperforming ${b} by ${gap}% response — consider shifting weight.` });
    }
  }
  if (topSeller && sellerPerformance.length >= 2) {
    const second = sellerPerformance[1];
    if (topSeller.positive >= second.positive + 3) {
      insights.push({ tone: "positive", text: `${topSeller.name} leads with ${topSeller.positive} positives — ${topSeller.positive - second.positive} ahead of #2.` });
    }
  }
  const zeroConvCampaigns = campaignComparison.filter(c => c.leads >= 10 && c.conversionRate === 0);
  if (zeroConvCampaigns.length > 0) {
    const names = zeroConvCampaigns.slice(0, 2).map(c => c.name).join(", ");
    insights.push({ tone: "warning", text: `${zeroConvCampaigns.length} campaign${zeroConvCampaigns.length === 1 ? "" : "s"} at 0% conversion (${names}) — review messages or pause.` });
  }

  return {
    totalLeads, contactedLeads, repliedCount, positiveCount,
    responseRate, conversionRate, avgSteps,
    bestCampaign, bestChannel, topSeller,
    campaignComparison, profilePerformance, channelAnalysis, sellerPerformance,
    replyBreakdown, stepReplies, weeklyReplies,
    forecastMonthly, forecastFromPipeline, dailyRate, activeLeadCount,
    prior, deltaPositive, deltaReplied,
    insights: insights.slice(0, 3),
  };
}

// Server-side mirror of the channelMeta map below — duplicated only because
// the JSX-only `channelMeta` is defined after `getReportData` and TS rejects
// the forward reference at compile time.
const channelMetaLocal: Record<string, { label: string }> = {
  linkedin: { label: "LinkedIn" },
  email:    { label: "Email" },
  call:     { label: "Call" },
  whatsapp: { label: "WhatsApp" },
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

export default async function ReportsPage({
  searchParams,
}: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = searchParams ? await searchParams : {};
  const get = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : sp[k]) as string | undefined;
  const split = (v: string | undefined) => (v ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const filters: ReportFilters = {
    from: get("from") ?? null,
    to: get("to") ?? null,
    campaignNames: split(get("campaigns")),
    sellerIds: split(get("sellers")),
    icpIds: split(get("icps")),
  };
  const data = await getReportData(filters);

  return (
    <div className="p-6 pt-0">
      {/* Old PageHero ("Reports — Full performance breakdown…") was removed.
          We're already inside a "Reports" tab whose label says exactly that,
          and the new hero below carries the page identity via its eyebrow.
          Killing the duplicate header tightened the page by ~110px of empty
          space and stops the filter bar from sitting visually orphaned
          above a second title. */}

      {/* SWL Consulting branded header strip — anchors the Reports surface
          to the SWL identity (same gold accent + pulsing dot from the login
          marketing page). Reports are the page sellers screenshot and share
          with clients, so the branding earns its place here. */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border"
          style={{
            borderColor: `color-mix(in srgb, ${gold} 32%, transparent)`,
            backgroundColor: `color-mix(in srgb, ${gold} 6%, transparent)`,
          }}>
          <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: gold }} />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: gold }}>
            SWL Growth Reports
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: C.textDim }}>
          <img
            src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
            alt="SWL Consulting"
            className="h-3 w-auto object-contain opacity-50"
          />
          <span className="font-semibold uppercase tracking-wider">Prepared by SWL Consulting</span>
        </div>
      </div>

      {/* ═══ HERO — headline + delta + sparkline + sub-stats ═══
          Replaces the previous 5-up KPI strip. Sellers consistently asked
          "how am I doing right now?" — the old strip showed 5 equal-weight
          numbers and forced them to interpret. The hero answers the question
          in one glance: one big number (positive replies) with a vs-prior-
          period delta, a sparkline of the last 8 weeks, and 3 supporting
          stats below. */}
      {(() => {
        const dPos = data.deltaPositive;
        const dRep = data.deltaReplied;
        const sparkData = data.weeklyReplies.map((w: { positive: number }) => w.positive);
        // Hide the delta chip when the prior period was zero — "+100% vs prior"
        // off a zero baseline is misleading celebratory noise. Same for when
        // we have no conversions; nothing to brag about.
        const showDelta = dPos !== null && data.prior.positive > 0 && data.positiveCount > 0;
        const trendingUp = (dPos ?? 0) >= 0;
        const lineColor = data.positiveCount > 0 && trendingUp ? C.green : data.positiveCount === 0 ? C.textDim : C.red;
        // Pivot the headline when there are 0 positives — focus on replies
        // (the next milestone), not on celebrating a zero with gold accents.
        const zeroState = data.positiveCount === 0;
        return (
          <div
            className="rounded-2xl border mb-4 overflow-hidden"
            style={{
              background: zeroState
                ? C.card
                : `
                  radial-gradient(ellipse 60% 100% at 0% 0%, color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent) 0%, transparent 55%),
                  linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${C.card} 96%, ${gold}) 100%)
                `,
              borderColor: C.border,
              boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
            }}
          >
            <div className="px-6 py-5 flex items-start justify-between gap-6 flex-wrap">
              {/* Left: headline + delta */}
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: zeroState ? C.textMuted : gold }}>
                  {zeroState ? "Replies received · this period" : "Positive replies · this period"}
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                  <span
                    className="text-5xl font-bold tabular-nums leading-none"
                    style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
                  >
                    {zeroState ? data.repliedCount : data.positiveCount}
                  </span>
                  {showDelta && (
                    <div
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 mb-1"
                      style={{
                        backgroundColor: trendingUp
                          ? `color-mix(in srgb, ${C.green} 14%, transparent)`
                          : `color-mix(in srgb, ${C.red} 14%, transparent)`,
                        color: trendingUp ? C.green : C.red,
                      }}
                    >
                      {trendingUp ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                      <span className="text-xs font-bold tabular-nums">{Math.abs(dPos!)}%</span>
                      <span className="text-[10px]" style={{ opacity: 0.85 }}>vs prior</span>
                    </div>
                  )}
                  {zeroState && data.repliedCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 mb-1 text-[10px] font-semibold"
                      style={{ backgroundColor: C.surface, color: C.textMuted, border: `1px solid ${C.border}` }}
                    >
                      0 positives yet
                    </span>
                  )}
                </div>
                <p className="text-[11px] mt-2" style={{ color: C.textMuted }}>
                  {data.contactedLeads} contacted
                  {!zeroState && <> · {data.repliedCount} replied</>}
                  {zeroState && data.repliedCount > 0 && <> · keep nurturing — first conversions usually land between steps 2 and 4</>}
                  {dRep !== null && (
                    <> · <span style={{ color: dRep >= 0 ? C.green : C.red, fontWeight: 600 }}>{dRep >= 0 ? "+" : ""}{dRep}%</span> replied vs prior</>
                  )}
                </p>
              </div>

              {/* Right: sparkline */}
              {sparkData.some(v => v > 0) && (
                <div className="flex flex-col items-end shrink-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color: C.textDim }}>
                    Last 8 weeks
                  </p>
                  <Sparkline data={sparkData} color={lineColor} width={120} height={36} />
                  <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>
                    {sparkData[sparkData.length - 1]} this week
                  </p>
                </div>
              )}
            </div>

            {/* Bottom: 3 sub-stats — supporting metrics under the headline.
                Each card has: icon + label, big number, contextual sub-line,
                a thin coloured progress meter so the eye can compare them at
                a glance instead of reading each digit. */}
            <div
              className="grid grid-cols-1 sm:grid-cols-3 border-t"
              style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${C.card} 96%, transparent)` }}
            >
              {/* Response rate */}
              <div className="px-5 py-4 border-r" style={{ borderColor: C.border }}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.blue} 14%, transparent)`, color: C.blue }}>
                      <MessageSquare size={11} />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>Response rate</p>
                  </div>
                  <p className="text-[10px] tabular-nums" style={{ color: C.textDim }}>{data.repliedCount}/{data.contactedLeads}</p>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {data.responseRate}
                  </p>
                  <p className="text-sm font-semibold" style={{ color: C.textMuted }}>%</p>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${C.blue} 12%, transparent)` }}>
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, data.responseRate)}%`, backgroundColor: C.blue }} />
                </div>
              </div>

              {/* Conversion rate */}
              <div className="px-5 py-4 border-r" style={{ borderColor: C.border }}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)`, color: C.green }}>
                      <TrendingUp size={11} />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>Conversion rate</p>
                  </div>
                  <p className="text-[10px] tabular-nums" style={{ color: C.textDim }}>{data.positiveCount}/{data.contactedLeads}</p>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {data.conversionRate}
                  </p>
                  <p className="text-sm font-semibold" style={{ color: C.textMuted }}>%</p>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)` }}>
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, data.conversionRate)}%`, backgroundColor: C.green }} />
                </div>
              </div>

              {/* Avg steps */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
                      <Zap size={11} />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>Avg steps to convert</p>
                  </div>
                  <p className="text-[10px]" style={{ color: C.textDim }}>{data.avgSteps > 0 ? "lower is better" : ""}</p>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: data.avgSteps > 0 ? C.textPrimary : C.textDim, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {data.avgSteps > 0 ? data.avgSteps : "—"}
                  </p>
                  {data.avgSteps > 0 && <p className="text-sm font-semibold" style={{ color: C.textMuted }}>steps</p>}
                </div>
                <p className="text-[10px] mt-2.5" style={{ color: C.textDim }}>
                  {data.avgSteps > 0 ? "across leads that converted" : "no conversions yet in this window"}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Insight strips removed — they duplicated the bento below ("Where to
          focus" was already saying the same thing). One narrative summary is
          enough; the bento is the more actionable form. */}

      {/* ═══ BENTO — What's working / Where to focus / Pipeline ═══
          Three vertical cards that compress the page's main narrative beats.
          Same data the detailed sections show below, but answered up-front
          so the seller doesn't have to interpret 4 tables to know "am I
          winning, where am I losing, what's my forecast." */}
      {(() => {
        const zeroConvCampaigns = data.campaignComparison.filter(c => c.leads >= 5 && c.conversionRate === 0);
        const lowConvCampaigns = data.campaignComparison.filter(c => c.leads >= 5 && c.conversionRate > 0 && c.conversionRate < 5).slice(0, 3);
        const underperformingChannel = data.channelAnalysis.length > 0 ? data.channelAnalysis[data.channelAnalysis.length - 1] : null;
        const bestChMeta = data.bestChannel ? channelMeta[data.bestChannel.channel] : null;
        const worstChMeta = underperformingChannel ? channelMeta[underperformingChannel.channel] : null;
        // Only celebrate "What's working" when there's actual signal. A
        // top-seller card that brags about 0 positives is worse than no card.
        const hasWins =
          (data.topSeller?.positive ?? 0) > 0 ||
          (data.bestCampaign?.positive ?? 0) > 0 ||
          (data.bestChannel?.positive ?? 0) > 0;
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            {/* ── What's working ── */}
            <div
              className="rounded-2xl border p-4"
              style={{
                backgroundColor: hasWins
                  ? `color-mix(in srgb, ${C.green} 4%, ${C.card})`
                  : C.card,
                borderColor: hasWins
                  ? `color-mix(in srgb, ${C.green} 25%, ${C.border})`
                  : C.border,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: hasWins ? `color-mix(in srgb, ${C.green} 16%, transparent)` : C.surface, color: hasWins ? C.green : C.textMuted }}>
                  <Trophy size={13} />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: hasWins ? C.green : C.textMuted }}>What&apos;s working</p>
              </div>
              {hasWins ? (
                <div className="space-y-2.5">
                  {data.topSeller && data.topSeller.positive > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>Top seller</p>
                        <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{data.topSeller.name}</p>
                      </div>
                      <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: C.green }}>{data.topSeller.positive} pos</span>
                    </div>
                  )}
                  {data.bestCampaign && data.bestCampaign.positive > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: C.border }}>
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>Top campaign</p>
                        <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{data.bestCampaign.name}</p>
                      </div>
                      <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: C.green }}>{data.bestCampaign.conversionRate}%</span>
                    </div>
                  )}
                  {data.bestChannel && bestChMeta && data.bestChannel.responseRate > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: C.border }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <bestChMeta.icon size={13} style={{ color: bestChMeta.color }} />
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>Top channel</p>
                          <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{bestChMeta.label}</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: C.green }}>{data.bestChannel.responseRate}%</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-3 text-center">
                  <p className="text-xs" style={{ color: C.textDim }}>No standout wins yet.</p>
                  {data.repliedCount > 0 && (
                    <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                      You have {data.repliedCount} repl{data.repliedCount === 1 ? "y" : "ies"} — classify them in the inbox to surface winners.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Where to focus ── */}
            <div
              className="rounded-2xl border p-4"
              style={{
                backgroundColor: `color-mix(in srgb, #D97706 4%, ${C.card})`,
                borderColor: `color-mix(in srgb, #D97706 25%, ${C.border})`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, #D97706 16%, transparent)`, color: "#D97706" }}>
                  <AlertTriangle size={13} />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "#D97706" }}>Where to focus</p>
              </div>
              <div className="space-y-2.5">
                {zeroConvCampaigns.length > 0 ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>0% conversion · review or pause</p>
                    <ul className="mt-1 space-y-1">
                      {zeroConvCampaigns.slice(0, 3).map(c => (
                        <li key={c.name} className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{c.name}</span>
                          <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{c.leads} leads</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : lowConvCampaigns.length > 0 ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>Below 5% conversion</p>
                    <ul className="mt-1 space-y-1">
                      {lowConvCampaigns.map(c => (
                        <li key={c.name} className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{c.name}</span>
                          <span className="text-[10px] tabular-nums shrink-0" style={{ color: "#D97706" }}>{c.conversionRate}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {underperformingChannel && data.channelAnalysis.length >= 2 && worstChMeta ? (
                  <div className={zeroConvCampaigns.length > 0 || lowConvCampaigns.length > 0 ? "pt-2 border-t" : ""} style={{ borderColor: C.border }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <worstChMeta.icon size={13} style={{ color: worstChMeta.color }} />
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>Weakest channel</p>
                          <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{worstChMeta.label}</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: "#D97706" }}>{underperformingChannel.responseRate}%</span>
                    </div>
                  </div>
                ) : null}
                {zeroConvCampaigns.length === 0 && lowConvCampaigns.length === 0 && !underperformingChannel && (
                  <p className="text-xs italic" style={{ color: C.textDim }}>Nothing flagged. Either you&apos;re crushing it or there&apos;s not enough data yet.</p>
                )}
              </div>
            </div>

            {/* ── Pipeline forecast ── */}
            <div
              className="rounded-2xl border p-4"
              style={{
                backgroundColor: `color-mix(in srgb, ${C.blue} 4%, ${C.card})`,
                borderColor: `color-mix(in srgb, ${C.blue} 25%, ${C.border})`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.blue} 16%, transparent)`, color: C.blue }}>
                  <Sparkles size={13} />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: C.blue }}>Pipeline forecast</p>
              </div>
              <div className="space-y-2.5">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>By velocity</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold tabular-nums" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{data.forecastMonthly}</span>
                    <span className="text-[10px]" style={{ color: C.textMuted }}>positives / month</span>
                  </div>
                  <p className="text-[10px]" style={{ color: C.textDim }}>{data.dailyRate.toFixed(1)}/day × 30d</p>
                </div>
                <div className="pt-2 border-t" style={{ borderColor: C.border }}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>By active pipeline</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold tabular-nums" style={{ color: C.green, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{data.forecastFromPipeline}</span>
                    <span className="text-[10px]" style={{ color: C.textMuted }}>expected</span>
                  </div>
                  <p className="text-[10px]" style={{ color: C.textDim }}>{data.activeLeadCount} active × {data.conversionRate}% conv</p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ CAMPAIGN COMPARISON TABLE ═══ */}
      <div className="mb-4">
      <CollapsibleCard
        title="Campaign Comparison"
        description="Performance breakdown by campaign"
        storageKey="reports.campaignComparison"
        rightSlot={data.campaignComparison.length > 0 ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
            {data.campaignComparison.length} campaigns
          </span>
        ) : null}
      >
        {data.campaignComparison.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm" style={{ color: C.textDim }}>No campaigns yet</p>
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: C.bg, boxShadow: `0 1px 0 ${C.border}` }}>
              <tr>
                <th className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Campaign</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Channels</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Leads</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Replied</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Positive</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Response %</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Conversion %</th>
              </tr>
            </thead>
            <tbody>
              {data.campaignComparison.map((c) => (
                <tr key={c.name} className="border-t transition-colors hover:bg-black/[0.02]" style={{ borderColor: C.border }}>
                  <td className="px-5 py-3">
                    <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{c.name}</p>
                    <p className="text-[10px]" style={{ color: C.textDim }}>{c.totalSteps} steps</p>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {c.channels.map(ch => {
                        const meta = channelMeta[ch] ?? channelMeta.email;
                        const Icon = meta.icon;
                        return <Icon key={ch} size={12} style={{ color: meta.color }} />;
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center text-xs font-semibold tabular-nums" style={{ color: C.textBody }}>{c.leads}</td>
                  <td className="px-3 py-3 text-center text-xs font-semibold tabular-nums" style={{ color: C.blue }}>{c.replied}</td>
                  <td className="px-3 py-3 text-center text-xs font-semibold tabular-nums" style={{ color: C.green }}>{c.positive}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-14 h-2 rounded-full" style={{ backgroundColor: C.border }}>
                        <div className="h-2 rounded-full" style={{ width: `${c.responseRate}%`, backgroundColor: C.blue }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: C.blue }}>{c.responseRate}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-14 h-2 rounded-full" style={{ backgroundColor: C.border }}>
                        <div className="h-2 rounded-full" style={{ width: `${c.conversionRate}%`, backgroundColor: C.green }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: C.green }}>{c.conversionRate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </CollapsibleCard>
      </div>

      {/* ═══ TWO COLUMNS: ICP Performance + Channel Analysis ═══ */}
      {/* items-start: prevent grid row from stretching every cell to match the
          tallest one — when one card collapses, the open neighbour shouldn't
          pull a huge empty box next to it. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4 items-start">
        {/* ICP Profile Performance */}
        <CollapsibleCard
          title="ICP Profile Performance"
          titleSuffix={<TermTooltip iconOnly definition="ICP = Ideal Customer Profile. The buyer segment a campaign targets (industry + role + geography + headcount). Defined in Lead Miner™." />}
          description="Which profiles generate the best results"
          storageKey="reports.icpPerformance"
          rightSlot={data.profilePerformance.length > 0 ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
              {data.profilePerformance.length} ICPs
            </span>
          ) : null}
        >
          {data.profilePerformance.length === 0 ? (
            <div className="px-5 py-8 text-center"><p className="text-sm" style={{ color: C.textDim }}>No data yet</p></div>
          ) : (
            <div className="p-5 space-y-4 max-h-[480px] overflow-y-auto">
              {data.profilePerformance.map(p => {
                const respRate = p.contacted > 0 ? Math.round((p.replied / p.contacted) * 100) : 0;
                const convRate = p.contacted > 0 ? Math.round((p.positive / p.contacted) * 100) : 0;
                return (
                  <div key={p.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{p.name}</span>
                      <span className="text-[10px]" style={{ color: C.textMuted }}>{p.leads} leads</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: C.blue }}>Response</span>
                          <span className="text-[10px] font-bold" style={{ color: C.blue }}>{respRate}%</span>
                        </div>
                        <div className="h-2 rounded-full" style={{ backgroundColor: C.border }}>
                          <div className="h-2 rounded-full" style={{ width: `${respRate}%`, backgroundColor: C.blue }} />
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: C.green }}>Conversion</span>
                          <span className="text-[10px] font-bold" style={{ color: C.green }}>{convRate}%</span>
                        </div>
                        <div className="h-2 rounded-full" style={{ backgroundColor: C.border }}>
                          <div className="h-2 rounded-full" style={{ width: `${convRate}%`, backgroundColor: C.green }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleCard>

        {/* Channel Analysis */}
        <CollapsibleCard
          title="Channel Analysis"
          description="Performance by outreach channel"
          storageKey="reports.channelAnalysis"
          rightSlot={data.channelAnalysis.length > 0 ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
              {data.channelAnalysis.length} channels
            </span>
          ) : null}
        >
          {data.channelAnalysis.length === 0 ? (
            <div className="px-5 py-8 text-center"><p className="text-sm" style={{ color: C.textDim }}>No data yet</p></div>
          ) : (
            <div className="p-5 space-y-5">
              {data.channelAnalysis.map(ch => {
                const meta = channelMeta[ch.channel] ?? channelMeta.email;
                const Icon = meta.icon;
                return (
                  <div key={ch.channel}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${meta.color}12` }}>
                        <Icon size={15} style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1">
                        <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{meta.label}</span>
                        <p className="text-[10px]" style={{ color: C.textMuted }}>{ch.contacted} contacted · {ch.replied} replied · {ch.positive} positive</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: C.textDim }}>Response</span>
                          <span className="text-[10px] font-bold" style={{ color: meta.color }}>{ch.responseRate}%</span>
                        </div>
                        <div className="h-2.5 rounded-full" style={{ backgroundColor: C.border }}>
                          <div className="h-2.5 rounded-full" style={{ width: `${ch.responseRate}%`, backgroundColor: meta.color }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: C.textDim }}>Conversion</span>
                          <span className="text-[10px] font-bold" style={{ color: C.green }}>{ch.conversionRate}%</span>
                        </div>
                        <div className="h-2.5 rounded-full" style={{ backgroundColor: C.border }}>
                          <div className="h-2.5 rounded-full" style={{ width: `${ch.conversionRate}%`, backgroundColor: C.green }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleCard>
      </div>

      {/* Reply Classification + Weekly Trend sections removed in the 2026-05-17
          redesign. The classification mix is implicit in the channel analysis
          above (replied / positive split per channel); the trend chart was
          superseded by the KPI sparklines on the Live tab. Cutting them
          collapsed Reports from 7 sections to 5 with no information loss. */}

      {/* ═══ SELLER LEADERBOARD (full width) ═══
          Forecast was moved into the bento above, so this row stops being
          a 2:1 grid with a duplicate Forecast card on the right and reclaims
          its full width. Avoids the awkward dead-space the right column
          showed when both halves disagreed in height. */}
      <div className="mb-5">
        <CollapsibleCard
          title="Seller Leaderboard"
          description="Ranked by positive replies — ties broken by response rate"
          icon={<Trophy size={14} style={{ color: gold }} />}
          storageKey="reports.sellerLeaderboard"
          rightSlot={data.sellerPerformance.length > 1 ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
              {data.sellerPerformance.length} sellers
            </span>
          ) : null}
        >
          {data.sellerPerformance.length === 0 ? (
            <div className="px-5 py-10 text-center"><p className="text-sm" style={{ color: C.textDim }}>No seller data yet</p></div>
          ) : (() => {
            // Leader = max positive count; gap shown as bar width relative to leader.
            const leader = Math.max(...data.sellerPerformance.map(s => s.positive), 1);
            return (
              <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 z-10" style={{ backgroundColor: C.bg, boxShadow: `0 1px 0 ${C.border}` }}>
                  <tr>
                    <th className="pl-5 pr-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider w-10" style={{ color: C.textMuted }}>#</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Seller</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Active</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Replied</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Conv %</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider pr-5" style={{ color: C.textMuted }}>Won (gap to #1)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sellerPerformance.map((s, i) => {
                    const isLeader = i === 0;
                    const gapPct = leader > 0 ? Math.round((s.positive / leader) * 100) : 0;
                    const initials = s.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <tr
                        key={s.name}
                        className="border-t transition-colors hover:bg-black/[0.02]"
                        style={{
                          borderColor: C.border,
                          background: isLeader ? `linear-gradient(90deg, color-mix(in srgb, ${gold} 6%, transparent), transparent 60%)` : undefined,
                        }}
                      >
                        <td className="pl-5 pr-2 py-3 align-middle">
                          <span
                            className="inline-flex items-center justify-center rounded-md text-[11px] font-bold tabular-nums"
                            style={{
                              width: 24, height: 24,
                              backgroundColor: isLeader ? `color-mix(in srgb, ${gold} 16%, transparent)` : C.bg,
                              color: isLeader ? gold : C.textMuted,
                              border: `1px solid ${isLeader ? `color-mix(in srgb, ${gold} 30%, transparent)` : C.border}`,
                            }}
                          >
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{s.name}</span>
                                {isLeader && <Trophy size={10} style={{ color: gold }} />}
                              </div>
                              <p className="text-[10px]" style={{ color: C.textDim }}>{s.contacted} contacted</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-xs font-semibold tabular-nums" style={{ color: C.green }}>{s.active}</td>
                        <td className="px-3 py-3 text-center text-xs font-semibold tabular-nums" style={{ color: C.blue }}>{s.replied}</td>
                        <td className="px-3 py-3 text-center text-xs font-bold tabular-nums" style={{ color: C.green }}>{s.conversionRate}%</td>
                        <td className="px-3 py-3 pr-5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: C.border, minWidth: 60 }}>
                              <div className="h-2 rounded-full" style={{
                                width: `${gapPct}%`,
                                backgroundColor: isLeader ? gold : C.green,
                              }} />
                            </div>
                            <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: isLeader ? gold : C.textBody, minWidth: 24, textAlign: "right" }}>
                              {s.positive}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            );
          })()}
        </CollapsibleCard>
      </div>

      {/* ═══ FORECAST + RESPONSE BY STEP ═══
          50/50 grid pairing two complementary lower-level views: where the
          pipeline is heading (Forecast) and which step in the sequence is
          carrying the response volume. The bento above shows the headline
          forecast numbers; this card adds the "tip" interpretation + active
          pipeline context that doesn't fit in a small bento tile. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4 items-start">
        <CollapsibleCard
          title="Forecast detail"
          description="End-of-month projection with context"
          icon={<TrendingUp size={14} style={{ color: gold }} />}
          storageKey="reports.forecastDetail"
        >
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 5%, transparent)` }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: C.textDim }}>Based on velocity</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{data.forecastMonthly}</span>
                  <span className="text-[10px]" style={{ color: C.textMuted }}>positives</span>
                </div>
                <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                  {data.dailyRate.toFixed(1)}/day × 30d
                </p>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${C.green} 5%, transparent)` }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: C.textDim }}>Based on pipeline</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: C.green, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{data.forecastFromPipeline}</span>
                  <span className="text-[10px]" style={{ color: C.textMuted }}>expected</span>
                </div>
                <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                  {data.activeLeadCount} active × {data.conversionRate}% conv
                </p>
              </div>
            </div>
            <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)`, border: `1px solid color-mix(in srgb, ${gold} 22%, ${C.border})` }}>
              <p className="text-[11px]" style={{ color: C.textBody }}>
                <b style={{ color: gold }}>Reading the two numbers:</b> if velocity and pipeline don&apos;t match, you&apos;re either short on leads (velocity &gt; pipeline) or your conversion has dropped (pipeline &gt; velocity).
              </p>
            </div>
          </div>
        </CollapsibleCard>

        {Object.keys(data.stepReplies).length > 0 ? (
          <CollapsibleCard
            title="Response by Sequence Step"
            description="Which step in the sequence carries the response volume"
            storageKey="reports.responseByStep"
            defaultOpen
          >
            <div className="p-5 flex items-end gap-4 justify-around" style={{ minHeight: 160 }}>
              {Object.entries(data.stepReplies)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([step, { total, replied }]) => {
                  const rate = total > 0 ? Math.round((replied / total) * 100) : 0;
                  return (
                    <div key={step} className="flex flex-col items-center gap-2">
                      <span className="text-xs font-bold tabular-nums" style={{ color: rate > 0 ? gold : C.textDim }}>{rate}%</span>
                      <div className="w-10 rounded-t" style={{ height: Math.max(rate * 1.0, 4), backgroundColor: gold }} />
                      <div>
                        <p className="text-xs font-semibold text-center" style={{ color: C.textPrimary }}>Step {Number(step) + 1}</p>
                        <p className="text-[9px] text-center" style={{ color: C.textDim }}>{replied}/{total}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CollapsibleCard>
        ) : (
          <div className="rounded-2xl border p-6 flex items-center justify-center" style={{ borderColor: C.border, backgroundColor: C.card, minHeight: 220 }}>
            <p className="text-xs text-center" style={{ color: C.textDim }}>
              No step-level reply data yet — once your sequences send a few rounds, the per-step response rates will land here.
            </p>
          </div>
        )}
      </div>

      {/* ═══ SWL Consulting footer signature ═══
          Same identity treatment as the login marketing slab (logo + tagline
          + © line). Reports get screenshotted and shared with clients, so
          the consulting brand belongs in the footer too. */}
      <div className="mt-8 pt-5 border-t flex items-center justify-between gap-4 flex-wrap"
        style={{ borderColor: C.border }}>
        <div className="flex items-center gap-3">
          <img
            src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
            alt="SWL Consulting"
            className="h-6 w-auto object-contain opacity-70"
          />
          <div>
            <p className="text-[11px] font-bold" style={{ color: C.textBody, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              Human ideas. AI-powered systems.
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>
              © {new Date().getFullYear()} SWL Consulting · swlconsulting.com
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-semibold" style={{ color: gold }}>
          <span className="w-1 h-1 rounded-full pulse-dot" style={{ backgroundColor: gold }} />
          <span>Powered by GrowthAI™</span>
        </div>
      </div>
    </div>
  );
}
