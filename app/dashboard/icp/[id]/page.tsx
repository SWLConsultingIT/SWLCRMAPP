// ICP drill-down — deep analytical view of a single ideal-customer profile.
// Surfaces the profile definition (industries, roles, pain points) alongside
// performance metrics, comparison to the tenant average, channel mix, reply
// classification, when this ICP replies, and per-step performance.
//
// Design rules: same visual language as the main dashboard (Panel,
// SectionHeader, KpiCard, Donut, Funnel, Heatmap, InlineSpark, status pills).
// Density-first. i18n-aware via lib/i18n-server.

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft, Target, Users, Send, MessageSquare, ThumbsUp, Activity, Clock,
  Share2, Mail, Phone, Smartphone, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getDashboardData } from "@/lib/dashboard-data";
import { getT, getServerLocale } from "@/lib/i18n-server";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/dashboard/KpiCard";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import Funnel from "@/components/dashboard/Funnel";
import Donut from "@/components/dashboard/Donut";
import Heatmap from "@/components/dashboard/Heatmap";
import InlineSpark from "@/components/dashboard/InlineSpark";
import StepPerformance from "@/components/dashboard/StepPerformance";
import SwlSignature from "@/components/dashboard/SwlSignature";

const gold = "var(--brand, #c9a83a)";
const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);

const channelMeta: Record<string, { Icon: React.ElementType; color: string }> = {
  linkedin: { Icon: Share2,     color: "#0A66C2" },
  email:    { Icon: Mail,       color: "#059669" },
  call:     { Icon: Phone,      color: "#EA580C" },
  whatsapp: { Icon: Smartphone, color: "#25D366" },
};

type IcpRow = {
  id: string;
  profile_name: string;
  target_industries: string[] | null;
  target_roles: string[] | null;
  pain_points: string[] | null;
  solutions_offered: string[] | null;
  company_bio_id: string | null;
};
type LeadRow = {
  id: string;
  status: string | null;
  lead_score: number | null;
  company_name: string | null;
  primary_first_name: string | null;
  primary_last_name: string | null;
  primary_title_role: string | null;
  created_at: string | null;
};
type CampRow = { id: string; name: string; status: string | null; channel: string | null; lead_id: string | null; current_step: number | null; sequence_steps: unknown; seller_id: string | null };
type ReplyRow = { id: string; lead_id: string | null; campaign_id: string | null; classification: string | null; channel: string | null; received_at: string | null };
type MsgRow = { id: string; status: string | null; sent_at: string | null; campaign_id: string | null; step_number: number | null };

