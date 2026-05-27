// Dashboard v2 — analytics-first, density-focused, drill-down enabled.
// Research-driven (Stripe/Linear/Vercel patterns, B2B sales dashboard
// frameworks): sticky filter bar, leading-vs-lagging KPI grouping, pipeline
// velocity card, funnel + heatmap + donut tight grid, trend chart, and
// performance tables with INLINE sparklines. One accent color (SWL gold) +
// neutrals + 3 semantic (red/green/blue) — Stripe-style restraint.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import {
  Users, Send, MessageSquare, ThumbsUp, Trophy, Megaphone, Target,
  TrendingUp, Sparkles, AlertTriangle, Lightbulb, ArrowRight, CheckCircle2,
  Share2, Mail, Phone, Smartphone, FileDown, Clock, ChevronsRight, Activity,
} from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import { getDashboardData } from "@/lib/dashboard-data";
import { getT, getServerLocale } from "@/lib/i18n-server";
import ReliabilityBanner from "@/components/ReliabilityBanner";
import PageHero from "@/components/PageHero";
import FiltersBar from "@/components/dashboard/FiltersBar";
import FreshnessChip from "@/components/dashboard/FreshnessChip";
import DashboardKeyboardShortcuts from "@/components/dashboard/DashboardKeyboardShortcuts";
import SwlSignature from "@/components/dashboard/SwlSignature";
import KpiCard from "@/components/dashboard/KpiCard";
import Funnel from "@/components/dashboard/Funnel";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import Donut from "@/components/dashboard/Donut";
import Heatmap from "@/components/dashboard/Heatmap";
import IcpChannelMatrix from "@/components/dashboard/IcpChannelMatrix";
import InlineSpark from "@/components/dashboard/InlineSpark";
import StepPerformance from "@/components/dashboard/StepPerformance";
import Chapter from "@/components/dashboard/Chapter";
import ChapterNav from "@/components/dashboard/ChapterNav";
import ChannelComparison from "@/components/dashboard/ChannelComparison";
import HeroStat from "@/components/dashboard/HeroStat";
import InsightPanel from "@/components/dashboard/InsightPanel";
import MicroKpi from "@/components/dashboard/MicroKpi";
import RateBar from "@/components/dashboard/RateBar";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; labelKey: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", labelKey: "dashx.ch.linkedin" },
  email:    { icon: Mail,          color: "#059669", labelKey: "dashx.ch.email" },
  call:     { icon: Phone,         color: "#EA580C", labelKey: "dashx.ch.call" },
  whatsapp: { icon: Smartphone,    color: "#25D366", labelKey: "dashx.ch.whatsapp" },
};

// Reply classification labels are locale-driven; the translation key is
// composed at render time from `dashx.reply.<class>`. Falls back to the raw
// key (which i18n returns when missing), so a new class added on the AI side
// shows up untranslated rather than crashing the dashboard.
//
// Palette is SWL-cohesive (gold for engagement-style replies that still
// need work, green for positive outcomes, red for hard nos, slate for
// neutral/automated). Replaced the prior rainbow (purple/orange/blue) that
// didn't speak to the brand.
const classColors: Record<string, string> = {
  positive:       "#c9a83a",   // SWL gold — the WIN tone, our brand's victory color
  meeting_intent: "#D4BA5C",   // gold lighter — strongest engagement
  negative:       "#DC2626",   // red — outcome
  not_now:        "#E08A1A",   // amber — not now
  unsubscribe:    "#B91C1C",   // red darker — hard out
  needs_info:     "#1F2A44",   // navy — open dialogue, needs more from us
  question:       "#3D5A8F",   // navy lighter — question / clarification
  nurturing:      "#94A3B8",   // slate — passive
  spam:           "#475569",   // dark slate — junk
  auto_reply:     "#94A3B8",   // slate — automated
  unclassified:   "#94A3B8",   // slate — unknown
};

/** Small callout strip placed above each leaderboard that surfaces the
 * single top performer (gold) and, when there's a meaningful gap, the
 * lagging one (red). Skipped entirely when there are <2 rows to compare. */
function LeaderCallout({
  topText, bottomText,
}: {
  topText?: string | null;
  bottomText?: string | null;
}) {
  if (!topText && !bottomText) return null;
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-3">
      {topText && (
        <div className="flex-1 flex items-start gap-2 px-3 py-2 rounded-lg"
          style={{ background: `color-mix(in srgb, ${gold} 9%, transparent)`, borderLeft: `2px solid ${gold}` }}>
          <Trophy size={12} style={{ color: gold }} className="mt-0.5 shrink-0" />
          <p className="text-[11.5px] leading-snug" style={{ color: C.textBody }}>{topText}</p>
        </div>
      )}
      {bottomText && (
        <div className="flex-1 flex items-start gap-2 px-3 py-2 rounded-lg"
          style={{ background: `color-mix(in srgb, ${C.red} 7%, transparent)`, borderLeft: `2px solid ${C.red}` }}>
          <AlertTriangle size={12} style={{ color: C.red }} className="mt-0.5 shrink-0" />
          <p className="text-[11.5px] leading-snug" style={{ color: C.textBody }}>{bottomText}</p>
        </div>
      )}
    </div>
  );
}

/** Appends the active period filter (from/to) to a drill-down URL so the
 * detail page inherits the same window the user was looking at on the
 * dashboard. Without this, clicking a row from "Last 7 days" landed on a
 * detail showing the full history — confusing context switch. */
function withFilters(base: string, filters: { from: string | null; to: string | null }): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

