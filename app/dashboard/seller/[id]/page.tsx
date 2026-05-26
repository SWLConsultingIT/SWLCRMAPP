// Seller drill-down — analytical view of one rep's performance. Surfaces
// what they're sending, the replies they're generating, ICP mix they work,
// when in the day they send vs receive replies, and how they compare to the
// team average. Same visual language as the main dashboard.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft, User, Send, MessageSquare, ThumbsUp, Megaphone, Clock, Activity,
  TrendingUp, TrendingDown, Minus, Share2, Mail, Phone, Smartphone, Target,
} from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getDashboardData } from "@/lib/dashboard-data";
import { getT, getServerLocale } from "@/lib/i18n-server";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/dashboard/KpiCard";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import Heatmap from "@/components/dashboard/Heatmap";
import Donut from "@/components/dashboard/Donut";
import SwlSignature from "@/components/dashboard/SwlSignature";

const gold = "var(--brand, #c9a83a)";
const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);

const channelMeta: Record<string, { Icon: React.ElementType; color: string }> = {
  linkedin: { Icon: Share2,     color: "#0A66C2" },
  email:    { Icon: Mail,       color: "#059669" },
  call:     { Icon: Phone,      color: "#EA580C" },
  whatsapp: { Icon: Smartphone, color: "#25D366" },
};

type SellerRow = { id: string; name: string; active: boolean | null; company_bio_id: string | null; shared_with_company_bio_ids: string[] | null };
type CampRow = { id: string; name: string; status: string | null; channel: string | null; current_step: number | null; lead_id: string | null; created_at: string | null; leads: { id: string; icp_profile_id: string | null; company_bio_id: string } | { id: string; icp_profile_id: string | null; company_bio_id: string }[] };
type MsgRow = { id: string; campaign_id: string | null; status: string | null; sent_at: string | null; step_number: number | null };
type ReplyRow = { id: string; lead_id: string | null; campaign_id: string | null; classification: string | null; received_at: string | null };