async function loadIcpDetail(icpId: string) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const profileQ = supabase.from("icp_profiles")
    .select("id, profile_name, target_industries, target_roles, pain_points, solutions_offered, company_bio_id")
    .eq("id", icpId);
  const { data: prof } = bioId
    ? await profileQ.eq("company_bio_id", bioId).maybeSingle()
    : await profileQ.maybeSingle();
  if (!prof) return null;
  const profile = prof as IcpRow;

  const { data: leadsRaw } = await supabase.from("leads")
    .select("id, status, lead_score, company_name, primary_first_name, primary_last_name, primary_title_role, created_at")
    .eq("icp_profile_id", icpId)
    .order("lead_score", { ascending: false });
  const leads = (leadsRaw ?? []) as LeadRow[];
  const leadIds = leads.map(l => l.id);

  const [{ data: campsRaw }, { data: repliesRaw }, { data: msgsRaw }, { data: sellersRaw }] = await Promise.all([
    leadIds.length > 0
      ? supabase.from("campaigns").select("id, name, status, channel, lead_id, current_step, sequence_steps, seller_id").in("lead_id", leadIds)
      : Promise.resolve({ data: [] }),
    leadIds.length > 0
      ? supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at").in("lead_id", leadIds)
      : Promise.resolve({ data: [] }),
    leadIds.length > 0
      ? supabase.from("campaign_messages").select("id, status, sent_at, campaign_id, step_number, campaigns!inner(lead_id)").eq("status", "sent").in("campaigns.lead_id", leadIds)
      : Promise.resolve({ data: [] }),
    supabase.from("sellers").select("id, name"),
  ]);
  const camps = (campsRaw ?? []) as CampRow[];
  const replies = (repliesRaw ?? []) as ReplyRow[];
  const msgs = (msgsRaw ?? []) as MsgRow[];
  const sellerMap = new Map<string, string>();
  for (const s of ((sellersRaw ?? []) as { id: string; name: string }[])) sellerMap.set(s.id, s.name);

  const contactedSet = new Set(camps.map(c => c.lead_id).filter(Boolean) as string[]);
  const repliedSet = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveSet = new Set(replies.filter(r => POSITIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]);
  const wonSet = new Set(leads.filter(l => l.status === "closed_won").map(l => l.id));
  const connectedSet = new Set<string>();
  for (const m of msgs) {
    if ((m.step_number ?? 0) >= 1 && m.campaign_id) {
      const c = camps.find(x => x.id === m.campaign_id);
      if (c?.lead_id) connectedSet.add(c.lead_id);
    }
  }
  for (const c of camps) if ((c.current_step ?? 0) >= 1 && c.lead_id) connectedSet.add(c.lead_id);

  // ─── Channel mix for this ICP ─────────────────────────────────────────
  type ChAgg = { sent: number; contacted: Set<string>; replied: Set<string>; positive: Set<string> };
  const chMap = new Map<string, ChAgg>();
  const ensureCh = (k: string): ChAgg => {
    let g = chMap.get(k);
    if (!g) { g = { sent: 0, contacted: new Set(), replied: new Set(), positive: new Set() }; chMap.set(k, g); }
    return g;
  };
  for (const c of camps) {
    const ch = c.channel ?? "linkedin";
    const g = ensureCh(ch);
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
    ensureCh(c.channel ?? "linkedin").sent++;
  }
  const channelBreakdown = Array.from(chMap.entries()).map(([channel, g]) => ({
    channel,
    sent: g.sent,
    contacted: g.contacted.size,
    replied: g.replied.size,
    positive: g.positive.size,
    responseRate: g.contacted.size > 0 ? Math.round((g.replied.size / g.contacted.size) * 100) : 0,
    conversionRate: g.contacted.size > 0 ? Math.round((g.positive.size / g.contacted.size) * 100) : 0,
  })).sort((a, b) => b.responseRate - a.responseRate);

  // ─── Per-campaign breakdown ──────────────────────────────────────────
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
  })).sort((a, b) => b.conversionRate - a.conversionRate || b.leads - a.leads);

  // ─── 30-day trends + reply classification ────────────────────────────
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
  const classCounts: Record<string, number> = {};
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const r of replies) {
    const cls = r.classification ?? "unclassified";
    classCounts[cls] = (classCounts[cls] ?? 0) + 1;
    if (r.received_at) {
      const idx = 29 - dayBucket(r.received_at);
      if (idx >= 0 && idx < 30) {
        trendReplies[idx]++;
        if (POSITIVE_CLASS.has(cls)) trendPositive[idx]++;
      }
      const d = new Date(r.received_at);
      heatmap[d.getDay()][d.getHours()]++;
    }
  }

  // ─── Time-to-first-reply (median minutes) ────────────────────────────
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

  // ─── Step performance for this ICP ───────────────────────────────────
  const stepAgg = new Map<number, { sent: number; replied: number }>();
  const ensureStep = (n: number) => {
    let g = stepAgg.get(n);
    if (!g) { g = { sent: 0, replied: 0 }; stepAgg.set(n, g); }
    return g;
  };
  for (const m of msgs) ensureStep(m.step_number ?? 0).sent++;
  const sentByCamp = new Map<string, MsgRow[]>();
  for (const m of msgs) {
    if (!m.campaign_id || !m.sent_at) continue;
    const list = sentByCamp.get(m.campaign_id) ?? [];
    list.push(m); sentByCamp.set(m.campaign_id, list);
  }
  for (const [, list] of sentByCamp) list.sort((a, b) => (a.sent_at && b.sent_at ? new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime() : 0));
  for (const r of replies) {
    if (!r.campaign_id || !r.received_at) continue;
    const list = sentByCamp.get(r.campaign_id);
    if (!list) continue;
    const rT = new Date(r.received_at).getTime();
    let step: number | null = null;
    for (const m of list) {
      if (!m.sent_at) continue;
      if (new Date(m.sent_at).getTime() <= rT) step = m.step_number ?? 0;
      else break;
    }
    if (step !== null) ensureStep(step).replied++;
  }
  const stepPerformance = Array.from(stepAgg.entries()).map(([step, g]) => ({
    step,
    sent: g.sent,
    replied: g.replied,
    replyRate: g.sent >= 5 ? Math.round((g.replied / g.sent) * 100) : null,
  })).sort((a, b) => a.step - b.step);

  // ─── Top leads ──────────────────────────────────────────────────────
  const topLeads = leads.slice(0, 12).map(l => ({
    id: l.id,
    name: `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "—",
    title: l.primary_title_role,
    company: l.company_name,
    score: l.lead_score ?? 0,
    status: l.status,
    replied: repliedSet.has(l.id),
    positive: positiveSet.has(l.id),
  }));

  const total = leads.length;
  const contacted = contactedSet.size;
  const connected = connectedSet.size;
  const replied = repliedSet.size;
  const positive = positiveSet.size;
  const won = wonSet.size;

  return {
    profile,
    funnel: { total, contacted, connected, replied, positive, won },
    rates: {
      acceptance: contacted > 0 ? Math.round((connected / contacted) * 100) : 0,
      response: contacted > 0 ? Math.round((replied / contacted) * 100) : 0,
      conversion: contacted > 0 ? Math.round((positive / contacted) * 100) : 0,
      positiveOfReplies: replied > 0 ? Math.round((positive / replied) * 100) : 0,
    },
    channelBreakdown,
    campaignBreakdown,
    trend30d: { sent: trendSent, replies: trendReplies, positive: trendPositive },
    classCounts,
    heatmap,
    medianTTR,
    stepPerformance,
    topLeads,
    sellerMap,
  };
}

export default async function IcpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) redirect("/onboarding");

  const { id } = await params;
  const [d, tenantData, t, locale] = await Promise.all([
    loadIcpDetail(id),
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
        <p className="mt-4 text-sm" style={{ color: C.textBody }}>{t("dashx.detail.icpNotFound")}</p>
      </div>
    );
  }

  // ─── Reply classification → donut ─────────────────────────────────────
  const classColors: Record<string, string> = {
    positive: "#16A34A", meeting_intent: "#059669", negative: "#DC2626", not_now: "#F59E0B",
    unsubscribe: "#9CA3AF", needs_info: "#7C3AED", question: "#0A66C2", nurturing: "#6B7280",
    spam: "#374151", auto_reply: "#94A3B8", unclassified: "#9CA3AF",
  };
  const donutSlices = Object.entries(d.classCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      label: t(`dashx.reply.${k}`) === `dashx.reply.${k}` ? k : t(`dashx.reply.${k}`),
      value: v,
      color: classColors[k] ?? "#9CA3AF",
    }))
    .sort((a, b) => b.value - a.value);

  // ─── Comparison vs tenant average ────────────────────────────────────
  const tenantConv = tenantData.headline.conversionRate;
  const lift = tenantConv > 0 ? Math.round(((d.rates.conversion / tenantConv) - 1) * 100) : null;
  const liftKind = lift === null ? "neutral" : lift >= 25 ? "great" : lift >= 5 ? "good" : lift <= -25 ? "bad" : lift <= -5 ? "soft" : "neutral";

  const heroStat = (label: string, value: string, hint?: string) => (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{label}</span>
      <span className="text-[22px] font-semibold tabular-nums leading-tight" style={{ color: C.textPrimary }}>{value}</span>
      {hint && <span className="text-[10.5px]" style={{ color: C.textDim }}>{hint}</span>}
    </div>
  );

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs hover:underline transition-opacity hover:opacity-70" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> {t("dashx.detail.back")}
      </Link>

      <PageHero
        icon={Target}
        section={t("dashx.detail.icp.section")}
        title={d.profile.profile_name}
        description={[
          (d.profile.target_industries ?? []).slice(0, 3).join(", "),
          (d.profile.target_roles ?? []).slice(0, 2).join(", "),
        ].filter(Boolean).join(" · ") || t("dashx.detail.icp.noDef")}
        accentColor={gold}
      />

      {/* ─── Hero stat band — 4 key numbers at a glance ─────────────────── */}
      <section className="rounded-2xl border overflow-hidden relative" style={{ borderColor: C.border, backgroundColor: C.card, boxShadow: `inset 0 2px 0 0 color-mix(in srgb, ${gold} 35%, transparent)` }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: C.border }}>
          <div className="px-5 py-4">{heroStat(t("dashx.detail.icp.heroLeads"), d.funnel.total.toLocaleString(dateLoc), t("dashx.detail.icp.heroLeadsHint", { n: d.funnel.contacted }))}</div>
          <div className="px-5 py-4">{heroStat(t("dashx.detail.icp.heroReply"), `${d.rates.response}%`, t("dashx.detail.icp.heroReplyHint", { n: d.funnel.replied }))}</div>
          <div className="px-5 py-4">{heroStat(t("dashx.detail.icp.heroPos"), `${d.funnel.positive}`, t("dashx.detail.icp.heroPosHint", { n: d.rates.positiveOfReplies }))}</div>
          <div className="px-5 py-4">
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{t("dashx.detail.icp.heroVsAvg")}</span>
              <span className="text-[22px] font-semibold tabular-nums leading-tight inline-flex items-center gap-1.5"
                style={{ color: liftKind === "great" || liftKind === "good" ? C.green : liftKind === "bad" || liftKind === "soft" ? C.red : C.textPrimary }}>
                {lift === null ? "—" : `${lift > 0 ? "+" : ""}${lift}%`}
                <LiftIcon kind={liftKind} />
              </span>
              <span className="text-[10.5px]" style={{ color: C.textDim }}>
                {tenantConv > 0 ? t("dashx.detail.icp.heroVsAvgHint", { tenant: tenantConv, icp: d.rates.conversion }) : t("dashx.detail.icp.heroVsAvgNoData")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── ICP profile definition — what they targeted ──────────────── */}
      <section className="rounded-2xl border" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <header className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
          <Target size={12} style={{ color: gold }} />
          <h2 className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{t("dashx.detail.icp.profile.title")}</h2>
          <span className="text-[11px]" style={{ color: C.textMuted }}>· {t("dashx.detail.icp.profile.subtitle")}</span>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 divide-y md:divide-y-0 md:divide-x" style={{ borderColor: C.border }}>
          <ProfileChips label={t("dashx.detail.icp.profile.industries")} items={d.profile.target_industries} fallback={t("dashx.detail.icp.profile.empty")} />
          <ProfileChips label={t("dashx.detail.icp.profile.roles")} items={d.profile.target_roles} fallback={t("dashx.detail.icp.profile.empty")} />
          <ProfileChips label={t("dashx.detail.icp.profile.pains")} items={d.profile.pain_points} fallback={t("dashx.detail.icp.profile.empty")} tone="warning" />
          <ProfileChips label={t("dashx.detail.icp.profile.solutions")} items={d.profile.solutions_offered} fallback={t("dashx.detail.icp.profile.empty")} tone="success" />
        </div>
      </section>

      {/* ─── KPIs detallados ─────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label={t("dashx.detail.icp.kpi.contacted")} value={d.funnel.contacted.toLocaleString(dateLoc)} icon={Send} accent="#0A66C2" trend={d.trend30d.sent} />
          <KpiCard label={t("dashx.detail.icp.kpi.accept")} value={`${d.rates.acceptance}%`} icon={Activity} accent="#0A66C2" hint={t("dashx.detail.icp.kpi.acceptHint", { n: d.funnel.connected })} />
          <KpiCard label={t("dashx.detail.icp.kpi.replies")} value={d.funnel.replied.toLocaleString(dateLoc)} icon={MessageSquare} accent="#7C3AED" trend={d.trend30d.replies} hint={t("dashx.detail.icp.kpi.repliesHint", { n: d.rates.response })} />
          <KpiCard label={t("dashx.detail.icp.kpi.positives")} value={d.funnel.positive.toLocaleString(dateLoc)} icon={ThumbsUp} accent={C.green} trend={d.trend30d.positive} hint={t("dashx.detail.icp.kpi.positivesHint", { n: d.rates.positiveOfReplies })} />
          <KpiCard label={t("dashx.detail.icp.kpi.conversion")} value={`${d.rates.conversion}%`} icon={Target} accent="#F59E0B" hint={t("dashx.detail.icp.kpi.conversionHint")} />
          <KpiCard label={t("dashx.detail.icp.kpi.ttfr")} value={d.medianTTR === null ? "—" : formatMinutes(d.medianTTR)} icon={Clock} accent="#6B7280" hint={t("dashx.detail.icp.kpi.ttfrHint")} />
        </div>
      </section>

      {/* ─── Funnel + Donut ─────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Panel title={t("dashx.detail.icp.funnel.title")} subtitle={t("dashx.detail.icp.funnel.subtitle")} className="lg:col-span-7">
          <Funnel stages={[
            { stage: t("dashx.funnel.stage.imported"),  count: d.funnel.total,     color: "neutral" },
            { stage: t("dashx.funnel.stage.contacted"), count: d.funnel.contacted, color: "info" },
            { stage: t("dashx.funnel.stage.accepted"),  count: d.funnel.connected, color: "info" },
            { stage: t("dashx.funnel.stage.replied"),   count: d.funnel.replied,   color: "warning" },
            { stage: t("dashx.funnel.stage.positive"),  count: d.funnel.positive,  color: "success" },
            { stage: t("dashx.funnel.stage.won"),       count: d.funnel.won,       color: "brand" },
          ]} />
        </Panel>
        <Panel title={t("dashx.detail.icp.donut.title")} subtitle={t("dashx.detail.icp.donut.subtitle")} className="lg:col-span-5">
          {donutSlices.length > 0 ? (
            <Donut data={donutSlices} centerLabel={t("dashx.donut.centerReplies")} emptyLabel={t("dashx.donut.empty")} />
          ) : (
            <div className="py-10 text-center text-[12px]" style={{ color: C.textMuted }}>{t("dashx.detail.icp.donut.empty")}</div>
          )}
        </Panel>
      </section>

      {/* ─── 30d trend + Heatmap ────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Panel title={t("dashx.trend.title")} subtitle={t("dashx.detail.icp.trend.subtitle")} className="lg:col-span-7">
          <MultiLineChart
            todayLabel={t("dashx.trend.today")}
            recentLabel={t("dashx.trend.daysAgo")}
            series={[
              { name: t("dashx.trend.sent"),      color: "#0A66C2", data: d.trend30d.sent },
              { name: t("dashx.trend.replies"),   color: "#7C3AED", data: d.trend30d.replies },
              { name: t("dashx.trend.positives"), color: C.green,   data: d.trend30d.positive },
            ]}
          />
        </Panel>
        <Panel title={t("dashx.detail.icp.heat.title")} subtitle={t("dashx.detail.icp.heat.subtitle")} className="lg:col-span-5">
          <Heatmap
            matrix={d.heatmap}
            days={["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(dy => t(`dashx.day.${dy}`))}
            unitLabel={t("dashx.heat.unitReplies")}
            legendMin={t("dashx.heat.legendMin")}
            legendMax={t("dashx.heat.legendMax")}
          />
        </Panel>
      </section>

      {/* ─── Channel mix for this ICP ─────────────────────────────── */}
      <section>
        <SectionHeader icon={Send} title={t("dashx.detail.icp.channels.title")} subtitle={t("dashx.detail.icp.channels.subtitle")} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {d.channelBreakdown.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-xs" style={{ borderColor: C.border, color: C.textMuted }}>
              {t("dashx.detail.icp.channels.empty")}
            </div>
          ) : d.channelBreakdown.map((ch, idx) => {
            const meta = channelMeta[ch.channel] ?? { Icon: Send, color: C.textMuted };
            const Icon = meta.Icon;
            const isTop = idx === 0 && d.channelBreakdown.length > 1;
            return (
              <div key={ch.channel} className="rounded-xl border p-3.5"
                style={{ borderColor: C.border, backgroundColor: C.card, borderLeft: `3px solid ${meta.color}` }}>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                      <Icon size={13} />
                    </span>
                    <span className="text-sm font-bold capitalize" style={{ color: C.textPrimary }}>{t(`dashx.ch.${ch.channel}`) || ch.channel}</span>
                    {isTop && <span className="w-1.5 h-1.5 rounded-full" style={{ background: gold, boxShadow: `0 0 0 2px color-mix(in srgb, ${gold} 18%, transparent)` }} aria-label="Top" />}
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

      {/* ─── Step performance for this ICP ────────────────────────── */}
      <section>
        <SectionHeader icon={Activity} title={t("dashx.detail.icp.step.title")} subtitle={t("dashx.detail.icp.step.subtitle")} />
        <Panel>
          <StepPerformance steps={d.stepPerformance} locale={locale} />
        </Panel>
      </section>

      {/* ─── Campaigns running against this ICP ───────────────────── */}
      {d.campaignBreakdown.length > 0 && (
        <section>
          <SectionHeader icon={Send} title={t("dashx.detail.icp.camp.title")} subtitle={t("dashx.detail.icp.camp.subtitle")} />
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
                {d.campaignBreakdown.map((c, idx) => (
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
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{c.leads.toLocaleString(dateLoc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{c.sent.toLocaleString(dateLoc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{c.replied}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: c.positive > 0 ? C.green : C.textMuted }}>{c.positive}</td>
                    <td className="px-3 py-2 text-right">
                      <RateCell value={c.conversionRate} color={C.green} />
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={c.status} t={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      )}

      {/* ─── Top leads ──────────────────────────────────────────── */}
      <section>
        <SectionHeader icon={Users} title={t("dashx.detail.icp.leads.title")} subtitle={t("dashx.detail.icp.leads.subtitle")} />
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">{t("dashx.detail.icp.leads.col.lead")}</Th>
                <Th align="left">{t("dashx.detail.icp.leads.col.company")}</Th>
                <Th align="right">{t("dashx.detail.icp.leads.col.score")}</Th>
                <Th align="left">{t("dashx.detail.icp.leads.col.engagement")}</Th>
              </tr>
            </thead>
            <tbody>
              {d.topLeads.map(l => (
                <tr key={l.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                  <td className="px-3 py-2">
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{l.name}</Link>
                    {l.title && <p className="text-[10.5px] mt-0.5" style={{ color: C.textDim }}>{l.title}</p>}
                  </td>
                  <td className="px-3 py-2" style={{ color: C.textMuted }}>{l.company ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{l.score}</td>
                  <td className="px-3 py-2">
                    {l.positive ? <Pill color={C.green}>{t("dashx.reply.positive")}</Pill> :
                     l.replied ? <Pill color="#7C3AED">{t("dashx.detail.icp.leads.replied")}</Pill> :
                     <Pill color={C.textMuted}>{t("dashx.detail.icp.leads.silent")}</Pill>}
                  </td>
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

function MicroStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{label}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function ProfileChips({ label, items, fallback, tone = "neutral" }: { label: string; items: string[] | null; fallback: string; tone?: "neutral" | "warning" | "success" }) {
  const accent = tone === "warning" ? "#D97706" : tone === "success" ? C.green : C.textMuted;
  const has = items && items.length > 0;
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-2" style={{ color: C.textMuted }}>{label}</p>
      {has ? (
        <div className="flex flex-wrap gap-1">
          {items!.slice(0, 8).map((it, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border tabular-nums truncate max-w-[200px]"
              style={{ borderColor: C.border, color: C.textBody, background: `color-mix(in srgb, ${accent} 6%, transparent)` }}
              title={it}>
              {it}
            </span>
          ))}
          {items!.length > 8 && (
            <span className="text-[10px]" style={{ color: C.textDim }}>+{items!.length - 8}</span>
          )}
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: C.textDim }}>{fallback}</p>
      )}
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

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      {children}
    </span>
  );
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

void InlineSpark; // reserved for future use in the leads table