/** Maps the dashboard-data funnel stage labels to translation keys. Data
 * layer returns them in Spanish for legacy reasons; this resolves them to
 * locale-agnostic keys consumed by the dashx.funnel.stage.* dict entries. */
function stageKey(label: string): string {
  const map: Record<string, string> = {
    "Importados": "imported",
    "Contactados": "contacted",
    "Aceptaron": "accepted",
    "Respondieron": "replied",
    "Positivos": "positive",
    "Reunión": "meeting",
    "Ganados": "won",
  };
  return map[label] ?? "";
}

// Never cached — without this, clicking the period chips changes the URL
// but Next.js serves the cached server response and the page shows stale
// numbers. Memory: feedback_dashboard_no_cache — reliability surfaces and
// every detail page already follow this; the main dashboard was missing it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseFilters(sp: Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v ?? null;
  };
  const getList = (k: string) => {
    const v = get(k);
    return v ? v.split("|").filter(Boolean) : [];
  };
  return {
    from: get("from"),
    to: get("to"),
    campaignNames: getList("campaigns"),
    icpIds: getList("icps"),
    sellerIds: getList("sellers"),
    /** Tab selection for the campaign leaderboard. Default = "active" so
     * historical clutter doesn't bury the campaigns currently running. */
    campStatus: (get("camp_status") as "active" | "paused" | "completed" | "all" | null) ?? "active",
  };
}

