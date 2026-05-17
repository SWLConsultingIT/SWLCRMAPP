import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { C } from "@/lib/design";
import {
  TrendingUp, MessageSquare, Target, Zap,
  Share2, Mail, Phone, Trophy,
} from "lucide-react";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/KpiCard";

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
    bioId ? sellersQ.eq("company_bio_id", bioId) : sellersQ,
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

  return {
    totalLeads, contactedLeads, repliedCount, positiveCount,
    responseRate, conversionRate, avgSteps,
    bestCampaign, bestChannel, topSeller,
    campaignComparison, profilePerformance, channelAnalysis, sellerPerformance,
    replyBreakdown, stepReplies, weeklyReplies,
    forecastMonthly, forecastFromPipeline, dailyRate, activeLeadCount,
  };
}

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
    <div className="p-6">
      <PageHero
        icon={TrendingUp}
        section="Operations"
        title="Reports"
        description="Full performance breakdown across campaigns, channels, and sellers."
        accentColor={C.blue}
      />

      {/* ═══ KPI CARDS ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <KpiCard label="Response Rate"   value={`${data.responseRate}%`}                          icon={MessageSquare} tone="info"     sub={`${data.repliedCount}/${data.contactedLeads} replied`} />
        <KpiCard label="Conversion Rate" value={`${data.conversionRate}%`}                        icon={TrendingUp}    tone="positive" sub={`${data.positiveCount} positive of ${data.contactedLeads}`} />
        <KpiCard label="Avg Steps to Convert" value={data.avgSteps > 0 ? data.avgSteps : "—"}     icon={Zap}           tone="brand"    sub={data.avgSteps > 0 ? "steps until positive reply" : "no conversions yet"} />
        <KpiCard label="Best Campaign"   value={data.bestCampaign ? `${data.bestCampaign.conversionRate}%` : "—"} icon={Trophy} tone="neutral" sub={data.bestCampaign?.name ?? "no data"} />
        <KpiCard label="Best Channel"    value={data.bestChannel ? `${data.bestChannel.responseRate}%` : "—"}     icon={Target} tone="neutral" sub={data.bestChannel?.channel ?? "no data"} />
      </div>

      {/* ═══ CAMPAIGN COMPARISON TABLE ═══ */}
      <div className="rounded-2xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Campaign Comparison</h2>
          <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Performance breakdown by campaign</p>
        </div>
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
      </div>

      {/* ═══ TWO COLUMNS: ICP Performance + Channel Analysis ═══ */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* ICP Profile Performance */}
        <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>ICP Profile Performance</h2>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Which profiles generate the best results</p>
          </div>
          {data.profilePerformance.length === 0 ? (
            <div className="px-5 py-8 text-center"><p className="text-sm" style={{ color: C.textDim }}>No data yet</p></div>
          ) : (
            <div className="p-5 space-y-4">
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
        </div>

        {/* Channel Analysis */}
        <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Channel Analysis</h2>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Performance by outreach channel</p>
          </div>
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
        </div>
      </div>

      {/* Reply Classification + Weekly Trend sections removed in the 2026-05-17
          redesign. The classification mix is implicit in the channel analysis
          above (replied / positive split per channel); the trend chart was
          superseded by the KPI sparklines on the Live tab. Cutting them
          collapsed Reports from 7 sections to 5 with no information loss. */}

      {/* ═══ SELLER LEADERBOARD + FORECAST ═══ */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Seller Leaderboard (2 cols) — rank + avatar + gap-to-#1 bar */}
        <div className="col-span-2 rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: C.textPrimary }}>
                <Trophy size={14} style={{ color: gold }} />
                Seller Leaderboard
              </h2>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Ranked by positive replies — ties broken by response rate</p>
            </div>
            {data.sellerPerformance.length > 1 && (
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                {data.sellerPerformance.length} sellers
              </span>
            )}
          </div>
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
        </div>

        {/* Forecast */}
        <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `3px solid ${gold}`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-2">
              <TrendingUp size={14} style={{ color: gold }} />
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Forecast</h2>
            </div>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>End-of-month projection</p>
          </div>
          <div className="p-5 space-y-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: C.textDim }}>Based on velocity</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums" style={{ color: gold }}>{data.forecastMonthly}</span>
                <span className="text-xs" style={{ color: C.textMuted }}>positive / month</span>
              </div>
              <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                {data.dailyRate.toFixed(1)} positives/day × 30d
              </p>
            </div>

            <div className="h-px" style={{ backgroundColor: C.border }} />

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: C.textDim }}>Based on pipeline</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums" style={{ color: C.green }}>{data.forecastFromPipeline}</span>
                <span className="text-xs" style={{ color: C.textMuted }}>expected</span>
              </div>
              <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                {data.activeLeadCount} active × {data.conversionRate}% conv
              </p>
            </div>

            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
              <p className="text-[10px] font-medium" style={{ color: C.textMuted }}>
                <b style={{ color: C.textBody }}>Tip:</b> if velocity and pipeline don&apos;t match, you&apos;re either short on leads or your conversion has dropped
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ RESPONSE BY STEP NUMBER ═══ */}
      {Object.keys(data.stepReplies).length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Response by Sequence Step</h2>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Which step in the sequence generates the most replies</p>
          </div>
          <div className="p-5 flex items-end gap-6 justify-center" style={{ minHeight: 120 }}>
            {Object.entries(data.stepReplies)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([step, { total, replied }]) => {
                const rate = total > 0 ? Math.round((replied / total) * 100) : 0;
                return (
                  <div key={step} className="flex flex-col items-center gap-2">
                    <span className="text-xs font-bold tabular-nums" style={{ color: rate > 0 ? gold : C.textDim }}>{rate}%</span>
                    <div className="w-12 rounded-t" style={{ height: Math.max(rate * 0.8, 4), backgroundColor: gold }} />
                    <div>
                      <p className="text-xs font-semibold text-center" style={{ color: C.textPrimary }}>Step {Number(step) + 1}</p>
                      <p className="text-[9px] text-center" style={{ color: C.textDim }}>{replied}/{total}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
