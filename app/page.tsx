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
  Users, Send, Trophy, Megaphone, Target,
  AlertTriangle, ArrowRight, MessageSquare, ThumbsUp, Sparkles,
  Share2, Mail, Phone, Smartphone, FileDown, ChevronsRight, Activity,
} from "lucide-react";
import { C, N } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getDashboardData } from "@/lib/dashboard-data";
import { getT, getServerLocale } from "@/lib/i18n-server";
import ReliabilityBanner from "@/components/ReliabilityBanner";
import FiltersBar from "@/components/dashboard/FiltersBar";
import CampStatusChipsLive from "@/components/dashboard/CampStatusChipsLive";
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
import ChapterNav from "@/components/dashboard/ChapterNav";
import ChannelComparison from "@/components/dashboard/ChannelComparison";
import MicroKpi from "@/components/dashboard/MicroKpi";
import RateBar from "@/components/dashboard/RateBar";
import ChannelCard from "@/components/dashboard/ChannelCard";
import CallsCard from "@/components/dashboard/CallsCard";
import LinkedInConnectionsCard from "@/components/dashboard/LinkedInConnectionsCard";
import TodayCard from "@/components/dashboard/TodayCard";
import ChannelTouches from "@/components/dashboard/ChannelTouches";

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

/** Funnel stages are already English keys after the 2026-05-27 redefinition
 * (e.g. "linkedin_sent", "email_touch"). This is now a pass-through used by
 * the t() lookup in the Funnel render — kept as a function so the call site
 * doesn't change and future renames stay scoped here. */
function stageKey(label: string): string {
  return label;
}

// Never cached — without this, clicking the period chips changes the URL
// but Next.js serves the cached server response and the page shows stale
// numbers. Memory: feedback_dashboard_no_cache — reliability surfaces and
// every detail page already follow this; the main dashboard was missing it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DASHBOARD_TABS = ["overview", "icps", "campaigns", "channels", "sellers"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