async function loadFilterOptions(bioId: string | null) {
  const svc = getSupabaseService();
  const campsQ = bioId
    ? svc.from("campaigns").select("name, leads!inner(company_bio_id)").eq("leads.company_bio_id", bioId)
    : svc.from("campaigns").select("name");
  const sellersQ = bioId
    ? svc.from("sellers").select("id, name").or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`).order("name")
    : svc.from("sellers").select("id, name").order("name");
  const icpsQ = bioId
    ? svc.from("icp_profiles").select("id, profile_name").eq("company_bio_id", bioId).eq("status", "approved").order("profile_name")
    : svc.from("icp_profiles").select("id, profile_name").eq("status", "approved").order("profile_name");
  const [{ data: camps }, { data: sellers }, { data: icps }] = await Promise.all([campsQ, sellersQ, icpsQ]);
  const uniqueNames = Array.from(new Set((camps ?? []).map((c: any) => c.name).filter(Boolean))).sort();
  return {
    campaigns: uniqueNames.map(n => ({ id: n, label: n })),
    sellers: (sellers ?? []).map((s: any) => ({ id: s.id, label: s.name })),
    icps: (icps ?? []).map((p: any) => ({ id: p.id, label: p.profile_name })),
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) {
    redirect("/onboarding");
  }

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const bioId = scope.isScoped ? scope.companyBioId! : null;
  const [data, options, t, locale] = await Promise.all([
    getDashboardData(filters),
    loadFilterOptions(bioId),
    getT(),
    getServerLocale(),
  ]);
  const dateLoc = locale === "es" ? "es-AR" : "en-US";
  // Locale-bound bundles spread onto every KpiCard / Funnel so we don't
  // forget to pass them and have hardcoded Spanish leak through.
  const kpi18n = { vsPriorLabel: t("dashx.kpi.vsPrior"), noPriorLabel: t("dashx.kpi.noPrior") };
  const funnel18n = {
    fromPrevLabel: t("dashx.funnel.fromPrev"),
    priorLabel: t("dashx.funnel.priorLabel"),
    vsPriorLabel: t("dashx.funnel.vsPriorShort"),
  };

  const { headline, deltas, trend30d } = data;

  // Reply classification → donut data. Labels come from the locale dict so
  // the donut speaks the user's language; falls back to the raw class string
  // when the key is missing (resilient to AI-side schema drift).
  const donutSlices = Object.entries(data.replyClassCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      label: t(`dashx.reply.${k}`) === `dashx.reply.${k}` ? k : t(`dashx.reply.${k}`),
      value: v,
      color: classColors[k] ?? "#9CA3AF",
    }))
    .sort((a, b) => b.value - a.value);

  // Compact period label for the hero. Locale-aware date formatting matches
  // the user's chosen interface language.
  const periodLabel = filters.from && filters.to
    ? `${new Date(filters.from).toLocaleDateString(dateLoc, { day: "2-digit", month: "short" })} – ${new Date(filters.to).toLocaleDateString(dateLoc, { day: "2-digit", month: "short" })}`
    : t("dashx.period.last", { n: data.period.days });

  // True when any filter (campaign / icp / seller) is active beyond the default
  // period. Drives the "differentiated empty state" copy in tables — "no data"
  // vs "no matches with these filters" is a completely different user message.
  const hasFilters = (filters.campaignNames?.length ?? 0) > 0 || (filters.icpIds?.length ?? 0) > 0 || (filters.sellerIds?.length ?? 0) > 0;

  // Server timestamp for the "Updated · now" freshness indicator. Computed
  // here (not on client) so it reflects when the page was actually rendered;
  // the UI shows the human delta from this anchor.
  const renderedAt = new Date().toISOString();

  return (
    <div className="p-4 sm:p-6 w-full space-y-4">
      <ReliabilityBanner />
      <DashboardKeyboardShortcuts />

      <PageHero
        icon={TrendingUp}
        section={t("dashx.hero.section")}
        title={t("dashx.hero.title")}
        description={t("dashx.hero.desc")}
        accentColor={gold}
        status={{ label: periodLabel, active: true }}
        action={(
          <div className="flex items-center gap-2">
            <FreshnessChip renderedAt={renderedAt} />
            <Link
              href="/reports"
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-85 whitespace-nowrap"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`, color: "#04070d", boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 28%, transparent)` }}
            >
              <FileDown size={13} /> {t("dashx.hero.download")}
            </Link>
          </div>
        )}
      />

      {/* ─── Sticky filters strip ───────────────────────────────────────────
          Wrapped in Suspense because FiltersBar reads useSearchParams() —
          App Router requires the boundary on any client component using
          search-params hooks. Without it the page bails to the 500. */}
      <Suspense fallback={<div className="h-10" />}>
        <FiltersBar options={options} />
      </Suspense>

      {/* Sticky mini-nav — tracks scroll position and highlights the chapter
          currently in view. Click jumps to it. Hidden on mobile (chapters
          give the same orientation naturally on a long scroll). */}
      <ChapterNav
        items={[
          { id: "overview",  number: 1, label: t("dashx.chapter.overview") },
          { id: "icps",      number: 2, label: t("dashx.chapter.icps") },
          { id: "campaigns", number: 3, label: t("dashx.chapter.campaigns") },
          { id: "channels",  number: 4, label: t("dashx.chapter.channels") },
          { id: "sellers",   number: 5, label: t("dashx.chapter.sellers") },
        ]}
      />

      {/* ═══ CHAPTER 1 · OVERVIEW ═══════════════════════════════════════════ */}
      <section className="space-y-4 pt-3 sm:pt-4">
      <Chapter
        id="overview"
        number={1}
        icon={TrendingUp}
        title={t("dashx.chapter.overview")}
        description={t("dashx.chapter.overview.desc")}
      />

      {/* ─── Hero row · HeroStat (Total Leads as the marquee number) +
          InsightPanel (top AI-derived insights). Replaces the prior 4-KPI
          band and the standalone Highlight banner; collapses both into
          one premium dark-navy hero row that anchors the dashboard. The
          remaining secondary KPIs (Active Campaigns / Won / Lost) sit in
          a compact MicroKpi strip beneath. */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-7">
            {(() => {
              // Derive totalLeads delta from the funnel's "Importados" stage,
              // which already carries the prior-period count. Null when
              // there's no prior basis — the panel renders "no comparable".
              const priorTotal = data.funnel[0]?.prior ?? null;
              const heroDelta = priorTotal != null && priorTotal > 0
                ? Math.round((headline.totalLeads / priorTotal - 1) * 100)
                : null;
              return (
                <HeroStat
                  eyebrow={t("dashx.hero.eyebrow")}
                  label={t("dashx.kpi.totalLeads")}
                  value={headline.totalLeads.toLocaleString(dateLoc)}
                  delta={heroDelta}
                  vsPriorLabel={t("dashx.kpi.vsPrior")}
                  noPriorLabel={t("dashx.kpi.noPrior")}
                  trend={trend30d.sent}
                  icon={Users}
                  secondary={[
                    { label: t("dashx.kpi.contacted"), value: headline.contactedLeads.toLocaleString(dateLoc) },
                    { label: t("dashx.kpi.replied"),   value: headline.repliedCount.toLocaleString(dateLoc), tone: "default" },
                    { label: t("dashx.kpi.positives"), value: headline.positiveCount.toLocaleString(dateLoc), tone: "success" },
                  ]}
                />
              );
            })()}
          </div>
          <div className="lg:col-span-5">
            {(() => {
              // Translate + rank the structured insights once, then hand
              // off to the dark-themed AI panel. Sort by severity so the
              // top warning surfaces first, then positives, then neutral.
              const rank = (tone: string) => tone === "warning" ? 2 : tone === "positive" ? 1 : 0;
              const insights = [...data.insights]
                .sort((a, b) => rank(b.tone) - rank(a.tone))
                .map(it => {
                  const key = `dashx.insight.${it.kind}`;
                  const translated = t(key, it.vars);
                  return { tone: it.tone, text: translated === key ? it.text : translated };
                });
              return (
                <InsightPanel
                  title={t("dashx.insights.subtitle")}
                  insights={insights}
                  emptyText={t("dashx.insights.empty")}
                />
              );
            })()}
          </div>
        </div>
      </section>

      {/* ─── Compact strip — secondary KPIs that don't deserve full hero
          weight but still need to read at-a-glance. MicroKpi is single-
          line so the strip stays a third the height of the hero row.   */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MicroKpi
            label={t("dashx.kpi.activeCampaigns")}
            value={data.activeCampaignCount.toLocaleString(dateLoc)}
            icon={Megaphone}
            accent={gold}
            hint={t("dashx.kpi.activeCampaignsHint", { paused: data.pausedCampaignCount, closed: data.completedCampaignCount })}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/campaigns"
          />
          <MicroKpi
            label={t("dashx.kpi.won")}
            value={headline.wonCount.toLocaleString(dateLoc)}
            icon={Trophy}
            accent={C.green}
            hint={t("dashx.kpi.wonHint", { n: headline.positiveCount })}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/opportunities"
          />
          <MicroKpi
            label={t("dashx.kpi.lost")}
            value={headline.negativeCount.toLocaleString(dateLoc)}
            icon={AlertTriangle}
            accent="#DC2626"
            hint={t("dashx.kpi.lostHint")}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
          />
        </div>
      </section>

      {/* ─── Pipeline Pulse strip — 4 rate/throughput stats that summarize the
          engine at company level. Replaces the prior "Engine Health" alarm
          strip (Acceptance / Saturation / At Risk / Channel Mismatch). Those
          alarms still compute in dashboard-data but only surface through the
          Highlight callout above when they actually trigger — no point taking
          dashboard real estate to say "everything's fine". */}
      <section className="rounded-2xl border overflow-hidden"
        style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="px-4 py-2 flex items-center gap-2 border-b" style={{ borderColor: C.border }}>
          <Activity size={11} style={{ color: C.textMuted }} />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>{t("dashx.pulse.title")}</span>
          <span className="text-[10.5px]" style={{ color: C.textDim }}>· {t("dashx.pulse.subtitle")}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: C.border }}>
          <HealthStat
            label={t("dashx.pulse.replyRate")}
            value={`${headline.responseRate}%`}
            unit={t("dashx.pulse.replyRateUnit")}
            hint={t("dashx.pulse.replyRateHint", { n: headline.repliedCount.toLocaleString(dateLoc), c: headline.contactedLeads.toLocaleString(dateLoc) })}
            tone="neutral"
          />
          <HealthStat
            label={t("dashx.pulse.winRate")}
            value={`${data.velocity.winRate}%`}
            unit={t("dashx.pulse.winRateUnit")}
            hint={t("dashx.pulse.winRateHint", { n: headline.wonCount.toLocaleString(dateLoc), c: headline.contactedLeads.toLocaleString(dateLoc) })}
            tone={data.velocity.winRate >= 10 ? "success" : "neutral"}
          />
          <HealthStat
            label={t("dashx.pulse.ttfr")}
            value={data.velocity.medianTimeToReplyMin === null ? "—" : formatMinutes(data.velocity.medianTimeToReplyMin)}
            unit={data.velocity.medianTimeToReplyMin === null ? t("dashx.insuf") : t("dashx.pulse.ttfrUnit")}
            hint={t("dashx.pulse.ttfrHint")}
            tone={data.velocity.medianTimeToReplyMin !== null && data.velocity.medianTimeToReplyMin > 72 * 60 ? "warning" : "neutral"}
          />
          {(() => {
            // Daily send volume — avg messages/day in the 30-day trailing
            // trend. Uses trend30d (always-on) instead of period-filtered
            // counts so the value stays stable across short-window filters.
            const total = trend30d.sent.reduce((a, b) => a + b, 0);
            const avg = total / 30;
            const label = avg >= 10 ? Math.round(avg) : avg.toFixed(1);
            return (
              <HealthStat
                label={t("dashx.pulse.dailyVolume")}
                value={`${label}`}
                unit={t("dashx.pulse.dailyVolumeUnit")}
                hint={t("dashx.pulse.dailyVolumeHint", { n: total.toLocaleString(dateLoc) })}
                tone="neutral"
              />
            );
          })()}
        </div>
      </section>

      {/* ─── Funnel + Donut · 7/5 split (was 5/4/3 with an Insights col,
          the Insights are now surfaced as the Highlight banner above). */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Panel title={t("dashx.funnel.title")} subtitle={t("dashx.funnel.subtitle")} className="lg:col-span-7">
            <Funnel {...funnel18n} stages={data.funnel.map(s => ({ ...s, stage: t(`dashx.funnel.stage.${stageKey(s.stage)}`) || s.stage }))} />
          </Panel>
          <Panel title={t("dashx.donut.title")} subtitle={t("dashx.donut.subtitle")} className="lg:col-span-5">
            <Donut data={donutSlices} centerLabel={t("dashx.donut.centerReplies")} emptyLabel={t("dashx.donut.empty")} />
          </Panel>
        </div>
      </section>

      {/* ─── 30-day trend + reply timing heatmap — moved here from Channels.
          They aggregate across ALL channels, so they belong in Overview as
          general engagement charts, not in the per-channel chapter. */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Panel title={t("dashx.trend.title")} subtitle={t("dashx.trend.subtitle")} className="lg:col-span-7">
            <MultiLineChart
              todayLabel={t("dashx.trend.today")}
              recentLabel={t("dashx.trend.daysAgo")}
              series={[
                { name: t("dashx.trend.sent"),      color: C.seriesSent,     data: trend30d.sent },
                { name: t("dashx.trend.replies"),   color: C.seriesReplies,  data: trend30d.replies },
                { name: t("dashx.trend.positives"), color: C.seriesPositive, data: trend30d.positive },
              ]}
            />
          </Panel>
          <Panel title={t("dashx.heat.title")} subtitle={t("dashx.heat.subtitle")} className="lg:col-span-5">
            <Heatmap
              matrix={data.heatmap}
              days={["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(d => t(`dashx.day.${d}`))}
              unitLabel={t("dashx.heat.unitReplies")}
              legendMin={t("dashx.heat.legendMin")}
              legendMax={t("dashx.heat.legendMax")}
            />
          </Panel>
        </div>
      </section>

      </section>
      {/* ═══ CHAPTER 2 · ICPs ═══════════════════════════════════════════════
          Which ideal profiles convert best · which channel fits each one.
          Reading order: leaderboard first (the natural entry point), then
          the matrix below for the deeper 2D analysis. */}
      <section className="space-y-4 pt-6 sm:pt-10">
      <Chapter id="icps" number={2} icon={Target} title={t("dashx.chapter.icps")} description={t("dashx.chapter.icps.desc")} />

      <section>
        <SectionHeader icon={Target} title={t("dashx.tbl.icp.title")} subtitle={t("dashx.tbl.icp.subtitle")} />
        {(() => {
          // Top + lagging callouts. Only when there are 2+ rows with ≥10 contacted
          // (statistical floor) so the comparison is meaningful.
          const eligible = data.icpPerformance.filter(i => i.contacted >= 10 && i.id !== "_unknown");
          if (eligible.length < 2) return null;
          const sorted = [...eligible].sort((a, b) => b.conversionRate - a.conversionRate);
          const top = sorted[0]; const bottom = sorted[sorted.length - 1];
          const gap = top.conversionRate - bottom.conversionRate;
          const topText = top.conversionRate > 0
            ? t("dashx.callout.topIcp", { name: top.name, rate: top.conversionRate, leads: top.leads })
            : null;
          const bottomText = gap >= 10
            ? t("dashx.callout.bottomIcp", { name: bottom.name, rate: bottom.conversionRate, leads: bottom.leads })
            : null;
          return <LeaderCallout topText={topText} bottomText={bottomText} />;
        })()}
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">{t("dashx.tbl.col.icp")}</Th>
                <Th align="right">{t("dashx.tbl.col.leads")}</Th>
                <Th align="right">{t("dashx.tbl.col.contacted")}</Th>
                <Th align="right">{t("dashx.tbl.col.replied")}</Th>
                <Th align="right">{t("dashx.tbl.col.positive")}</Th>
                <Th align="right">{t("dashx.tbl.col.respPct")}</Th>
                <Th align="right">{t("dashx.tbl.col.convPct")}</Th>
                <Th align="left">{t("dashx.tbl.col.trend14")}</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.icpPerformance.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters} kindKey="icps" t={t} /></td></tr>
              ) : (() => {
                // Scale rate bars against the table's own leader so the #1
                // row hits full width; relative ranking reads at a glance.
                const maxConv = Math.max(1, ...data.icpPerformance.map(i => i.conversionRate));
                const maxResp = Math.max(1, ...data.icpPerformance.map(i => i.responseRate));
                return data.icpPerformance.map((icp, idx) => (
                  <tr key={icp.id} className="border-t hover:bg-black/[0.02] transition-colors group relative" style={{ borderColor: C.border }}>
                    <Td>
                      <div className="flex items-center gap-2 relative">
                        {/* Gold strip on the #1 row — replaces the prior single
                            dot with a more punchy "podium" treatment. */}
                        {idx === 0 && (
                          <span aria-hidden className="absolute -left-3 top-0 bottom-0 w-[3px] rounded-full"
                            style={{ background: `linear-gradient(180deg, ${gold} 0%, color-mix(in srgb, ${gold} 50%, transparent) 100%)` }} />
                        )}
                        <TopRankDot rank={idx} t={t} />
                        {icp.id !== "_unknown" ? (
                          <Link href={withFilters(`/dashboard/icp/${icp.id}`, filters)} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{icp.name}</Link>
                        ) : (
                          <span style={{ color: C.textMuted }}>{t("dashx.tbl.icp.unknown")}</span>
                        )}
                      </div>
                    </Td>
                    <NumCell value={icp.leads} />
                    <NumCell value={icp.contacted} />
                    <NumCell value={icp.replied} />
                    <NumCell value={icp.positive} accent={icp.positive > 0 ? C.green : undefined} bold />
                    <td className="px-3 py-2"><div className="flex justify-end"><RateBar value={icp.responseRate} max={maxResp} color="#7C3AED" /></div></td>
                    <td className="px-3 py-2"><div className="flex justify-end"><RateBar value={icp.conversionRate} max={maxConv} color={C.green} /></div></td>
                    <td className="px-3 py-2"><InlineSpark data={icp.spark} color="#7C3AED" /></td>
                    <td className="pr-3" style={{ color: C.textDim }}>{icp.id !== "_unknown" && <Link href={withFilters(`/dashboard/icp/${icp.id}`, filters)} className="inline-flex"><ArrowRight size={12} /></Link>}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* ICP × Channel matrix — sits AFTER the leaderboard now. The table is
          the natural entry point ("which ICP wins?"); the matrix is the
          deeper drilldown ("which channel works for each ICP?"). */}
      <section>
        <SectionHeader icon={Target} title={t("dashx.matrix.title")} subtitle={t("dashx.matrix.subtitle")} />
        <Panel>
          <IcpChannelMatrix matrix={data.matrix} locale={locale} />
        </Panel>
      </section>

      </section>
      {/* ═══ CHAPTER 3 · CAMPAIGNS ═══════════════════════════════════════════
          Which sequences are working · per-step performance reveals which
          message is killing the funnel. Pause / rewrite candidates surface
          via the lagging callout. */}
      <section className="space-y-4 pt-6 sm:pt-10">
      <Chapter id="campaigns" number={3} icon={Megaphone} title={t("dashx.chapter.campaigns")} description={t("dashx.chapter.campaigns.desc")} />

      <section>
        <SectionHeader icon={Megaphone} title={t("dashx.tbl.camp.title")} subtitle={t("dashx.tbl.camp.subtitle")} />
        {/* Status tabs — default to "active" so historical clutter doesn't bury
            campaigns currently running. URL-state via ?camp_status=... so the
            selection survives reload + shareable links. */}
        {(() => {
          const counts = {
            active: data.campaignPerformance.filter(c => c.status === "active").length,
            paused: data.campaignPerformance.filter(c => c.status === "paused").length,
            completed: data.campaignPerformance.filter(c => c.status === "completed").length,
            all: data.campaignPerformance.length,
          };
          const tabs = [
            { id: "active",    label: t("dashx.tbl.status.active"),    count: counts.active },
            { id: "paused",    label: t("dashx.tbl.status.paused"),    count: counts.paused },
            { id: "completed", label: t("dashx.tbl.status.completed"), count: counts.completed },
            { id: "all",       label: t("dashx.filters.all"),          count: counts.all },
          ] as const;
          const buildHref = (id: string) => {
            const params = new URLSearchParams();
            if (filters.from) params.set("from", filters.from);
            if (filters.to) params.set("to", filters.to);
            if (filters.campaignNames?.length) params.set("campaigns", filters.campaignNames.join("|"));
            if (filters.icpIds?.length) params.set("icps", filters.icpIds.join("|"));
            if (filters.sellerIds?.length) params.set("sellers", filters.sellerIds.join("|"));
            if (id !== "active") params.set("camp_status", id);
            // Hash so the page scrolls back to the chapter when the URL changes.
            const q = params.toString();
            return q ? `/?${q}#campaigns` : "/#campaigns";
          };
          return (
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {tabs.map(tab => {
                const on = filters.campStatus === tab.id;
                return (
                  <Link
                    key={tab.id}
                    href={buildHref(tab.id)}
                    scroll={false}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1.5 transition-colors"
                    style={{
                      backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
                      borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
                      color: on ? gold : C.textBody,
                    }}
                  >
                    {tab.label}
                    <span className="text-[9.5px] tabular-nums px-1 py-0 rounded"
                      style={{ background: on ? "transparent" : C.surface, color: on ? gold : C.textDim }}>
                      {tab.count}
                    </span>
                  </Link>
                );
              })}
            </div>
          );
        })()}
        {(() => {
          const eligible = data.campaignPerformance.filter(c => c.leads >= 10);
          if (eligible.length < 2) return null;
          const sorted = [...eligible].sort((a, b) => b.conversionRate - a.conversionRate);
          const top = sorted[0]; const bottom = sorted[sorted.length - 1];
          const gap = top.conversionRate - bottom.conversionRate;
          const topText = top.conversionRate > 0
            ? t("dashx.callout.topCampaign", { name: top.name, rate: top.conversionRate, leads: top.leads })
            : null;
          const bottomText = gap >= 10
            ? t("dashx.callout.bottomCampaign", { name: bottom.name, rate: bottom.conversionRate, leads: bottom.leads })
            : null;
          return <LeaderCallout topText={topText} bottomText={bottomText} />;
        })()}
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
                <Th align="right">{t("dashx.tbl.col.velocity")}</Th>
                <Th align="left">{t("dashx.tbl.col.status")}</Th>
                <Th align="left">{t("dashx.tbl.col.trend14")}</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const visible = filters.campStatus === "all"
                  ? data.campaignPerformance
                  : data.campaignPerformance.filter(c => c.status === filters.campStatus);
                if (visible.length === 0) {
                  return <tr><td colSpan={11} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters || filters.campStatus !== "active"} kindKey="campaigns" t={t} /></td></tr>;
                }
                // Scale conversion bars to the tab's leader, not the whole
                // table — keeps the visual ranking inside the active filter.
                const maxConv = Math.max(1, ...visible.map(c => c.conversionRate));
                return visible.map((c, idx) => {
                // Velocity = positives per day in the active period. Lets the
                // operator separate hot campaigns (winning the month) from
                // sleepy ones (historical conversion but no momentum).
                const velocity = data.period.days > 0 ? (c.positive / data.period.days) : 0;
                const velocityLabel = velocity >= 0.1 ? velocity.toFixed(1) : velocity > 0 ? velocity.toFixed(2) : "0";
                return (
                <tr key={c.name} className="border-t hover:bg-black/[0.02] transition-colors group" style={{ borderColor: C.border }}>
                  <Td>
                    <div className="flex items-center gap-2 relative">
                      {idx === 0 && (
                        <span aria-hidden className="absolute -left-3 top-0 bottom-0 w-[3px] rounded-full"
                          style={{ background: `linear-gradient(180deg, ${gold} 0%, color-mix(in srgb, ${gold} 50%, transparent) 100%)` }} />
                      )}
                      <TopRankDot rank={idx} t={t} />
                      <Link href={withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters)} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{c.name}</Link>
                    </div>
                  </Td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {c.channels.map(ch => {
                        const m = channelMeta[ch] ?? channelMeta.email;
                        const Ic = m.icon;
                        return <Ic key={ch} size={12} style={{ color: m.color }} />;
                      })}
                    </div>
                  </td>
                  <NumCell value={c.leads} />
                  <NumCell value={c.sent} />
                  <NumCell value={c.replied} />
                  <NumCell value={c.positive} accent={c.positive > 0 ? C.green : undefined} bold />
                  <td className="px-3 py-2"><div className="flex justify-end"><RateBar value={c.conversionRate} max={maxConv} color={C.green} /></div></td>
                  <td className="px-3 py-2 text-right tabular-nums text-[12px]" style={{ color: velocity > 0 ? C.textPrimary : C.textDim }}>
                    {velocityLabel}
                    <span className="text-[9.5px] ml-0.5" style={{ color: C.textDim }}>/d</span>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={c.status} t={t} /></td>
                  <td className="px-3 py-2"><InlineSpark data={c.spark} color="#0A66C2" /></td>
                  <td className="pr-3" style={{ color: C.textDim }}><Link href={withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters)} className="inline-flex"><ArrowRight size={12} /></Link></td>
                </tr>
              );});
              })()}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* Step performance — sits inside CAMPAIGNS chapter because the
          "which step is broken" question is per-sequence diagnostic. */}
      <section>
        <SectionHeader icon={ChevronsRight} title={t("dashx.step.title")} subtitle={t("dashx.step.subtitle")} />
        <Panel>
          <StepPerformance steps={data.stepPerformance} locale={locale} />
        </Panel>
      </section>

      </section>
      {/* ═══ CHAPTER 4 · CHANNELS ═══════════════════════════════════════════
          How each outreach channel performs · when in the week replies
          actually arrive. Channel breakdown lives here (not Overview)
          because it answers "which channel works" — a channel question. */}
      <section className="space-y-4 pt-6 sm:pt-10">
      <Chapter id="channels" number={4} icon={Send} title={t("dashx.chapter.channels")} description={t("dashx.chapter.channels.desc")} />

      <section>
        <SectionHeader icon={Send} title={t("dashx.channels.title")} subtitle={t("dashx.channels.subtitle")} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.channelBreakdown.length === 0 ? (
            <EmptyHint>{t("dashx.channels.empty")}</EmptyHint>
          ) : data.channelBreakdown.map(ch => {
            const meta = channelMeta[ch.channel] ?? { icon: Share2, color: C.textMuted, labelKey: "" };
            const Icon = meta.icon;
            const channelLabel = meta.labelKey ? t(meta.labelKey) : ch.channel;
            return (
              <div key={ch.channel} className="rounded-xl border p-3.5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: C.border, backgroundColor: C.card, borderLeft: `3px solid ${meta.color}` }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                      <Icon size={13} />
                    </span>
                    <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{channelLabel}</span>
                  </div>
                  <span className="text-[10px] tabular-nums font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}>
                    {ch.responseRate}% {t("dashx.channels.respShort")}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Stat label={t("dashx.channels.sent")} value={ch.sent} />
                  <Stat label={t("dashx.channels.contacted")} value={ch.contacted} />
                  <Stat label={t("dashx.channels.replied")} value={ch.replied} />
                  <Stat label={t("dashx.channels.positive")} value={ch.positive} accent={C.green} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Channel comparison bar chart — VISUAL ranking of channels by
          reply rate. Replaces the prior 30d trend + heatmap that lived
          here (those weren't channel-specific so they moved up to Overview).
          Bars are sorted by reply rate desc; length-encoded against the
          top performer so the leader hits full width. */}
      <section>
        <SectionHeader icon={Send} title={t("dashx.channels.compTitle")} subtitle={t("dashx.channels.compSubtitle")} />
        <Panel>
          <ChannelComparison channels={data.channelBreakdown} t={t} emptyLabel={t("dashx.channels.empty")} />
        </Panel>
      </section>

      </section>
      {/* ═══ CHAPTER 5 · SELLERS ═══════════════════════════════════════════
          Who's moving the pipeline. Ranking uses reply rate normalized by
          contacted volume (≥20 floor) so the top isn't decided by who
          happened to inherit more leads. */}
      <section className="space-y-4 pt-6 sm:pt-10">
      <Chapter id="sellers" number={5} icon={Trophy} title={t("dashx.chapter.sellers")} description={t("dashx.chapter.sellers.desc")} />

      <section>
        <SectionHeader icon={Trophy} title={t("dashx.tbl.seller.title")} subtitle={t("dashx.tbl.seller.subtitle")} />
        {(() => {
          // Seller comparison uses reply rate (normalized) and requires
          // ≥20 contacted for fairness (consistent with the table threshold).
          const eligible = data.sellerPerformance.filter(s => s.contacted >= 20);
          if (eligible.length < 2) return null;
          const sorted = [...eligible].sort((a, b) => b.responseRate - a.responseRate);
          const top = sorted[0]; const bottom = sorted[sorted.length - 1];
          const gap = top.responseRate - bottom.responseRate;
          const topText = top.responseRate > 0
            ? t("dashx.callout.topSeller", { name: top.name, rate: top.responseRate })
            : null;
          const bottomText = gap >= 15
            ? t("dashx.callout.bottomSeller", { name: bottom.name, rate: bottom.responseRate })
            : null;
          return <LeaderCallout topText={topText} bottomText={bottomText} />;
        })()}
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left" style={{ width: 28 }}>#</Th>
                <Th align="left">{t("dashx.tbl.col.seller")}</Th>
                <Th align="right">{t("dashx.tbl.col.active")}</Th>
                <Th align="right">{t("dashx.tbl.col.contacted")}</Th>
                <Th align="right">{t("dashx.tbl.col.sent")}</Th>
                <Th align="right">{t("dashx.tbl.col.replied")}</Th>
                <Th align="right">{t("dashx.tbl.col.positive")}</Th>
                <Th align="right">{t("dashx.tbl.col.convPct")}</Th>
                <Th align="left">{t("dashx.tbl.col.trend14")}</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.sellerPerformance.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters} kindKey="sellers" t={t} /></td></tr>
              ) : (() => {
                const maxConv = Math.max(1, ...data.sellerPerformance.map(s => s.conversionRate));
                return data.sellerPerformance.map((s, idx) => (
                  <tr key={s.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                    <Td>
                      {/* Podium rank — gold gradient for #1 to anchor the
                          leaderboard; navy ink ghost for the rest so the eye
                          jumps straight to the leader on first scan. */}
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold"
                        style={{
                          background: idx === 0
                            ? `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`
                            : `color-mix(in srgb, ${C.textMuted} 8%, transparent)`,
                          color: idx === 0 ? "#1A1505" : C.textMuted,
                          boxShadow: idx === 0 ? `0 2px 8px color-mix(in srgb, ${gold} 32%, transparent)` : "none",
                        }}>
                        {idx + 1}
                      </span>
                    </Td>
                    <Td><Link href={withFilters(`/dashboard/seller/${s.id}`, filters)} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{s.name}</Link></Td>
                    <NumCell value={s.active} />
                    <NumCell value={s.contacted} />
                    <NumCell value={s.sent} />
                    <NumCell value={s.replied} />
                    <NumCell value={s.positive} accent={s.positive > 0 ? C.green : undefined} bold />
                    <td className="px-3 py-2"><div className="flex justify-end"><RateBar value={s.conversionRate} max={maxConv} color={C.green} /></div></td>
                    <td className="px-3 py-2"><InlineSpark data={s.spark} color={gold} /></td>
                    <td className="pr-3" style={{ color: C.textDim }}><Link href={withFilters(`/dashboard/seller/${s.id}`, filters)} className="inline-flex"><ArrowRight size={12} /></Link></td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </Panel>
      </section>

      </section>
      <SwlSignature caption={t("dashx.brand.captionMain")} tagline={t("dashx.brand.tagline")} />
    </div>
  );
}

// ─── Local presentation primitives ──────────────────────────────────────

function SectionHeader({ title, subtitle, icon: Icon, action }: { title: string; subtitle: string; icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      {/* Gold accent bar — Vercel/Linear pattern, gives sections quiet brand weight */}
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
        <h2 className="text-[14px] font-semibold leading-tight tracking-tight" style={{ color: C.textPrimary }}>
          {title}
        </h2>
        <p className="text-[11px] truncate mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Panel({ title, subtitle, children, className }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${className ?? ""}`} style={{ backgroundColor: C.card, borderColor: C.border }}>
      {(title || subtitle) && (
        <div className="px-4 py-2.5 border-b" style={{ borderColor: C.border }}>
          {title && <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{title}</p>}
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
      )}
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-xs"
      style={{ borderColor: C.border, color: C.textMuted }}>{children}</div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>{label}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: accent ?? C.textPrimary }}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function Th({ children, align, style }: { children?: React.ReactNode; align: "left" | "right"; style?: React.CSSProperties }) {
  return <th className={`px-3 py-2 font-semibold text-${align}`} style={style}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td className="px-3 py-2" style={style}>{children}</td>;
}
function NumCell({ value, bold, accent }: { value: number; bold?: boolean; accent?: string }) {
  return <td className="px-3 py-2 text-right tabular-nums" style={{ color: accent ?? (bold ? C.textPrimary : C.textBody), fontWeight: bold ? 600 : 400 }}>{value.toLocaleString("es-AR")}</td>;
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

function VelocityStat({
  icon: Icon, label, value, unit, hint, tone,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone: "brand" | "neutral" | "success";
}) {
  const accent = tone === "brand" ? gold : tone === "success" ? C.green : C.textBody;
  return (
    <div className="px-5 py-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>{label}</p>
        <p className="mt-0.5">
          <span className="text-2xl font-bold tabular-nums" style={{ color: accent, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>{value}</span>
          <span className="text-xs ml-1.5" style={{ color: C.textMuted }}>{unit}</span>
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{hint}</p>
      </div>
    </div>
  );
}

/** Small gold dot marking the row's primary ranking position. Only rendered
 * for `rank === 0` — the visual marker for the period's top performer. Kept
 * subtle on purpose: skim-ability win without competing with the row content. */
function TopRankDot({ rank, t }: { rank: number; t: (k: string) => string }) {
  if (rank !== 0) return <span className="inline-block w-1.5 shrink-0" />;
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: gold, boxShadow: `0 0 0 2px color-mix(in srgb, ${gold} 18%, transparent)` }}
      title={t("dashx.tbl.top")}
      aria-label={t("dashx.tbl.top")}
    />
  );
}

/** Differentiated empty state for tables — separates "no data ever" from "no
 * data with these filters". The latter has a clear CTA back to a fresh view. */
function EmptyTableState({ filtered, kindKey, t }: { filtered: boolean; kindKey: "icps" | "campaigns" | "sellers"; t: (k: string, vars?: Record<string, string | number>) => string }) {
  const kind = t(`dashx.tbl.empty.${kindKey}`);
  if (filtered) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span style={{ color: C.textMuted }}>{t("dashx.tbl.empty.filtered", { kind })}</span>
        <Link href="/" className="text-[10px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-70"
          style={{ color: gold }}>
          {t("dashx.tbl.empty.clearFilters")}
        </Link>
      </div>
    );
  }
  return <span style={{ color: C.textMuted }}>{t("dashx.tbl.empty.unfiltered", { kind })}</span>;
}

/** Compact stat tile used inside the "Salud del motor" strip. Same density
 * grammar as VelocityStat but no gold gradient — visually quieter so the
 * Velocity strip stays the dominant north-star band above it. */
function HealthStat({ label, value, unit, hint, tone }: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone: "neutral" | "warning" | "success";
}) {
  const accent = tone === "warning" ? "#D97706"
    : tone === "success" ? C.green
    : C.textPrimary;
  return (
    <div className="px-5 py-4 flex flex-col gap-0.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{label}</p>
      <p className="flex items-baseline gap-1.5 mt-1">
        <span className="text-[24px] font-bold tabular-nums tracking-[-0.02em]" style={{ color: accent, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{value}</span>
        <span className="text-[11px]" style={{ color: C.textMuted }}>{unit}</span>
      </p>
      <p className="text-[10.5px] leading-snug mt-0.5" style={{ color: C.textDim }}>{hint}</p>
    </div>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