async function loadSellerDetail(sellerId: string) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const sQ = supabase.from("sellers").select("id, name, active, company_bio_id, shared_with_company_bio_ids").eq("id", sellerId);
  const { data: sellerRaw } = bioId
    ? await sQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`).maybeSingle()
    : await sQ.maybeSingle();
  if (!sellerRaw) return null;
  const seller = sellerRaw as SellerRow;

  const campsQ = supabase.from("campaigns")
    .select("id, name, status, channel, current_step, lead_id, created_at, leads!inner(id, icp_profile_id, company_bio_id)")
    .eq("seller_id", sellerId);
  const { data: campsRaw } = bioId
    ? await campsQ.eq("leads.company_bio_id", bioId)
    : await campsQ;
  const camps = (campsRaw ?? []) as CampRow[];
  const leadFor = (c: CampRow) => Array.isArray(c.leads) ? c.leads[0] : c.leads;

  const campIds = camps.map(c => c.id);
  const leadIds = camps.map(c => c.lead_id).filter(Boolean) as string[];
  const icpIds = Array.from(new Set(camps.map(c => leadFor(c)?.icp_profile_id).filter(Boolean) as string[]));

  const [{ data: msgsRaw }, { data: repliesRaw }, { data: icpsRaw }] = await Promise.all([
    campIds.length > 0
      ? supabase.from("campaign_messages").select("id, campaign_id, status, sent_at, step_number").in("campaign_id", campIds).eq("status", "sent")
      : Promise.resolve({ data: [] }),
    // Scope replies by CAMPAIGN, not by lead. Filtering by lead_id over-counts
    // when a lead has been worked by multiple sellers across different
    // campaigns — replies from another seller's campaign on the same lead
    // would leak into this seller's numbers. campaign_id is the right axis
    // because each campaign has exactly one seller_id.
    campIds.length > 0
      ? supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, received_at").in("campaign_id", campIds)
      : Promise.resolve({ data: [] }),
    icpIds.length > 0
      ? supabase.from("icp_profiles").select("id, profile_name").in("id", icpIds)
      : Promise.resolve({ data: [] }),
  ]);
  const msgs = (msgsRaw ?? []) as MsgRow[];
  const replies = (repliesRaw ?? []) as ReplyRow[];
  const icpMap = new Map<string, string>();
  for (const i of ((icpsRaw ?? []) as { id: string; profile_name: string }[])) icpMap.set(i.id, i.profile_name);

  const contactedSet = new Set(leadIds);
  const repliedSet = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveSet = new Set(replies.filter(r => POSITIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]);

  // ─── ICP mix this seller works ───────────────────────────────────────
  type IcpAgg = { id: string; name: string; leads: Set<string>; replied: Set<string>; positive: Set<string> };
  const icpAgg = new Map<string, IcpAgg>();
  for (const c of camps) {
    const icpId = leadFor(c)?.icp_profile_id ?? "_unknown";
    let g = icpAgg.get(icpId);
    if (!g) { g = { id: icpId, name: icpMap.get(icpId) ?? "Sin ICP", leads: new Set(), replied: new Set(), positive: new Set() }; icpAgg.set(icpId, g); }
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  const icpMix = Array.from(icpAgg.values()).map(g => ({
    id: g.id,
    name: g.name,
    leads: g.leads.size,
    replied: g.replied.size,
    positive: g.positive.size,
    responseRate: g.leads.size > 0 ? Math.round((g.replied.size / g.leads.size) * 100) : 0,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive || b.leads - a.leads);

  // ─── Channel mix ─────────────────────────────────────────────────────
  type ChAgg = { sent: number; contacted: Set<string>; replied: Set<string>; positive: Set<string> };
  const chMap = new Map<string, ChAgg>();
  for (const c of camps) {
    const ch = c.channel ?? "linkedin";
    let g = chMap.get(ch);
    if (!g) { g = { sent: 0, contacted: new Set(), replied: new Set(), positive: new Set() }; chMap.set(ch, g); }
    if (c.lead_id) {
      g.contacted.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  for (const m of msgs) {
    if (!m.campaign_id) continue;
    const c = camps.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const g = chMap.get(c.channel ?? "linkedin");
    if (g) g.sent++;
  }
  const channelMix = Array.from(chMap.entries()).map(([channel, g]) => ({
    channel,
    sent: g.sent,
    contacted: g.contacted.size,
    replied: g.replied.size,
    positive: g.positive.size,
    responseRate: g.contacted.size > 0 ? Math.round((g.replied.size / g.contacted.size) * 100) : 0,
  })).sort((a, b) => b.sent - a.sent);

  // ─── Campaign breakdown ─────────────────────────────────────────────
  type CampAgg = { name: string; leads: Set<string>; replied: Set<string>; positive: Set<string>; sent: number; status: string; channels: Set<string> };
  const byCampaign = new Map<string, CampAgg>();
  for (const c of camps) {
    let g = byCampaign.get(c.name);
    if (!g) { g = { name: c.name, leads: new Set(), replied: new Set(), positive: new Set(), sent: 0, status: c.status ?? "active", channels: new Set() }; byCampaign.set(c.name, g); }
    g.channels.add(c.channel ?? "linkedin");
    if (c.status === "active") g.status = "active";
    else if (c.status === "paused" && g.status !== "active") g.status = "paused";
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  for (const m of msgs) {
    if (!m.campaign_id) continue;
    const c = camps.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const g = byCampaign.get(c.name);
    if (g) g.sent++;
  }
  const campaignBreakdown = Array.from(byCampaign.values()).map(g => ({
    name: g.name,
    status: g.status,
    channels: Array.from(g.channels),
    leads: g.leads.size,
    sent: g.sent,
    replied: g.replied.size,
    positive: g.positive.size,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive || b.leads - a.leads);

  // ─── 30d trend ───────────────────────────────────────────────────────
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const dayBucket = (iso: string) => Math.floor((today.getTime() - new Date(iso).getTime()) / 86_400_000);
  const trendSent = new Array(30).fill(0) as number[];
  const trendReplies = new Array(30).fill(0) as number[];
  const trendPositive = new Array(30).fill(0) as number[];
  for (const m of msgs) {
    if (!m.sent_at) continue;
    const idx = 29 - dayBucket(m.sent_at);
    if (idx >= 0 && idx < 30) trendSent[idx]++;
  }
  for (const r of replies) {
    if (!r.received_at) continue;
    const idx = 29 - dayBucket(r.received_at);
    if (idx >= 0 && idx < 30) {
      trendReplies[idx]++;
      if (POSITIVE_CLASS.has(r.classification ?? "")) trendPositive[idx]++;
    }
  }

  // ─── Send timing heatmap (when this seller sends) ───────────────────
  // Different from the main dashboard heatmap (which shows when replies
  // arrive). Surfaces working pattern of the rep — useful for coaching.
  const sendHeatmap = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const m of msgs) {
    if (!m.sent_at) continue;
    const d = new Date(m.sent_at);
    sendHeatmap[d.getDay()][d.getHours()]++;
  }
  const replyHeatmap = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const r of replies) {
    if (!r.received_at) continue;
    const d = new Date(r.received_at);
    replyHeatmap[d.getDay()][d.getHours()]++;
  }

  // ─── Time-to-first-reply ─────────────────────────────────────────
  const firstMsgAt = new Map<string, number>();
  for (const m of msgs) {
    if (!m.sent_at || !m.campaign_id) continue;
    const c = camps.find(x => x.id === m.campaign_id);
    if (!c?.lead_id) continue;
    const t = new Date(m.sent_at).getTime();
    const prev = firstMsgAt.get(c.lead_id);
    if (prev === undefined || t < prev) firstMsgAt.set(c.lead_id, t);
  }
  const firstReplyAt = new Map<string, number>();
  for (const r of replies) {
    if (!r.lead_id || !r.received_at) continue;
    const t = new Date(r.received_at).getTime();
    const prev = firstReplyAt.get(r.lead_id);
    if (prev === undefined || t < prev) firstReplyAt.set(r.lead_id, t);
  }
  const ttrSamples: number[] = [];
  for (const [leadId, mT] of firstMsgAt) {
    const rT = firstReplyAt.get(leadId);
    if (rT && rT > mT) ttrSamples.push(Math.round((rT - mT) / 60_000));
  }
  ttrSamples.sort((a, b) => a - b);
  const medianTTR = ttrSamples.length > 0 ? ttrSamples[Math.floor(ttrSamples.length / 2)] : null;

  return {
    seller,
    totalSent: msgs.length,
    totalContacted: contactedSet.size,
    activeCampaigns: camps.filter(c => c.status === "active").length,
    completedCampaigns: camps.filter(c => c.status === "completed").length,
    pausedCampaigns: camps.filter(c => c.status === "paused").length,
    repliedCount: repliedSet.size,
    positiveCount: positiveSet.size,
    responseRate: contactedSet.size > 0 ? Math.round((repliedSet.size / contactedSet.size) * 100) : 0,
    conversionRate: contactedSet.size > 0 ? Math.round((positiveSet.size / contactedSet.size) * 100) : 0,
    medianTTR,
    icpMix,
    channelMix,
    campaignBreakdown,
    trend30d: { sent: trendSent, replies: trendReplies, positive: trendPositive },
    sendHeatmap,
    replyHeatmap,
  };
}

export default async function SellerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) redirect("/onboarding");

  const { id } = await params;
  const [d, tenant, t, locale] = await Promise.all([
    loadSellerDetail(id),
    getDashboardData({ from: null, to: null }),
    getT(),
    getServerLocale(),
  ]);
  const dateLoc = locale === "es" ? "es-AR" : "en-US";

  if (!d) {
    return (
      <div className="p-6">
        <Link href="/" className="text-xs hover:underline" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} className="inline mr-1" /> {t("dashx.detail.back")}
        </Link>
        <p className="mt-4 text-sm" style={{ color: C.textBody }}>{t("dashx.detail.seller.notFound")}</p>
      </div>
    );
  }

  // Comparison vs team average
  const teamResp = tenant.headline.responseRate;
  const lift = teamResp > 0 ? Math.round(((d.responseRate / teamResp) - 1) * 100) : null;
  const liftKind = lift === null ? "neutral" : lift >= 20 ? "great" : lift >= 5 ? "good" : lift <= -20 ? "bad" : lift <= -5 ? "soft" : "neutral";

  // ─── Avatar (initials) ──────────────────────────────────────────
  const initials = d.seller.name.split(" ").slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs hover:underline transition-opacity hover:opacity-70" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> {t("dashx.detail.back")}
      </Link>

      {/* Custom header with avatar + status */}
      <header className="rounded-2xl border p-5 flex items-start gap-4" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-[18px] font-bold shrink-0"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#04070d" }}>
          {initials || <User size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[20px] font-semibold tracking-tight" style={{ color: C.textPrimary }}>{d.seller.name}</h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ background: d.seller.active ? `color-mix(in srgb, ${C.green} 14%, transparent)` : `color-mix(in srgb, ${C.textMuted} 14%, transparent)`,
                       color: d.seller.active ? C.green : C.textMuted }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.seller.active ? C.green : C.textMuted }} />
              {d.seller.active ? t("dashx.detail.seller.active") : t("dashx.detail.seller.inactive")}
            </span>
          </div>
          <p className="text-[12px] mt-1" style={{ color: C.textMuted }}>
            {t("dashx.detail.seller.summary", {
              active: d.activeCampaigns,
              contacted: d.totalContacted,
              sent: d.totalSent,
            })}
          </p>
        </div>
      </header>

      {/* ─── Hero stat band: 4 numbers including vs-team lift ─────── */}
      <section className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card, boxShadow: `inset 0 2px 0 0 color-mix(in srgb, ${gold} 35%, transparent)` }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: C.border }}>
          <HeroStat label={t("dashx.detail.seller.hero.contacted")} value={d.totalContacted.toLocaleString(dateLoc)} hint={t("dashx.detail.seller.hero.contactedHint", { n: d.totalSent })} />
          <HeroStat label={t("dashx.detail.seller.hero.replyRate")} value={`${d.responseRate}%`} hint={t("dashx.detail.seller.hero.replyRateHint", { n: d.repliedCount })} />
          <HeroStat label={t("dashx.detail.seller.hero.positives")} value={d.positiveCount.toLocaleString(dateLoc)} hint={t("dashx.detail.seller.hero.positivesHint", { n: d.conversionRate })} />
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{t("dashx.detail.seller.hero.vsTeam")}</p>
            <p className="text-[22px] font-semibold tabular-nums leading-tight mt-0.5 inline-flex items-center gap-1.5"
              style={{ color: liftKind === "great" || liftKind === "good" ? C.green : liftKind === "bad" || liftKind === "soft" ? C.red : C.textPrimary }}>
              {lift === null ? "—" : `${lift > 0 ? "+" : ""}${lift}%`}
              <LiftIcon kind={liftKind} />
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: C.textDim }}>
              {teamResp > 0 ? t("dashx.detail.seller.hero.vsTeamHint", { team: teamResp, seller: d.responseRate }) : t("dashx.detail.seller.hero.vsTeamNoData")}
            </p>
          </div>
        </div>
      </section>

      {/* ─── KPI band ───────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label={t("dashx.detail.seller.kpi.sent")} value={d.totalSent.toLocaleString(dateLoc)} icon={Send} accent="#0A66C2" trend={d.trend30d.sent} />
          <KpiCard label={t("dashx.detail.seller.kpi.contacted")} value={d.totalContacted.toLocaleString(dateLoc)} icon={User} accent={gold} />
          <KpiCard label={t("dashx.detail.seller.kpi.replies")} value={d.repliedCount.toLocaleString(dateLoc)} icon={MessageSquare} accent="#7C3AED" trend={d.trend30d.replies} hint={t("dashx.detail.seller.kpi.repliesHint", { n: d.responseRate })} />
          <KpiCard label={t("dashx.detail.seller.kpi.positives")} value={d.positiveCount.toLocaleString(dateLoc)} icon={ThumbsUp} accent={C.green} trend={d.trend30d.positive} hint={t("dashx.detail.seller.kpi.positivesHint", { n: d.conversionRate })} />
          <KpiCard label={t("dashx.detail.seller.kpi.ttfr")} value={d.medianTTR === null ? "—" : formatMinutes(d.medianTTR)} icon={Clock} accent="#6B7280" hint={t("dashx.detail.seller.kpi.ttfrHint")} />
          <KpiCard label={t("dashx.detail.seller.kpi.campaigns")} value={d.activeCampaigns.toLocaleString(dateLoc)} icon={Megaphone} accent="#F59E0B" hint={t("dashx.detail.seller.kpi.campaignsHint", { paused: d.pausedCampaigns, completed: d.completedCampaigns })} />
        </div>
      </section>

      {/* ─── 30d activity ──────────────────────────────────────── */}
      <section>
        <SectionHeader icon={Activity} title={t("dashx.trend.title")} subtitle={t("dashx.detail.seller.trend.subtitle")} />
        <Panel>
          <MultiLineChart series={[
            { name: t("dashx.trend.sent"),      color: "#0A66C2", data: d.trend30d.sent },
            { name: t("dashx.trend.replies"),   color: "#7C3AED", data: d.trend30d.replies },
            { name: t("dashx.trend.positives"), color: C.green,    data: d.trend30d.positive },
          ]} />
        </Panel>
      </section>

      {/* ─── Send vs Reply timing heatmaps side-by-side ────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title={t("dashx.detail.seller.sendHeat.title")} subtitle={t("dashx.detail.seller.sendHeat.subtitle")}>
          <Heatmap matrix={d.sendHeatmap} />
        </Panel>
        <Panel title={t("dashx.detail.seller.replyHeat.title")} subtitle={t("dashx.detail.seller.replyHeat.subtitle")}>
          <Heatmap matrix={d.replyHeatmap} />
        </Panel>
      </section>

      {/* ─── ICP mix this seller works ─────────────────────────── */}
      {d.icpMix.length > 0 && (
        <section>
          <SectionHeader icon={Target} title={t("dashx.detail.seller.icp.title")} subtitle={t("dashx.detail.seller.icp.subtitle")} />
          <Panel>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <Th align="left">{t("dashx.tbl.col.icp")}</Th>
                  <Th align="right">{t("dashx.tbl.col.leads")}</Th>
                  <Th align="right">{t("dashx.tbl.col.replied")}</Th>
                  <Th align="right">{t("dashx.tbl.col.positive")}</Th>
                  <Th align="right">{t("dashx.tbl.col.respPct")}</Th>
                  <Th align="right">{t("dashx.tbl.col.convPct")}</Th>
                </tr>
              </thead>
              <tbody>
                {d.icpMix.map((i, idx) => (
                  <tr key={i.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <TopRankDot rank={idx} />
                        {i.id !== "_unknown" ? (
                          <Link href={`/dashboard/icp/${i.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{i.name}</Link>
                        ) : (
                          <span style={{ color: C.textMuted }}>{i.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{i.leads.toLocaleString(dateLoc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{i.replied}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: i.positive > 0 ? C.green : C.textMuted }}>{i.positive}</td>
                    <td className="px-3 py-2 text-right"><RateCell value={i.responseRate} color="#7C3AED" /></td>
                    <td className="px-3 py-2 text-right"><RateCell value={i.conversionRate} color={C.green} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      )}

      {/* ─── Channel mix this seller uses ──────────────────────── */}
      {d.channelMix.length > 0 && (
        <section>
          <SectionHeader icon={Send} title={t("dashx.detail.seller.channels.title")} subtitle={t("dashx.detail.seller.channels.subtitle")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {d.channelMix.map((ch, idx) => {
              const meta = channelMeta[ch.channel] ?? { Icon: Send, color: C.textMuted };
              const Icon = meta.Icon;
              const isTop = idx === 0 && d.channelMix.length > 1;
              return (
                <div key={ch.channel} className="rounded-xl border p-3.5"
                  style={{ borderColor: C.border, backgroundColor: C.card, borderLeft: `3px solid ${meta.color}` }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                        <Icon size={13} />
                      </span>
                      <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{t(`dashx.ch.${ch.channel}`) || ch.channel}</span>
                      {isTop && <span className="w-1.5 h-1.5 rounded-full" style={{ background: gold, boxShadow: `0 0 0 2px color-mix(in srgb, ${gold} 18%, transparent)` }} />}
                    </div>
                    <span className="text-[10px] tabular-nums font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}>
                      {ch.responseRate}% {t("dashx.channels.respShort")}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <MicroStat label={t("dashx.channels.sent")} value={ch.sent} />
                    <MicroStat label={t("dashx.channels.contacted")} value={ch.contacted} />
                    <MicroStat label={t("dashx.channels.replied")} value={ch.replied} />
                    <MicroStat label={t("dashx.channels.positive")} value={ch.positive} accent={C.green} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Campaigns this seller owns ─────────────────────────── */}
      <section>
        <SectionHeader icon={Megaphone} title={t("dashx.detail.seller.camp.title")} subtitle={t("dashx.detail.seller.camp.subtitle")} />
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">{t("dashx.tbl.col.campaign")}</Th>
                <Th align="left">{t("dashx.tbl.col.channels")}</Th>
                <Th align="right">{t("dashx.tbl.col.leads")}</Th>
                <Th align="right">{t("dashx.tbl.col.sent")}</Th>
                <Th align="right">{t("dashx.tbl.col.replied")}</Th>
                <Th align="right">{t("dashx.tbl.col.positive")}</Th>
                <Th align="right">{t("dashx.tbl.col.convPct")}</Th>
                <Th align="left">{t("dashx.tbl.col.status")}</Th>
              </tr>
            </thead>
            <tbody>
              {d.campaignBreakdown.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>{t("dashx.detail.seller.camp.empty")}</td></tr>
              ) : d.campaignBreakdown.map((c, idx) => (
                <tr key={c.name} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <TopRankDot rank={idx} />
                      <Link href={`/dashboard/campaign/${encodeURIComponent(c.name)}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{c.name}</Link>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {c.channels.map(ch => {
                        const M = channelMeta[ch]?.Icon ?? Send;
                        return <M key={ch} size={12} style={{ color: channelMeta[ch]?.color ?? C.textMuted }} />;
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{c.leads}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{c.sent}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{c.replied}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: c.positive > 0 ? C.green : C.textMuted }}>{c.positive}</td>
                  <td className="px-3 py-2 text-right"><RateCell value={c.conversionRate} color={C.green} /></td>
                  <td className="px-3 py-2"><StatusBadge status={c.status} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <SwlSignature caption={t("dashx.brand.captionDetail")} tagline={t("dashx.brand.tagline")} />
    </div>
  );
}

// ─── Local primitives ────────────────────────────────────────────────────

void Donut; // reserved for future "outcome split" donut on this page.

function Panel({ title, subtitle, children, className }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${className ?? ""}`} style={{ backgroundColor: C.card, borderColor: C.border }}>
      {(title || subtitle) && (
        <div className="px-4 py-2.5 border-b" style={{ borderColor: C.border }}>
          {title && <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{title}</p>}
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function SectionHeader({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }> }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span
        className="w-[3px] h-7 rounded-full shrink-0"
        style={{ background: `linear-gradient(to bottom, ${gold}, color-mix(in srgb, ${gold} 55%, transparent))` }}
        aria-hidden
      />
      {Icon && (
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
          <Icon size={13} />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="text-[14px] font-semibold leading-tight tracking-tight" style={{ color: C.textPrimary }}>{title}</h2>
        <p className="text-[11px] truncate mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>
      </div>
    </div>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align: "left" | "right" }) {
  return <th className={`px-3 py-2 font-semibold text-${align}`}>{children}</th>;
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-5 py-4 flex flex-col items-start gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{label}</span>
      <span className="text-[22px] font-semibold tabular-nums leading-tight" style={{ color: C.textPrimary }}>{value}</span>
      {hint && <span className="text-[10.5px]" style={{ color: C.textDim }}>{hint}</span>}
    </div>
  );
}

function MicroStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{label}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, { color: string; key: string }> = {
    active:    { color: C.green,   key: "dashx.tbl.status.active" },
    paused:    { color: "#D97706", key: "dashx.tbl.status.paused" },
    completed: { color: "#6B7280", key: "dashx.tbl.status.completed" },
  };
  const s = map[status] ?? { color: C.textMuted, key: "" };
  const label = s.key ? t(s.key) : status;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `color-mix(in srgb, ${s.color} 12%, transparent)`, color: s.color }}>
      {status === "active" && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />}
      {label}
    </span>
  );
}

function RateCell({ value, color }: { value: number; color: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded"
      style={{ backgroundColor: value > 0 ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent", color: value > 0 ? color : C.textMuted }}>
      {value}%
    </span>
  );
}

function TopRankDot({ rank }: { rank: number }) {
  if (rank !== 0) return <span className="inline-block w-1.5 shrink-0" />;
  return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: gold, boxShadow: `0 0 0 2px color-mix(in srgb, ${gold} 18%, transparent)` }} />;
}

function LiftIcon({ kind }: { kind: string }) {
  if (kind === "great" || kind === "good") return <TrendingUp size={14} />;
  if (kind === "bad" || kind === "soft") return <TrendingDown size={14} />;
  return <Minus size={14} />;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

void PageHero; // legacy import kept while header migrates fully to the custom one