function parseFilters(sp: Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v ?? null;
  };
  const getList = (k: string) => {
    const v = get(k);
    return v ? v.split("|").filter(Boolean) : [];
  };
  const rawTab = get("tab");
  const tab: DashboardTab = (DASHBOARD_TABS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as DashboardTab)
    : "overview";
  return {
    from: get("from"),
    to: get("to"),
    campaignNames: getList("campaigns"),
    icpIds: getList("icps"),
    sellerIds: getList("sellers"),
    /** Tab selection for the campaign leaderboard. Default = "active" so
     * historical clutter doesn't bury the campaigns currently running. */
    campStatus: (get("camp_status") as "active" | "paused" | "completed" | "all" | null) ?? "active",
    /** Active dashboard tab — drives which chapter renders. Default overview. */
    tab,
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
  const [data, t, locale] = await Promise.all([
    getDashboardData(filters),
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
  // Always-visible classifications — per boss feedback (2026-05-27),
  // "Positives" must show up in the legend even when the count is 0, so
  // the operator immediately sees that the period had zero positives
  // instead of a missing slot. Other classes still get hidden when 0
  // because rendering every neutral category would clutter the legend.
  const ALWAYS_SHOW_REPLY_CLASSES = new Set(["positive", "meeting_intent"]);
  const donutSlices = Object.entries(data.replyClassCounts)
    .filter(([k, v]) => v > 0 || ALWAYS_SHOW_REPLY_CLASSES.has(k))
    .map(([k, v]) => ({
      label: t(`dashx.reply.${k}`) === `dashx.reply.${k}` ? k : t(`dashx.reply.${k}`),
      value: v,
      color: classColors[k] ?? "#9CA3AF",
      classKey: k,
      prior: data.replyClassCountsPrior?.[k] ?? 0,
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
      <Suspense fallback={null}>
        <DashboardKeyboardShortcuts />
      </Suspense>

      {/* ─── Welcome hero — same black-and-gold surface as the tabs nav,
          TodayCard header and Panel headers. Boss-feedback round 4 #2
          plus the consistency note: every hero in the dashboard rides
          the navy-ink gradient with gold accents; no white islands. */}
      <header
        className="relative rounded-2xl overflow-hidden px-5 sm:px-7 py-5 sm:py-6"
        style={{
          background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
          border: `1px solid color-mix(in srgb, ${gold} 28%, ${N.hairline})`,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 20%, transparent), 0 14px 32px -18px ${N.ink}`,
        }}
      >
        <span
          aria-hidden
          className="absolute -top-24 -right-20 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 22%, transparent) 0%, transparent 65%)` }}
        />
        <span
          aria-hidden
          className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 10%, transparent) 0%, transparent 65%)` }}
        />
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p
              className="text-[10.5px] font-bold uppercase tracking-[0.24em]"
              style={{ color: gold }}
            >
              {t("dashx.hero.section")}
            </p>
            <h1
              className="text-[26px] sm:text-[32px] font-bold tracking-[-0.022em] leading-[1.05] mt-2"
              style={{
                color: "white",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                textShadow: `0 2px 14px color-mix(in srgb, ${gold} 12%, transparent)`,
              }}
            >
              {t("dashx.hero.title")}
            </h1>
            <p
              className="text-[12.5px] mt-2 max-w-[640px]"
              style={{ color: "color-mix(in srgb, white 65%, transparent)" }}
            >
              {t("dashx.hero.desc")}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-bold uppercase tracking-[0.14em]"
              style={{
                backgroundColor: `color-mix(in srgb, ${gold} 18%, transparent)`,
                color: gold,
                border: `1px solid color-mix(in srgb, ${gold} 38%, transparent)`,
              }}
            >
              {periodLabel}
            </span>
            <FreshnessChip renderedAt={renderedAt} />
            <Link
              href="/reports"
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
              style={{
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
                color: N.ink,
                boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 34%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
              }}
            >
              <FileDown size={13} /> {t("dashx.hero.download")}
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Tab bar — sticky URL-driven nav. Actions moved to the welcome
          hero above, so this row is purely navigation. */}
      <Suspense fallback={<div className="h-12" />}>
        <ChapterNav
          items={[
            { id: "overview",  number: 1, label: t("dashx.chapter.overview") },
            { id: "icps",      number: 2, label: t("dashx.chapter.icps") },
            { id: "campaigns", number: 3, label: t("dashx.chapter.campaigns") },
            { id: "channels",  number: 4, label: t("dashx.chapter.channels") },
            { id: "sellers",   number: 5, label: t("dashx.chapter.sellers") },
          ]}
        />
      </Suspense>

      {/* ─── Filter bar — sits below tabs because filters scope the active
          tab's content. Suspense boundary required for useSearchParams. */}
      <Suspense fallback={<div className="h-10" />}>
        <FiltersBar />
      </Suspense>

      {/* ═══ CHAPTER 1 · OVERVIEW ═══════════════════════════════════════════ */}
      {filters.tab === "overview" && (
      <section className="space-y-8 pt-3">

      {/* ─── ACT 1 · "What to do today" — narrative opener. Boss feedback
          2026-05-27: the dashboard must tell a story, not lead with vanity
          metrics. This card surfaces actionable items first (replies to
          review, leads to assign, etc) with deep links into the surface
          where the work happens. Items with value=0 are hidden so the card
          only shows what truly needs attention. */}
      <TodayCard
        locale={locale === "es" ? "es" : "en"}
        labels={{
          title: t("dashx.today.title"),
          subtitle: t("dashx.today.subtitle"),
          empty: t("dashx.today.empty"),
          noIcp: t("dashx.tbl.icp.unknown"),
          sections: {
            replies:    { label: t("dashx.today.replies"),         hint: t("dashx.today.repliesHint"),       cta: t("dashx.today.openInbox") },
            positives:  { label: t("dashx.today.positives"),       hint: t("dashx.today.positivesHint"),     cta: t("dashx.today.openOpps") },
            calls:      { label: t("dashx.today.calls"),           hint: t("dashx.today.callsHint"),         cta: t("dashx.today.openCalls") },
            unassigned: { label: t("dashx.today.leadsNoCampaign"), hint: t("dashx.today.leadsNoCampaignHint"), cta: t("dashx.today.openLeads") },
          },
        }}
        data={data.todayLists}
      />

      {/* ─── GENERAL OVERVIEW · 9 headline metrics arranged as boss asked
          on 2026-05-27. Row 1 = portfolio state (totals + campaign cohorts).
          Row 2 = outcomes (replies, wins, losses, rates). One titled
          section so it reads as a single chapter, not 9 floating cards. */}
      <section>
        <SectionHeader icon={Activity} title={t("dashx.overview.title")} subtitle={t("dashx.overview.subtitle")} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <MicroKpi
            label={t("dashx.kpi.totalLeads")}
            value={headline.totalLeads.toLocaleString(dateLoc)}
            icon={Users}
            accent={C.textPrimary}
            hint={t("dashx.kpi.totalLeadsHintShort", { n: headline.contactedLeads })}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/leads"
          />
          <MicroKpi
            label={t("dashx.kpi.leadsNoCampaign")}
            value={data.leadsWithoutCampaign.toLocaleString(dateLoc)}
            icon={Users}
            accent="#94A3B8"
            hint={t("dashx.kpi.leadsNoCampaignHint")}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/leads"
          />
          <MicroKpi
            label={t("dashx.kpi.activeCampaigns")}
            value={data.activeCampaignCount.toLocaleString(dateLoc)}
            icon={Megaphone}
            accent={gold}
            hint={t("dashx.kpi.activeCampaignsHintShort")}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/campaigns"
          />
          <MicroKpi
            label={t("dashx.kpi.pausedCampaigns")}
            value={data.pausedCampaignCount.toLocaleString(dateLoc)}
            icon={Megaphone}
            accent="#D97706"
            hint={t("dashx.kpi.pausedCampaignsHint")}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/campaigns?status=paused"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MicroKpi
            label={t("dashx.kpi.totalReplies")}
            value={headline.repliedCount.toLocaleString(dateLoc)}
            icon={MessageSquare}
            accent="#7C3AED"
            hint={t("dashx.kpi.totalRepliesHint")}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/inbox"
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
            href="/leads/lost"
          />
          <MicroKpi
            label={t("dashx.pulse.replyRate")}
            value={`${headline.responseRate}%`}
            icon={MessageSquare}
            accent="#7C3AED"
            hint={t("dashx.pulse.replyRateHint", { n: headline.repliedCount.toLocaleString(dateLoc), c: headline.contactedLeads.toLocaleString(dateLoc) })}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/inbox"
          />
          <MicroKpi
            label={t("dashx.pulse.winRate")}
            value={`${data.velocity.winRate}%`}
            icon={ThumbsUp}
            accent={gold}
            hint={t("dashx.pulse.winRateHint", { n: headline.wonCount.toLocaleString(dateLoc), c: headline.contactedLeads.toLocaleString(dateLoc) })}
            vsPriorLabel={t("dashx.kpi.vsPrior")}
            noPriorLabel={t("dashx.kpi.noPrior")}
            href="/opportunities"
          />
        </div>
      </section>

      {/* ─── Pipeline Pulse — operational vitals strip. Reply/Win rate moved
          to the Hero row; this strip now carries the velocity signals that
          tell you HOW the engine is running (acceptance, TTFR, daily
          volume, sequence depth). Navy-ink header + gold accent rail per
          SWL polish brief 2026-05-27 round 3. */}
      <section className="rounded-2xl border overflow-hidden relative"
        style={{
          borderColor: `color-mix(in srgb, ${gold} 18%, ${C.border})`,
          backgroundColor: C.card,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 14%, transparent), 0 6px 18px -10px ${N.ink}`,
        }}>
        <div
          className="relative px-4 py-2.5 flex items-center gap-2 overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
            borderBottom: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
          }}
        >
          <span
            aria-hidden
            className="absolute -top-10 -left-10 w-32 h-32 rounded-full pointer-events-none"
            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 20%, transparent) 0%, transparent 65%)` }}
          />
          <span
            className="relative w-5 h-5 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
              color: N.ink,
              boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 32%, transparent)`,
            }}
          >
            <Activity size={11} />
          </span>
          <span
            className="relative text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
          >
            {t("dashx.pulse.title")}
          </span>
          <span className="relative text-[10.5px]" style={{ color: "color-mix(in srgb, white 50%, transparent)" }}>
            · {t("dashx.pulse.subtitle")}
          </span>
        </div>
        {(() => {
          const liStats = data.channelBreakdown.find(c => c.channel === "linkedin") ?? { sent: 0, replied: 0 };
          const emailStats = data.channelBreakdown.find(c => c.channel === "email") ?? { sent: 0, replied: 0 };
          const callsMade = data.callsBreakdown.completed ?? 0;
          const callsPending = data.callsBreakdown.pending ?? 0;
          return (
            <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: C.border }}>
              {/* Left column — LinkedIn connection invitation flow (CR layer) */}
              <div className="divide-y" style={{ borderColor: C.border }}>
                <PulseStat
                  label={t("dashx.pulse.connectionsSent")}
                  value={data.linkedinConnections.sent.toLocaleString(dateLoc)}
                  unit={t("dashx.pulse.connectionsSentUnit")}
                  hint={t("dashx.pulse.connectionsSentHint")}
                  tone="neutral"
                />
                <PulseStat
                  label={t("dashx.pulse.acceptanceRate")}
                  value={`${data.velocity.acceptanceRate}%`}
                  unit={t("dashx.pulse.acceptanceRateUnit")}
                  hint={t("dashx.pulse.acceptanceRateHint", { sent: data.linkedinConnections.sent, accepted: data.linkedinConnections.accepted })}
                  tone={data.velocity.acceptanceRate >= 30 ? "success" : "neutral"}
                />
              </div>
              {/* LinkedIn messaging layer (post-acceptance) */}
              <div className="divide-y" style={{ borderColor: C.border }}>
                <PulseStat
                  label={t("dashx.pulse.linkedinSent")}
                  value={liStats.sent.toLocaleString(dateLoc)}
                  unit={t("dashx.pulse.messagesUnit")}
                  hint={t("dashx.pulse.linkedinSentHint")}
                  tone="neutral"
                />
                <PulseStat
                  label={t("dashx.pulse.linkedinReplies")}
                  value={liStats.replied.toLocaleString(dateLoc)}
                  unit={t("dashx.pulse.repliesUnit")}
                  hint={t("dashx.pulse.linkedinRepliesHint")}
                  tone={liStats.replied > 0 ? "success" : "neutral"}
                />
              </div>
              {/* Email column */}
              <div className="divide-y" style={{ borderColor: C.border }}>
                <PulseStat
                  label={t("dashx.pulse.emailsSent")}
                  value={emailStats.sent.toLocaleString(dateLoc)}
                  unit={t("dashx.pulse.messagesUnit")}
                  hint={t("dashx.pulse.emailsSentHint")}
                  tone="neutral"
                />
                <PulseStat
                  label={t("dashx.pulse.emailReplies")}
                  value={emailStats.replied.toLocaleString(dateLoc)}
                  unit={t("dashx.pulse.repliesUnit")}
                  hint={t("dashx.pulse.emailRepliesHint")}
                  tone={emailStats.replied > 0 ? "success" : "neutral"}
                />
              </div>
              {/* Calls column */}
              <div className="divide-y" style={{ borderColor: C.border }}>
                <PulseStat
                  label={t("dashx.pulse.phonesPending")}
                  value={callsPending.toLocaleString(dateLoc)}
                  unit={t("dashx.pulse.phonesUnit")}
                  hint={t("dashx.pulse.phonesPendingHint")}
                  tone={callsPending > 0 ? "warning" : "neutral"}
                />
                <PulseStat
                  label={t("dashx.pulse.phonesMade")}
                  value={callsMade.toLocaleString(dateLoc)}
                  unit={t("dashx.pulse.phonesUnit")}
                  hint={t("dashx.pulse.phonesMadeHint", { answered: data.callsBreakdown.answered })}
                  tone={callsMade > 0 ? "success" : "neutral"}
                />
              </div>
            </div>
          );
        })()}
      </section>

      {/* ─── Funnel + Donut · 7/5 split (was 5/4/3 with an Insights col,
          the Insights are now surfaced as the Highlight banner above). */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Panel title={t("dashx.funnel.title")} subtitle={t("dashx.funnel.subtitle")} className="lg:col-span-7" glow
            actionHref={withFilters("/?tab=campaigns", filters)} actionLabel={t("dashx.panel.openCampaigns")}
            insightEyebrow={t("dashx.insight.eyebrow")}
            insight={(() => {
              const sent = data.linkedinConnections?.sent ?? 0;
              const accepted = data.linkedinConnections?.accepted ?? 0;
              const replied = data.funnel.find(s => s.stage === "replied")?.count ?? 0;
              const won = data.funnel.find(s => s.stage === "won")?.count ?? 0;
              if (sent < 3) return null;
              const acceptPct = sent > 0 ? Math.round((accepted / sent) * 100) : 0;
              const replyPct = accepted > 0 ? Math.round((replied / accepted) * 100) : 0;
              return t("dashx.funnel.insight", { acceptPct, replyPct, won });
            })()}>
            <Funnel {...funnel18n} stages={data.funnel.map(s => ({ ...s, stage: t(`dashx.funnel.stage.${stageKey(s.stage)}`) || s.stage }))} />
          </Panel>
          <Panel title={t("dashx.donut.title")} subtitle={t("dashx.donut.subtitle")} className="lg:col-span-5" glow
            actionHref="/inbox" actionLabel={t("dashx.panel.openInbox")}
            insightEyebrow={t("dashx.insight.eyebrow")}
            insight={(() => {
              const totalReplies = donutSlices.reduce((a, s) => a + s.value, 0);
              if (totalReplies < 3) return null;
              const positives = (data.replyClassCounts["positive"] ?? 0) + (data.replyClassCounts["meeting_intent"] ?? 0);
              const positivesPct = totalReplies > 0 ? Math.round((positives / totalReplies) * 100) : 0;
              return t("dashx.donut.insight", { positivesPct, positives, total: totalReplies });
            })()}>
            <Donut
              data={donutSlices}
              centerLabel={t("dashx.donut.centerReplies")}
              emptyLabel={t("dashx.donut.empty")}
              vsPriorLabel={t("dashx.kpi.vsPrior")}
            />
          </Panel>
        </div>
      </section>

      {/* ─── 30-day trend (full width). Boss feedback round 3 #8 wanted
          the trend to be more legible; promoted to its own row so the
          line chart has room to render axis labels + tooltip. */}
      <section>
        <div className="grid grid-cols-1 gap-3">
          <Panel title={t("dashx.trend.title")} subtitle={t("dashx.trend.subtitle")} glow
            actionHref={withFilters("/?tab=campaigns", filters)} actionLabel={t("dashx.panel.openCampaigns")}
            insightEyebrow={t("dashx.insight.eyebrow")}
            insight={(() => {
              const n = trend30d.sent.length;
              if (n < 4) return null;
              const half = Math.floor(n / 2);
              const sum = (a: number[], s: number, e: number) => a.slice(s, e).reduce((x, y) => x + y, 0);
              const sentFirst = sum(trend30d.sent, 0, half);
              const sentSecond = sum(trend30d.sent, half, n);
              if (sentFirst + sentSecond === 0) return null;
              const delta = sentFirst === 0
                ? 100
                : Math.round(((sentSecond - sentFirst) / sentFirst) * 100);
              const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
              return t(`dashx.trend.insight.${dir}`, { pct: Math.abs(delta) });
            })()}>
            <MultiLineChart
              todayLabel={t("dashx.trend.today")}
              recentLabel={t("dashx.trend.daysAgo")}
              priorLabel={t("dashx.trend.priorPeriod")}
              resetLabel={t("dashx.trend.resetZoom")}
              totalLabel={t("dashx.trend.total")}
              series={[
                { name: t("dashx.trend.sent"),      color: C.seriesSent,     data: trend30d.sent },
                { name: t("dashx.trend.replies"),   color: C.seriesReplies,  data: trend30d.replies },
                { name: t("dashx.trend.positives"), color: C.seriesPositive, data: trend30d.positive },
              ]}
              priorSeries={[
                { name: t("dashx.trend.sent"),      color: C.seriesSent,     data: data.trendPrior.sent },
                { name: t("dashx.trend.replies"),   color: C.seriesReplies,  data: data.trendPrior.replies },
                { name: t("dashx.trend.positives"), color: C.seriesPositive, data: data.trendPrior.positive },
              ]}
            />
          </Panel>
        </div>
      </section>
      {/* ─── Heatmap (full width). #9 wanted the heatmap bigger; standalone
          row + 22px cells lets the operator read the peak hours from
          across the room. */}
      <section>
        <div className="grid grid-cols-1 gap-3">
          <Panel title={t("dashx.heat.title")} subtitle={t("dashx.heat.subtitle")} glow
            actionHref="/inbox" actionLabel={t("dashx.panel.openInbox")}
            insightEyebrow={t("dashx.insight.eyebrow")}
            insight={(() => {
              let peakDay = 0; let peakHour = 0; let peak = 0;
              for (let d = 0; d < data.heatmap.length; d++) {
                const row = data.heatmap[d];
                for (let h = 0; h < row.length; h++) {
                  if (row[h] > peak) { peak = row[h]; peakDay = d; peakHour = h; }
                }
              }
              if (peak < 2) return null;
              const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
              return t("dashx.heat.insight", {
                day: t(`dashx.day.${dayKeys[peakDay]}`),
                hour: peakHour,
                count: peak,
              });
            })()}>
            <Heatmap
              matrix={data.heatmap}
              byChannel={data.heatmapByChannel}
              days={["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(d => t(`dashx.day.${d}`))}
              unitLabel={t("dashx.heat.unitReplies")}
              legendMin={t("dashx.heat.legendMin")}
              legendMax={t("dashx.heat.legendMax")}
              channelLabels={{
                all:      t("dashx.heat.chAll"),
                linkedin: t("dashx.ch.linkedin"),
                email:    t("dashx.ch.email"),
                call:     t("dashx.ch.call"),
              }}
              bestWindowLabel={t("dashx.heat.bestWindow")}
              bestWindowSubtitle={t("dashx.heat.bestWindowSubtitle")}
              bestWindowEmpty={t("dashx.heat.bestWindowEmpty")}
              peakLabel={t("dashx.heat.peakLabel")}
            />
          </Panel>
        </div>
      </section>

      </section>
      )}
      {/* ═══ CHAPTER 2 · ICPs ═══════════════════════════════════════════════
          Which ideal profiles convert best · which channel fits each one.
          Reading order: leaderboard first (the natural entry point), then
          the matrix below for the deeper 2D analysis. */}
      {filters.tab === "icps" && (
      <section className="space-y-6 pt-3">

      <section>
        {(() => {
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
        <Panel
          title={t("dashx.tbl.icp.title")}
          subtitle={t("dashx.tbl.icp.subtitle")}
          actionHref="/icp"
          actionLabel={t("dashx.panel.openIcps")}
          glow
          insightEyebrow={t("dashx.insight.eyebrow")}
          insight={(() => {
            const eligible = data.icpPerformance.filter(i => i.contacted >= 10 && i.id !== "_unknown");
            if (eligible.length < 2) return null;
            const sorted = [...eligible].sort((a, b) => b.conversionRate - a.conversionRate);
            const top = sorted[0];
            return t("dashx.icp.insight", { name: top.name, rate: top.conversionRate, total: eligible.length });
          })()}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">{t("dashx.tbl.col.icp")}</Th>
                <Th align="right">{t("dashx.tbl.col.leads")}</Th>
                <Th align="left">{t("dashx.tbl.col.channels")}</Th>
                <Th align="right"><span title={t("dashx.tbl.col.totalTouchesHint")}>{t("dashx.tbl.col.totalTouches")}</span></Th>
                <Th align="right">{t("dashx.tbl.col.repliedFull")}</Th>
                <Th align="right">{t("dashx.tbl.col.positiveFull")}</Th>
                <Th align="right"><span title={t("dashx.tbl.col.respPctHint")}>{t("dashx.tbl.col.respPctFull")}</span></Th>
                <Th align="right"><span title={t("dashx.tbl.col.convPctHint")}>{t("dashx.tbl.col.convPctFull")}</span></Th>
                <Th align="left">{t("dashx.tbl.col.trend14")}</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.icpPerformance.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters} kindKey="icps" t={t} /></td></tr>
              ) : (() => {
                // Scale rate bars against the table's own leader so the #1
                // row hits full width; relative ranking reads at a glance.
                const maxConv = Math.max(1, ...data.icpPerformance.map(i => i.conversionRate));
                const maxResp = Math.max(1, ...data.icpPerformance.map(i => i.responseRate));
                return data.icpPerformance.map((icp, idx) => {
                  const totalTouches = (icp.linkedinSent ?? 0) + (icp.linkedinMsg ?? 0) + (icp.emailTouch ?? 0) + (icp.callTouch ?? 0);
                  return (
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
                            <Link href={`/leads/ticket/${icp.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{icp.name}</Link>
                          ) : (
                            <span style={{ color: C.textMuted }}>{t("dashx.tbl.icp.unknown")}</span>
                          )}
                        </div>
                      </Td>
                      <NumCell value={icp.leads} />
                      <td className="px-3 py-2">
                        <ChannelTouches
                          linkedinSent={icp.linkedinSent}
                          linkedinMsg={icp.linkedinMsg}
                          emailTouch={icp.emailTouch}
                          callTouch={icp.callTouch}
                          labels={{
                            linkedinSent: t("dashx.touch.linkedinSent"),
                            linkedinMsg: t("dashx.touch.linkedinMsg"),
                            emailTouch: t("dashx.touch.emailTouch"),
                            callTouch: t("dashx.touch.callTouch"),
                          }}
                        />
                      </td>
                      <NumCell value={totalTouches} bold />
                      <NumCell value={icp.replied} />
                      <NumCell value={icp.positive} accent={icp.positive > 0 ? C.green : undefined} bold />
                      <td className="px-3 py-2"><div className="flex justify-end" title={t("dashx.tbl.col.respPctHint")}><RateBar value={icp.responseRate} max={maxResp} color="#7C3AED" /></div></td>
                      <td className="px-3 py-2"><div className="flex justify-end" title={t("dashx.tbl.col.convPctHint")}><RateBar value={icp.conversionRate} max={maxConv} color={C.green} /></div></td>
                      <td className="px-3 py-2"><InlineSpark data={icp.spark} color="#7C3AED" /></td>
                      <td className="pr-3" style={{ color: C.textDim }}>{icp.id !== "_unknown" && <Link href={`/leads/ticket/${icp.id}`} className="inline-flex"><ArrowRight size={12} /></Link>}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* ICP × Channel matrix — sits AFTER the leaderboard now. The table
          is the natural entry point; the matrix is the 2D drilldown. */}
      <section>
        <Panel
          title={t("dashx.matrix.title")}
          subtitle={t("dashx.matrix.subtitle")}
          glow
          insightEyebrow={t("dashx.insight.eyebrow")}
          insight={(() => {
            const valid = data.matrix.cells.filter(c => c.replyRate !== null);
            if (valid.length < 2) return null;
            const best = valid.reduce((a, b) => (a.replyRate ?? 0) > (b.replyRate ?? 0) ? a : b);
            const icp = data.matrix.icps.find(i => i.id === best.icpId);
            if (!icp || best.replyRate === null) return null;
            const chLabel = t(`dashx.ch.${best.channel}`) === `dashx.ch.${best.channel}` ? best.channel : t(`dashx.ch.${best.channel}`);
            return t("dashx.matrix.insight", {
              icp: icp.name,
              ch: chLabel,
              rate: Math.round(best.replyRate * 100),
            });
          })()}
        >
          <IcpChannelMatrix matrix={data.matrix} locale={locale} />
        </Panel>
      </section>

      </section>
      )}
      {/* ═══ CHAPTER 3 · CAMPAIGNS ═══════════════════════════════════════════
          Which sequences are working · per-step performance reveals which
          message is killing the funnel. Pause / rewrite candidates surface
          via the lagging callout. */}
      {filters.tab === "campaigns" && (
      <section className="space-y-6 pt-3">

      <section>
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
          ];
          // baseParams covers tab=campaigns + inherited from/to/etc; the
          // client chip just appends its own camp_status.
          const baseParams = new URLSearchParams();
          baseParams.set("tab", "campaigns");
          if (filters.from) baseParams.set("from", filters.from);
          if (filters.to) baseParams.set("to", filters.to);
          if (filters.campaignNames?.length) baseParams.set("campaigns", filters.campaignNames.join("|"));
          if (filters.icpIds?.length) baseParams.set("icps", filters.icpIds.join("|"));
          if (filters.sellerIds?.length) baseParams.set("sellers", filters.sellerIds.join("|"));
          return <CampStatusChipsLive tabs={tabs} initial={filters.campStatus} baseParams={baseParams.toString()} />;
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
        {/* Stagnant alert — surfaces active campaigns with ≥10 leads and
            0% conversion. These are the ones quietly burning lead inventory
            and should be reviewed or paused. Boss feedback 2026-05-27. */}
        {(() => {
          const stagnant = data.campaignPerformance.filter(c =>
            c.status === "active" && c.leads >= 10 && c.conversionRate === 0
          );
          if (stagnant.length === 0) return null;
          const top3 = stagnant.slice(0, 3);
          return (
            <div className="mb-3 rounded-xl border p-3.5 flex items-start gap-3"
              style={{
                borderColor: "color-mix(in srgb, #DC2626 35%, transparent)",
                background: "linear-gradient(135deg, color-mix(in srgb, #DC2626 8%, transparent), transparent 70%)",
              }}>
              <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "color-mix(in srgb, #DC2626 16%, transparent)", color: "#DC2626" }}>
                <Activity size={13} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold" style={{ color: C.textPrimary }}>
                  {t("dashx.camp.stagnantTitle", { n: stagnant.length })}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
                  {t("dashx.camp.stagnantHint")}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {top3.map(c => (
                    <Link key={c.name}
                      href={`/dashboard/campaign/${encodeURIComponent(c.name)}`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md border hover:bg-black/[0.03] transition-colors"
                      style={{ borderColor: C.border, color: C.textBody, background: C.card }}>
                      <span className="w-1 h-1 rounded-full" style={{ background: "#DC2626" }} />
                      {c.name}
                      <span className="tabular-nums" style={{ color: C.textDim }}>· {c.leads} leads</span>
                    </Link>
                  ))}
                  {stagnant.length > 3 && (
                    <span className="text-[11px]" style={{ color: C.textDim }}>+{stagnant.length - 3}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        <Panel
          title={t("dashx.tbl.camp.title")}
          subtitle={t("dashx.tbl.camp.subtitle")}
          actionHref="/campaigns"
          actionLabel={t("dashx.panel.openCampaignsPage")}
          glow
          insightEyebrow={t("dashx.insight.eyebrow")}
          insight={(() => {
            const eligible = data.campaignPerformance.filter(c => c.leads >= 10);
            if (eligible.length < 2) return null;
            const stagnant = data.campaignPerformance.filter(c => c.leads >= 10 && c.conversionRate === 0 && c.status === "active").length;
            const top = [...eligible].sort((a, b) => b.conversionRate - a.conversionRate)[0];
            return t("dashx.camp.insight", { name: top.name, rate: top.conversionRate, stagnant });
          })()}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                <Th align="left">{t("dashx.tbl.col.campaign")}</Th>
                <Th align="right">{t("dashx.tbl.col.leads")}</Th>
                <Th align="right">{t("dashx.tbl.col.uncontacted")}</Th>
                <Th align="left">{t("dashx.tbl.col.sentByChannel")}</Th>
                <Th align="right">{t("dashx.tbl.col.replied")}</Th>
                <Th align="right">{t("dashx.tbl.col.positive")}</Th>
                <Th align="right">{t("dashx.tbl.col.convPct")}</Th>
                <Th align="left">{t("dashx.tbl.col.status")}</Th>
                <Th align="left">{t("dashx.tbl.col.trend14")}</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody className="camp-rows">
              {data.campaignPerformance.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters} kindKey="campaigns" t={t} /></td></tr>
              ) : (() => {
                // Rank/highlights stay computed against the FULL list because
                // the active filter is now client-side (CSS visibility). #1
                // by conversion stays #1 regardless of which chip is on.
                const ranked = [...data.campaignPerformance].sort((a, b) => b.conversionRate - a.conversionRate);
                const rankByName = new Map(ranked.map((c, idx) => [c.name, idx]));
                const maxConv = Math.max(1, ...data.campaignPerformance.map(c => c.conversionRate));
                return data.campaignPerformance.map((c: any) => {
                  const idx = rankByName.get(c.name) ?? 0;
                  return (
                    <tr key={c.name} data-camp-status={c.status} className="border-t hover:bg-black/[0.02] transition-colors group" style={{ borderColor: C.border }}>
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
                      <NumCell value={c.leads} />
                      <NumCell value={c.uncontactedLeads ?? 0} accent={(c.uncontactedLeads ?? 0) > 0 ? "#D97706" : undefined} />
                      <td className="px-3 py-2">
                        <ChannelTouches
                          linkedinSent={c.sentLinkedin ?? 0}
                          linkedinMsg={0}
                          emailTouch={c.sentEmail ?? 0}
                          callTouch={c.sentCall ?? 0}
                          labels={{
                            linkedinSent: t("dashx.touch.linkedinSent"),
                            linkedinMsg: t("dashx.touch.linkedinMsg"),
                            emailTouch: t("dashx.touch.emailTouch"),
                            callTouch: t("dashx.touch.callTouch"),
                          }}
                        />
                      </td>
                      <NumCell value={c.replied} />
                      <NumCell value={c.positive} accent={c.positive > 0 ? C.green : undefined} bold />
                      <td className="px-3 py-2"><div className="flex justify-end"><RateBar value={c.conversionRate} max={maxConv} color={C.green} /></div></td>
                      <td className="px-3 py-2"><StatusBadge status={c.status} t={t} /></td>
                      <td className="px-3 py-2"><InlineSpark data={c.spark} color="#0A66C2" /></td>
                      <td className="pr-3" style={{ color: C.textDim }}><Link href={withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters)} className="inline-flex"><ArrowRight size={12} /></Link></td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* Step performance — sits inside CAMPAIGNS chapter because the
          "which step is broken" question is per-sequence diagnostic. */}
      <section>
        <Panel
          title={t("dashx.step.title")}
          subtitle={t("dashx.step.subtitle")}
          glow
          insightEyebrow={t("dashx.insight.eyebrow")}
          insight={(() => {
            const eligible = (data.stepPerformance as Array<{ step: number; replyRate: number | null }>)
              .filter(s => s.step > 0 && s.replyRate !== null);
            if (eligible.length < 2) return null;
            const worst = [...eligible].sort((a, b) => (a.replyRate ?? 0) - (b.replyRate ?? 0))[0];
            return t("dashx.step.insight", { step: worst.step + 1, rate: worst.replyRate ?? 0 });
          })()}
        >
          <StepPerformance steps={data.stepPerformance} locale={locale} />
        </Panel>
      </section>

      </section>
      )}
      {/* ═══ CHAPTER 4 · CHANNELS ═══════════════════════════════════════════
          How each outreach channel performs · when in the week replies
          actually arrive. Channel breakdown lives here (not Overview)
          because it answers "which channel works" — a channel question. */}
      {filters.tab === "channels" && (
      <section className="space-y-4 pt-2">

      <section>
        <SectionHeader icon={Send} title={t("dashx.channels.title")} subtitle={t("dashx.channels.subtitle")} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* LinkedIn Connections (invite leg) — boss-feedback 2026-05-27.
              Pulls sent + accepted counts from the funnel stages so it
              shares the canonical numbers with the funnel chart above. */}
          {(() => {
            const liSent = data.linkedinConnections?.sent ?? 0;
            const liAccepted = data.linkedinConnections?.accepted ?? 0;
            return (
              <LinkedInConnectionsCard
                sent={liSent}
                accepted={liAccepted}
                labels={{
                  channel: t("dashx.channels.linkedinConnections"),
                  eyebrow: t("dashx.channels.channelLabel"),
                  sent: t("dashx.channels.sent"),
                  accepted: t("dashx.channels.accepted"),
                  acceptRate: t("dashx.channels.acceptRate"),
                  cta: t("dashx.panel.openCampaigns"),
                }}
              />
            );
          })()}
          {data.channelBreakdown.length === 0 ? (
            <EmptyHint>{t("dashx.channels.empty")}</EmptyHint>
          ) : (() => {
            const topChannel = [...data.channelBreakdown]
              .sort((a, b) => b.responseRate - a.responseRate || b.positive - a.positive)[0]?.channel;
            return data.channelBreakdown.map(ch => {
              // Calls get the dedicated 5-sub-count card; other channels
              // keep the standard ChannelCard.
              if (ch.channel === "call") {
                return (
                  <CallsCard
                    key={ch.channel}
                    pending={data.callsBreakdown.pending}
                    completed={data.callsBreakdown.completed}
                    answered={data.callsBreakdown.answered}
                    positive={data.callsBreakdown.positive}
                    negative={data.callsBreakdown.negative}
                    total={data.callsBreakdown.total}
                    labels={{
                      channel: t("dashx.ch.call"),
                      eyebrow: t("dashx.channels.channelLabel"),
                      pending:   t("dashx.calls.pending"),
                      completed: t("dashx.calls.completed"),
                      answered:  t("dashx.calls.answered"),
                      positive:  t("dashx.calls.positive"),
                      negative:  t("dashx.calls.negative"),
                      cta:       t("dashx.calls.openQueue"),
                      totalUnit: t("dashx.calls.totalUnit"),
                    }}
                  />
                );
              }
              return (
                <ChannelCard
                  key={ch.channel}
                  row={ch}
                  isTop={ch.channel === topChannel && data.channelBreakdown.length > 1}
                  t={t}
                  topLabel={t("dashx.channels.topChannel")}
                />
              );
            });
          })()}
        </div>
      </section>

      {/* ─── Channel comparison bar chart — VISUAL ranking of channels by
          reply rate. Replaces the prior 30d trend + heatmap that lived
          here (those weren't channel-specific so they moved up to Overview).
          Bars are sorted by reply rate desc; length-encoded against the
          top performer so the leader hits full width. */}
      <section>
        <Panel
          title={t("dashx.channels.compTitle")}
          subtitle={t("dashx.channels.compSubtitle")}
          glow
          insightEyebrow={t("dashx.insight.eyebrow")}
          insight={(() => {
            const eligible = data.channelBreakdown.filter(c => c.contacted >= 5);
            if (eligible.length < 2) return null;
            const sorted = [...eligible].sort((a, b) => b.responseRate - a.responseRate);
            const best = sorted[0]; const worst = sorted[sorted.length - 1];
            const gap = best.responseRate - worst.responseRate;
            if (gap < 5) return null;
            const bestLabel = t(`dashx.ch.${best.channel}`) === `dashx.ch.${best.channel}` ? best.channel : t(`dashx.ch.${best.channel}`);
            const worstLabel = t(`dashx.ch.${worst.channel}`) === `dashx.ch.${worst.channel}` ? worst.channel : t(`dashx.ch.${worst.channel}`);
            return t("dashx.channels.compInsight", { best: bestLabel, worst: worstLabel, gap });
          })()}
        >
          <ChannelComparison channels={data.channelBreakdown} t={t} emptyLabel={t("dashx.channels.empty")} />
        </Panel>
      </section>

      </section>
      )}
      {/* ═══ CHAPTER 5 · SELLERS ═══════════════════════════════════════════
          Who's moving the pipeline. Ranking uses reply rate normalized by
          contacted volume (≥20 floor) so the top isn't decided by who
          happened to inherit more leads. */}
      {filters.tab === "sellers" && (
      <section className="space-y-6 pt-3">

      <section>
        {(() => {
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
        <Panel
          title={t("dashx.tbl.seller.title")}
          subtitle={t("dashx.tbl.seller.subtitle")}
          actionHref="/admin"
          actionLabel={t("dashx.panel.openTeam")}
          glow
          insightEyebrow={t("dashx.insight.eyebrow")}
          insight={(() => {
            const eligible = data.sellerPerformance.filter(s => s.contacted >= 20);
            if (eligible.length < 2) return null;
            const sorted = [...eligible].sort((a, b) => b.responseRate - a.responseRate);
            const top = sorted[0]; const bottom = sorted[sorted.length - 1];
            const gap = top.responseRate - bottom.responseRate;
            return t("dashx.seller.insight", { name: top.name, rate: top.responseRate, gap });
          })()}
        >
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
      )}
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

/** Panel — premium card with a navy-ink header and gold title (boss
 * feedback 2026-05-27 "que sea negra con el titulo en oro"). Optional
 * actionHref renders a gold CTA pill in the header right slot — used by
 * each chart panel to deep-link into the surface where the data lives. */
function Panel({
  title, subtitle, children, className, actionHref, actionLabel, insight, insightEyebrow, glow,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  actionHref?: string;
  actionLabel?: string;
  /** Optional one-line auto-derived narrative rendered as a gold-accented
   * footer strip below the chart body. Null/undefined → no footer. */
  insight?: string | null;
  /** Eyebrow text rendered above the insight body (locale-aware, supplied
   * by the call site so Panel stays presentational). */
  insightEyebrow?: string;
  /** When true, gives the panel a stronger ambient gold halo + hover-lift.
   * Used for the marquee charts (Funnel, Donut) so they feel "lit". */
  glow?: boolean;
}) {
  const baseShadow = glow
    ? "0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px color-mix(in srgb, var(--brand, #c9a83a) 7%, transparent), 0 16px 34px -20px color-mix(in srgb, var(--brand, #c9a83a) 38%, transparent)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  return (
    <div
      className={`group rounded-2xl border overflow-hidden ${glow ? "transition-shadow duration-200 hover:shadow-[0_18px_42px_-20px_color-mix(in_srgb,var(--brand,#c9a83a)_55%,transparent)]" : ""} ${className ?? ""}`}
      style={{
        backgroundColor: C.card,
        borderColor: glow ? `color-mix(in srgb, ${gold} 22%, ${C.border})` : C.border,
        boxShadow: baseShadow,
      }}
    >
      {(title || subtitle) && (
        <div
          className="px-4 py-3 flex items-center justify-between gap-3"
          style={{
            background: "linear-gradient(135deg, #0B0F1A 0%, #111827 100%)",
            color: "white",
          }}
        >
          <div className="min-w-0">
            {title && (
              <p
                className="text-[13.5px] font-bold tracking-[-0.005em]"
                style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
              >
                {title}
              </p>
            )}
            {subtitle && (
              <p className="text-[10.5px] mt-0.5 truncate" style={{ color: "color-mix(in srgb, white 60%, transparent)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {actionHref && (
            <Link
              href={actionHref}
              className="shrink-0 inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1 rounded-md transition-opacity hover:opacity-85"
              style={{
                color: gold,
                backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)",
              }}
            >
              {actionLabel ?? "Open"} <ArrowRight size={11} />
            </Link>
          )}
        </div>
      )}
      <div className="p-3.5">{children}</div>
      {insight && (
        <div
          className="px-5 py-3 flex items-start gap-2.5 border-t"
          style={{
            borderColor: `color-mix(in srgb, ${gold} 26%, ${C.border})`,
            background: `linear-gradient(90deg, color-mix(in srgb, ${gold} 16%, ${C.card}) 0%, color-mix(in srgb, ${gold} 4%, ${C.card}) 80%)`,
          }}
        >
          <span
            aria-hidden
            className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-px"
            style={{
              background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
              color: N.ink,
              boxShadow: `0 2px 10px color-mix(in srgb, ${gold} 32%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
            }}
          >
            <Sparkles size={12} />
          </span>
          <div className="flex-1 min-w-0">
            {insightEyebrow && (
              <p className="text-[9.5px] font-bold uppercase tracking-[0.18em]" style={{ color: gold }}>
                {insightEyebrow}
              </p>
            )}
            <p
              className="text-[13px] leading-snug font-semibold mt-0.5"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
            >
              {insight}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-xs"
      style={{ borderColor: C.border, color: C.textMuted }}>{children}</div>
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
function PulseStat({ label, value, unit, hint, tone }: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone: "neutral" | "warning" | "success";
}) {
  const accent = tone === "warning" ? "#D97706"
    : tone === "success" ? C.green
    : C.textPrimary;
  // Tone tints the left-edge rail too so the eye picks up "OK / warn /
  // win" without reading the number first.
  const rail = tone === "success" ? `color-mix(in srgb, ${C.green} 90%, transparent)`
    : tone === "warning" ? "#D97706"
    : `color-mix(in srgb, ${gold} 55%, transparent)`;
  return (
    <div className="relative px-5 py-4 flex flex-col gap-0.5 group">
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full transition-opacity opacity-70 group-hover:opacity-100"
        style={{ background: rail }}
      />
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
