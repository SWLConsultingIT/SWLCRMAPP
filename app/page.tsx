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
const classColors: Record<string, string> = {
  positive:       "#16A34A",
  meeting_intent: "#059669",
  negative:       "#DC2626",
  not_now:        "#F59E0B",
  unsubscribe:    "#9CA3AF",
  needs_info:     "#7C3AED",
  question:       "#0A66C2",
  nurturing:      "#6B7280",
  spam:           "#374151",
  auto_reply:     "#94A3B8",
  unclassified:   "#9CA3AF",
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
    <div className="p-4 sm:p-6 w-full space-y-5">
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

      {/* ═══ CHAPTER 1 · OVERVIEW ═══════════════════════════════════════════ */}
      <Chapter
        id="overview"
        number={1}
        icon={TrendingUp}
        title={t("dashx.chapter.overview")}
        description={t("dashx.chapter.overview.desc")}
      />

      {/* ─── KPIs Leading / Lagging in one row (research: 5-9 KPIs max, leading first) ─ */}
      <section>
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0A66C2" }} />
              {t("dashx.kpi.leading")} <span style={{ color: C.textDim }}>· {t("dashx.kpi.leadingHint")}</span>
            </span>
            <span style={{ color: C.textDim }}>|</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.green }} />
              {t("dashx.kpi.lagging")} <span style={{ color: C.textDim }}>· {t("dashx.kpi.laggingHint")}</span>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard {...kpi18n}
            label={t("dashx.kpi.contacted")}
            value={headline.contactedLeads.toLocaleString(dateLoc)}
            delta={deltas.contacted}
            trend={trend30d.sent}
            icon={Send}
            accent="#0A66C2"
            hint={t("dashx.kpi.contactedHint")}
          />
          <KpiCard {...kpi18n}
            label={t("dashx.kpi.acceptCR")}
            value={`${headline.acceptanceRate}%`}
            icon={ChevronsRight}
            accent="#0A66C2"
            hint={t("dashx.kpi.acceptCRHint", { n: headline.connectedLeads.toLocaleString(dateLoc) })}
          />
          <KpiCard {...kpi18n}
            label={t("dashx.kpi.replies")}
            value={headline.repliedCount.toLocaleString(dateLoc)}
            delta={deltas.replied}
            trend={trend30d.replies}
            icon={MessageSquare}
            accent="#7C3AED"
            hint={t("dashx.kpi.repliesHint", { n: headline.responseRate })}
            href="/queue?tab=inbox"
          />
          <KpiCard {...kpi18n}
            label={t("dashx.kpi.positives")}
            value={headline.positiveCount.toLocaleString(dateLoc)}
            delta={deltas.positive}
            trend={trend30d.positive}
            icon={ThumbsUp}
            accent={C.green}
            hint={t("dashx.kpi.positivesHint", { n: headline.positiveRate })}
            href="/opportunities"
          />
          <KpiCard {...kpi18n}
            label={t("dashx.kpi.meetings")}
            value={headline.meetingCount.toLocaleString(dateLoc)}
            icon={Target}
            accent="#F59E0B"
            hint={t("dashx.kpi.meetingsHint")}
            href="/opportunities"
          />
          <KpiCard {...kpi18n}
            label={t("dashx.kpi.wins")}
            value={headline.wonCount.toLocaleString(dateLoc)}
            icon={Trophy}
            accent="#DC2626"
            hint={t("dashx.kpi.winsHint", { n: data.velocity.winRate })}
          />
        </div>
      </section>

      {/* ─── Operations Pulse — velocity north-star + engine health, one card ─
          Used to be two stacked sections (8 stats + headers + dividers,
          ~280px vertical). Merged into a single surface so the top fold
          breathes: gold-tinted top half is the velocity "north star",
          neutral bottom half is health signals. Same data, half the
          vertical real estate. */}
      <section className="rounded-2xl border overflow-hidden"
        style={{ borderColor: C.border, backgroundColor: C.card }}>
        {/* Velocity row — gold gradient, 4 cols */}
        <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 5%, ${C.card}) 100%)` }}>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: C.border }}>
            <VelocityStat
              icon={Sparkles}
              label={t("dashx.vel.velocity")}
              value={`${data.velocity.perDay}`}
              unit={t("dashx.vel.velocityUnit")}
              hint={t("dashx.vel.velocityHint")}
              tone="brand"
            />
            <VelocityStat
              icon={Target}
              label={t("dashx.vel.forecast")}
              value={`${data.velocity.forecastMonthEnd}`}
              unit={t("dashx.vel.forecastUnit")}
              hint={t("dashx.vel.forecastHint")}
              tone="brand"
            />
            <VelocityStat
              icon={Clock}
              label={t("dashx.vel.ttfr")}
              value={data.velocity.medianTimeToReplyMin === null ? "—" : formatMinutes(data.velocity.medianTimeToReplyMin)}
              unit={t("dashx.vel.ttfrUnit")}
              hint={t("dashx.vel.ttfrHint")}
              tone="neutral"
            />
            <VelocityStat
              icon={Trophy}
              label={t("dashx.vel.winrate")}
              value={`${data.velocity.winRate}%`}
              unit={t("dashx.vel.winrateUnit")}
              hint={t("dashx.vel.winrateHint")}
              tone="success"
            />
          </div>
        </div>

        {/* Health row — quieter visual weight, 3 cols, separated by a single divider */}
        <div className="border-t" style={{ borderColor: C.border }}>
          <div className="px-4 py-2 flex items-center gap-2 border-b" style={{ borderColor: C.border }}>
            <Activity size={11} style={{ color: C.textMuted }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>{t("dashx.health.title")}</span>
            <span className="text-[10.5px]" style={{ color: C.textDim }}>· {t("dashx.health.subtitle")}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: C.border }}>
            <HealthStat
              label={t("dashx.health.sat")}
              value={data.health.saturationRate === null ? "—" : `${data.health.saturationRate}%`}
              unit={data.health.saturationRate === null ? t("dashx.insuf") : t("dashx.health.satUnit")}
              hint={data.health.saturationRate === null
                ? t("dashx.health.satInsuf")
                : t("dashx.health.satHint", { n: data.health.saturatedCount })}
              tone={data.health.saturationRate !== null && data.health.saturationRate >= 60 ? "warning" : "neutral"}
            />
            <HealthStat
              label={t("dashx.health.risk")}
              value={`${data.health.atRiskCount}`}
              unit={t("dashx.health.riskUnit")}
              hint={t("dashx.health.riskHint")}
              tone={data.health.atRiskCount >= 5 ? "warning" : "neutral"}
            />
            <HealthStat
              label={t("dashx.health.mismatch")}
              value={data.health.channelMismatchRate === null ? "—" : `${data.health.channelMismatchRate}%`}
              unit={data.health.channelMismatchRate === null ? t("dashx.insuf") : t("dashx.health.mismatchUnit")}
              hint={data.health.channelMismatchRate === null
                ? t("dashx.health.mismatchInsuf")
                : t("dashx.health.mismatchHint", { n: data.health.mismatchCount })}
              tone="neutral"
            />
          </div>
        </div>
      </section>

      {/* ─── Funnel + Donut + Heatmap in a tight 3-column grid ────────────── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Funnel — 5 cols */}
          <Panel title={t("dashx.funnel.title")} subtitle={t("dashx.funnel.subtitle")} className="lg:col-span-5">
            <Funnel {...funnel18n} stages={data.funnel.map(s => ({ ...s, stage: t(`dashx.funnel.stage.${stageKey(s.stage)}`) || s.stage }))} />
          </Panel>
          {/* Donut — 3 cols */}
          <Panel title={t("dashx.donut.title")} subtitle={t("dashx.donut.subtitle")} className="lg:col-span-4">
            <Donut data={donutSlices} centerLabel={t("dashx.donut.centerReplies")} emptyLabel={t("dashx.donut.empty")} />
          </Panel>
          {/* Insights — 4 cols */}
          <Panel title={t("dashx.insights.title")} subtitle={t("dashx.insights.subtitle")} className="lg:col-span-3">
            {data.insights.length === 0 ? (
              <div className="text-xs py-6 text-center" style={{ color: C.textDim }}>
                {t("dashx.insights.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {data.insights.map((ins, i) => {
                  const tone =
                    ins.tone === "positive" ? { color: C.green, Icon: CheckCircle2 }
                    : ins.tone === "warning" ? { color: C.red, Icon: AlertTriangle }
                    : { color: gold, Icon: Lightbulb };
                  const Ic = tone.Icon;
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <Ic size={13} style={{ color: tone.color }} className="shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-snug" style={{ color: C.textBody }}>{ins.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </section>

      {/* ═══ CHAPTER 2 · ICPs ═══════════════════════════════════════════════
          Which ideal profiles convert best · which channel fits each one.
          Reading order: matrix first (the 2D comparison), then the linear
          leaderboard with conversion + trend + drilldown. */}
      <Chapter id="icps" number={2} icon={Target} title={t("dashx.chapter.icps")} description={t("dashx.chapter.icps.desc")} />

      <section>
        <SectionHeader icon={Target} title={t("dashx.matrix.title")} subtitle={t("dashx.matrix.subtitle")} />
        <Panel>
          <IcpChannelMatrix matrix={data.matrix} locale={locale} />
        </Panel>
      </section>

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
              ) : data.icpPerformance.map((icp, idx) => (
                <tr key={icp.id} className="border-t hover:bg-black/[0.02] transition-colors group" style={{ borderColor: C.border }}>
                  <Td>
                    <div className="flex items-center gap-2">
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
                  <RateCell value={icp.responseRate} color="#7C3AED" />
                  <RateCell value={icp.conversionRate} color={C.green} />
                  <td className="px-3 py-2"><InlineSpark data={icp.spark} color="#7C3AED" /></td>
                  <td className="pr-3" style={{ color: C.textDim }}>{icp.id !== "_unknown" && <Link href={withFilters(`/dashboard/icp/${icp.id}`, filters)} className="inline-flex"><ArrowRight size={12} /></Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* ═══ CHAPTER 3 · CAMPAIGNS ═══════════════════════════════════════════
          Which sequences are working · per-step performance reveals which
          message is killing the funnel. Pause / rewrite candidates surface
          via the lagging callout. */}
      <Chapter id="campaigns" number={3} icon={Megaphone} title={t("dashx.chapter.campaigns")} description={t("dashx.chapter.campaigns.desc")} />

      <section>
        <SectionHeader icon={Megaphone} title={t("dashx.tbl.camp.title")} subtitle={t("dashx.tbl.camp.subtitle")} />
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
                <Th align="left">{t("dashx.tbl.col.status")}</Th>
                <Th align="left">{t("dashx.tbl.col.trend14")}</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.campaignPerformance.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters} kindKey="campaigns" t={t} /></td></tr>
              ) : data.campaignPerformance.map((c, idx) => (
                <tr key={c.name} className="border-t hover:bg-black/[0.02] transition-colors group" style={{ borderColor: C.border }}>
                  <Td>
                    <div className="flex items-center gap-2">
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
                  <RateCell value={c.conversionRate} color={C.green} />
                  <td className="px-3 py-2"><StatusBadge status={c.status} t={t} /></td>
                  <td className="px-3 py-2"><InlineSpark data={c.spark} color="#0A66C2" /></td>
                  <td className="pr-3" style={{ color: C.textDim }}><Link href={withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters)} className="inline-flex"><ArrowRight size={12} /></Link></td>
                </tr>
              ))}
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

      {/* ═══ CHAPTER 4 · CHANNELS ═══════════════════════════════════════════
          How each outreach channel performs · when in the week replies
          actually arrive. Channel breakdown lives here (not Overview)
          because it answers "which channel works" — a channel question. */}
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

      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Panel title={t("dashx.trend.title")} subtitle={t("dashx.trend.subtitle")} className="lg:col-span-7">
            <MultiLineChart
              todayLabel={t("dashx.trend.today")}
              recentLabel={t("dashx.trend.daysAgo")}
              series={[
                { name: t("dashx.trend.sent"),      color: "#0A66C2", data: trend30d.sent },
                { name: t("dashx.trend.replies"),   color: "#7C3AED", data: trend30d.replies },
                { name: t("dashx.trend.positives"), color: C.green,   data: trend30d.positive },
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

      {/* ═══ CHAPTER 5 · SELLERS ═══════════════════════════════════════════
          Who's moving the pipeline. Ranking uses reply rate normalized by
          contacted volume (≥20 floor) so the top isn't decided by who
          happened to inherit more leads. */}
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
              ) : data.sellerPerformance.map((s, idx) => (
                <tr key={s.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
                  <Td>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: idx === 0 ? `color-mix(in srgb, ${gold} 18%, transparent)` : C.surface, color: idx === 0 ? gold : C.textMuted }}>
                      {idx + 1}
                    </span>
                  </Td>
                  <Td><Link href={withFilters(`/dashboard/seller/${s.id}`, filters)} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{s.name}</Link></Td>
                  <NumCell value={s.active} />
                  <NumCell value={s.contacted} />
                  <NumCell value={s.sent} />
                  <NumCell value={s.replied} />
                  <NumCell value={s.positive} accent={s.positive > 0 ? C.green : undefined} bold />
                  <RateCell value={s.conversionRate} color={C.green} />
                  <td className="px-3 py-2"><InlineSpark data={s.spark} color={gold} /></td>
                  <td className="pr-3" style={{ color: C.textDim }}><Link href={withFilters(`/dashboard/seller/${s.id}`, filters)} className="inline-flex"><ArrowRight size={12} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
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
function RateCell({ value, color }: { value: number; color: string }) {
  return (
    <td className="px-3 py-2 text-right">
      <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded"
        style={{ backgroundColor: value > 0 ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent", color: value > 0 ? color : C.textMuted }}>
        {value}%
      </span>
    </td>
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
  tone: "neutral" | "warning";
}) {
  const accent = tone === "warning" ? "#D97706" : C.textPrimary;
  return (
    <div className="px-5 py-3.5 flex flex-col gap-0.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>{label}</p>
      <p className="flex items-baseline gap-1.5">
        <span className="text-[20px] font-semibold tabular-nums tracking-tight" style={{ color: accent }}>{value}</span>
        <span className="text-[11px]" style={{ color: C.textMuted }}>{unit}</span>
      </p>
      <p className="text-[10.5px] leading-snug" style={{ color: C.textDim }}>{hint}</p>
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
