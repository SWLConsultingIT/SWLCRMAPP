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
import TabFilterBar from "@/components/dashboard/TabFilterBar";
import SellerRow from "@/components/dashboard/SellerRowExpand";
import ChartFilterChips from "@/components/dashboard/ChartFilterChips";
import { getSupabaseService } from "@/lib/supabase-service";
import FreshnessChip from "@/components/dashboard/FreshnessChip";
import DashboardKeyboardShortcuts from "@/components/dashboard/DashboardKeyboardShortcuts";
import SwlSignature from "@/components/dashboard/SwlSignature";
import KpiCard from "@/components/dashboard/KpiCard";
import Funnel from "@/components/dashboard/Funnel";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import ActivityStrip from "@/components/dashboard/ActivityStrip";
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

/** Returns a "Scoped to: X" label echoing the active tab filters, or null
 * if no filter is applied. Lets each chart's header advertise what's
 * filtering it without having to look back at the filter bar (boss
 * feedback 2026-05-28). */
function buildScopeLabel(
  filters: { campaignNames: string[]; icpIds: string[]; sellerIds: string[] },
  options: { campaigns: { id: string; label: string }[]; icps: { id: string; label: string }[]; sellers: { id: string; label: string }[] },
  labels: { scopedTo: string; campaign: string; campaignsPlural: string; icp: string; icpsPlural: string; seller: string; sellersPlural: string }
): string | null {
  const parts: string[] = [];
  const camps = filters.campaignNames ?? [];
  const icps = filters.icpIds ?? [];
  const sellers = filters.sellerIds ?? [];
  if (camps.length === 1) parts.push(`${labels.campaign}: ${camps[0]}`);
  else if (camps.length > 1) parts.push(`${camps.length} ${labels.campaignsPlural}`);
  if (icps.length === 1) {
    const name = options.icps.find(o => o.id === icps[0])?.label ?? icps[0];
    parts.push(`${labels.icp}: ${name}`);
  } else if (icps.length > 1) parts.push(`${icps.length} ${labels.icpsPlural}`);
  if (sellers.length === 1) {
    const name = options.sellers.find(o => o.id === sellers[0])?.label ?? sellers[0];
    parts.push(`${labels.seller}: ${name}`);
  } else if (sellers.length > 1) parts.push(`${sellers.length} ${labels.sellersPlural}`);
  if (parts.length === 0) return null;
  return `${labels.scopedTo}: ${parts.join(" · ")}`;
}

// Never cached — without this, clicking the period chips changes the URL
// but Next.js serves the cached server response and the page shows stale
// numbers. Memory: feedback_dashboard_no_cache — reliability surfaces and
// every detail page already follow this; the main dashboard was missing it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DASHBOARD_TABS = ["today", "overview", "icps", "campaigns", "channels", "sellers"] as const;
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
    : "today";
  return {
    from: get("from"),
    to: get("to"),
    campaignNames: getList("campaigns"),
    icpIds: getList("icps"),
    sellerIds: getList("sellers"),
    /** Tab selection for the campaign leaderboard. Default = "active" so
     * historical clutter doesn't bury the campaigns currently running. */
    campStatus: (get("camp_status") as "active" | "paused" | "completed" | "all" | null) ?? "active",
    /** Active dashboard tab — drives which chapter renders. Default = today
     * (boss feedback 2026-05-28: the action list should be the landing
     * screen, not the metrics). */
    tab,
  };
}

// Per-tab filter options — lightweight universe query so the chip
// dropdowns show every available campaign/ICP/seller, not just the ones
// surviving the current filter. Only runs for the 3 tabs that expose the
// TabFilterBar (Campaigns / Channels / Sellers); Overview / ICPs skip it.
async function loadFilterOptions(bioId: string | null) {
  try {
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
  } catch (e) {
    console.error("[dashboard] loadFilterOptions failed:", e);
    return { campaigns: [], sellers: [], icps: [] };
  }
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
  // Always load filter options — they feed both the tab-level TabFilterBar
  // AND the per-chart ChartFilterChips (Donut on Overview also needs them).
  // 3 cheap queries, no point conditionally skipping.
  const [data, t, locale, filterOptions] = await Promise.all([
    getDashboardData(filters),
    getT(),
    getServerLocale(),
    loadFilterOptions(bioId),
  ]);
  const tabFilterLabels = {
    campaigns: t("dashx.filters.campaigns"),
    icps: t("dashx.filters.icps"),
    sellers: t("dashx.filters.sellers"),
    clear: t("dashx.filters.clear"),
    empty: t("dashx.filters.noOptions"),
    applied: t("dashx.filters.applied"),
  };
  // Tab-level scope echo — set when ANY filter is active so each chart
  // header can append "· Scoped to: X" to its subtitle (boss 2026-05-28:
  // wants per-chart filter visibility without per-chart dropdowns).
  const scopeLabel = buildScopeLabel(
    { campaignNames: filters.campaignNames, icpIds: filters.icpIds, sellerIds: filters.sellerIds },
    filterOptions,
    {
      scopedTo: t("dashx.scope.scopedTo"),
      campaign: t("dashx.scope.campaign"),
      campaignsPlural: t("dashx.scope.campaignsPlural"),
      icp: t("dashx.scope.icp"),
      icpsPlural: t("dashx.scope.icpsPlural"),
      seller: t("dashx.scope.seller"),
      sellersPlural: t("dashx.scope.sellersPlural"),
    }
  );
  const withScope = (subtitle: string) => scopeLabel ? `${subtitle} · ${scopeLabel}` : subtitle;
  const dateLoc = locale === "es" ? "es-AR" : "en-US";
  // Locale-bound bundles spread onto every KpiCard / Funnel so we don't
  // forget to pass them and have hardcoded Spanish leak through.
  const kpi18n = { vsPriorLabel: t("dashx.kpi.vsPrior"), noPriorLabel: t("dashx.kpi.noPrior") };
  const funnel18n = {
    fromPrevLabel: t("dashx.funnel.fromPrev"),
    priorLabel: t("dashx.funnel.priorLabel"),
    vsPriorLabel: t("dashx.funnel.vsPriorShort"),
  };

  const { headline, deltas, trend30d, trendPrior } = data;

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

      {/* ─── Welcome hero — context-aware.
          Today tab: SWL pro welcome hero with live pulse + animated glow.
          Other tabs: original "Sales Engine / Your pipeline in depth"
          analytical hero (the data tabs need the analytical framing).
          Boss feedback 2026-05-28: the landing screen must read pro and
          alive; the analytical hero is wrong copy for the action list. */}
      {filters.tab === "today" ? (
      <header
        className="relative rounded-2xl overflow-hidden px-5 sm:px-8 py-6 sm:py-8"
        style={{
          background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
          border: `1px solid color-mix(in srgb, ${gold} 32%, ${N.hairline})`,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 22%, transparent), 0 18px 40px -18px ${N.ink}`,
        }}
      >
        {/* Breathing radial glows */}
        <span aria-hidden
          className="absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full pointer-events-none hero-glow-breathe"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 28%, transparent) 0%, transparent 60%)` }} />
        <span aria-hidden
          className="absolute -bottom-32 -left-20 w-[360px] h-[360px] rounded-full pointer-events-none hero-glow-breathe-soft"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 16%, transparent) 0%, transparent 65%)` }} />
        {/* Top shimmer line — gold sweep that fades in/out */}
        <span aria-hidden
          className="absolute inset-x-0 top-0 h-[1.5px] pointer-events-none hero-glow-shimmer"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)` }} />

        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {/* Inline SWL mark — same logo the sidebar uses, scaled small.
                  Anchors the hero as official SWL surface. */}
              <span
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                style={{
                  background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 24%, #14182a) 0%, #1a1f30 100%)`,
                  border: `1px solid color-mix(in srgb, ${gold} 38%, transparent)`,
                  boxShadow: `0 0 18px color-mix(in srgb, ${gold} 22%, transparent), inset 0 1px 0 color-mix(in srgb, ${gold} 22%, transparent)`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
                  alt="SWL Consulting"
                  className="h-4 w-auto object-contain"
                  style={{ filter: "brightness(0) invert(1)" }}
                />
              </span>
              <div className="flex flex-col leading-tight">
                <span
                  className="text-[13px] font-bold tracking-[-0.01em]"
                  style={{ color: "white", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
                >
                  GrowthAI
                </span>
                <span
                  className="text-[9.5px] font-bold uppercase tracking-[0.22em]"
                  style={{ color: gold }}
                >
                  {t("dashx.hero.section")}
                </span>
              </div>
              <span
                className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 rounded-md ml-1"
                style={{
                  color: "#10B981",
                  backgroundColor: "color-mix(in srgb, #10B981 14%, transparent)",
                  border: "1px solid color-mix(in srgb, #10B981 30%, transparent)",
                }}
              >
                <span aria-hidden className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: "#10B981" }} />
                {t("dashx.todayHero.live")}
              </span>
            </div>
            <h1
              className="text-[28px] sm:text-[36px] font-bold tracking-[-0.025em] leading-[1.05]"
              style={{
                color: "white",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                textShadow: `0 2px 14px color-mix(in srgb, ${gold} 14%, transparent)`,
              }}
            >
              {t("dashx.today.heroTitle")}
            </h1>
            <p
              className="text-[13px] mt-2 max-w-[640px]"
              style={{ color: "color-mix(in srgb, white 65%, transparent)" }}
            >
              {t("dashx.today.heroDesc")}
            </p>

            {/* Live pulse strip — today's throughput from the trailing-30d
                array (index 29 = today's bucket). All three numbers live
                update on next render; no extra query needed. */}
            <div
              className="flex items-center gap-4 sm:gap-6 mt-5 flex-wrap"
              style={{ borderTop: `1px solid color-mix(in srgb, ${gold} 14%, transparent)`, paddingTop: 16 }}
            >
              <HeroPulseStat
                icon={Send}
                value={data.trend30d.sent[29] ?? 0}
                label={t("dashx.todayHero.sendsToday")}
                color="#5B9CFF"
              />
              <span className="text-[16px]" style={{ color: "color-mix(in srgb, white 14%, transparent)" }}>·</span>
              <HeroPulseStat
                icon={MessageSquare}
                value={data.trend30d.replies[29] ?? 0}
                label={t("dashx.todayHero.repliesToday")}
                color="#A78BFA"
              />
              <span className="text-[16px]" style={{ color: "color-mix(in srgb, white 14%, transparent)" }}>·</span>
              <HeroPulseStat
                icon={ThumbsUp}
                value={data.trend30d.positive[29] ?? 0}
                label={t("dashx.todayHero.positivesToday")}
                color="#34D399"
              />
            </div>
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
      ) : (
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
      )}

      {/* ─── Tab bar — sticky URL-driven nav. Actions moved to the welcome
          hero above, so this row is purely navigation. */}
      <Suspense fallback={<div className="h-12" />}>
        <ChapterNav
          items={[
            { id: "today",     number: 1, label: t("dashx.chapter.today") },
            { id: "overview",  number: 2, label: t("dashx.chapter.overview") },
            { id: "icps",      number: 3, label: t("dashx.chapter.icps") },
            { id: "campaigns", number: 4, label: t("dashx.chapter.campaigns") },
            { id: "channels",  number: 5, label: t("dashx.chapter.channels") },
            { id: "sellers",   number: 6, label: t("dashx.chapter.sellers") },
          ]}
        />
      </Suspense>

      {/* ─── Filter bar — sits below tabs because filters scope the active
          tab's content. Suspense boundary required for useSearchParams. */}
      <Suspense fallback={<div className="h-10" />}>
        <FiltersBar />
      </Suspense>

      {/* ═══ CHAPTER 1 · TODAY ═══════════════════════════════════════════
          Boss feedback 2026-05-28: "What to do today" should be the landing
          screen, not buried under metrics. The welcome hero now lives at
          the page top (context-aware on filters.tab); this section is
          just the action list. */}
      {filters.tab === "today" && (
      <section className="space-y-5 pt-3">
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
            stale:      { label: t("dashx.today.stale"),           hint: t("dashx.today.staleHint"),         cta: t("dashx.today.openLeads") },
          },
        }}
        data={data.todayLists}
      />
      </section>
      )}

      {/* ═══ CHAPTER 2 · OVERVIEW ═══════════════════════════════════════════ */}
      {filters.tab === "overview" && (
      <section className="space-y-8 pt-3">

      {/* ─── UNIFIED OVERVIEW · 3 bands inside a single chapter card so the
          eye reads it as one block instead of two competing cards. Boss
          follow-up 2026-05-28: General Overview + Pipeline Pulse were
          adjacent and visually fighting; merged here.
            Band A — Portfolio state (4 cards)
            Band B — Outcomes & Rates (5 cards)
            Band C — Channel Throughput (sub-card with navy header) */}
      <section className="rounded-2xl border overflow-hidden relative"
        style={{
          borderColor: `color-mix(in srgb, ${gold} 18%, ${C.border})`,
          backgroundColor: C.card,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 14%, transparent), 0 6px 18px -10px ${N.ink}`,
        }}>
        <div className="relative px-4 py-2.5 flex items-center gap-2 overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
            borderBottom: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
          }}>
          <span aria-hidden className="absolute -top-10 -left-10 w-32 h-32 rounded-full pointer-events-none"
            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 20%, transparent) 0%, transparent 65%)` }} />
          <span className="relative w-5 h-5 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
              color: N.ink,
              boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 32%, transparent)`,
            }}>
            <Activity size={11} />
          </span>
          <span className="relative text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {t("dashx.overview.title")}
          </span>
          <span className="relative text-[10.5px]" style={{ color: "color-mix(in srgb, white 50%, transparent)" }}>
            · {t("dashx.overview.subtitle")}
          </span>
        </div>

        {/* Band A — Portfolio */}
        <div className="px-4 pt-4">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: C.textMuted }}>
            {t("dashx.overview.bandPortfolio")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        </div>

        {/* Band B — Outcomes (counts) + Rates (percentages) split into
            two columns so the eye reads them as different metric types.
            Boss feedback 2026-05-28 round B option C. */}
        <div className="px-4 pt-5">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: C.textMuted }}>
            {t("dashx.overview.bandOutcomes")}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            {/* Counts column — 3 cards stacked left */}
            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            </div>
            {/* Rates column — 2 cards on a subtly different background so
                the eye reads "these are ratios, not counts". */}
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl"
              style={{ background: `color-mix(in srgb, ${gold} 5%, transparent)`, padding: 6 }}>
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
          </div>
        </div>

        {/* Band C — Channel Throughput (was Pipeline Pulse) */}
        <div className="px-4 pt-5 pb-4">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: C.textMuted }}>
            {t("dashx.overview.bandThroughput")}
          </p>
        {(() => {
          const liStats = data.channelBreakdown.find(c => c.channel === "linkedin") ?? { sent: 0, replied: 0 };
          const emailStats = data.channelBreakdown.find(c => c.channel === "email") ?? { sent: 0, replied: 0 };
          const callsMade = data.callsBreakdown.completed ?? 0;
          const callsPending = data.callsBreakdown.pending ?? 0;
          return (
            <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x rounded-xl border overflow-hidden"
              style={{ borderColor: C.border, backgroundColor: C.surface }}>
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
        </div>
      </section>

      {/* ─── Funnel + Donut · 7/5 split (was 5/4/3 with an Insights col,
          the Insights are now surfaced as the Highlight banner above). */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          <Panel title={t("dashx.funnel.title")} subtitle={t("dashx.funnel.subtitle")} className="lg:col-span-7" glow
            actionHref={withFilters("/?tab=campaigns", filters)} actionLabel={t("dashx.panel.openCampaigns")}
            insightEyebrow={t("dashx.insight.eyebrow")}
            insightHint={t("dashx.insight.hint")}
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
            <Funnel
              {...funnel18n}
              legendTitle={t("dashx.funnel.legendTitle")}
              stages={data.funnel.map(s => {
                const key = stageKey(s.stage);
                const defKey = `dashx.funnel.def.${key}`;
                const def = t(defKey);
                return {
                  ...s,
                  stage: t(`dashx.funnel.stage.${key}`) || s.stage,
                  definition: def !== defKey ? def : undefined,
                };
              })}
            />
          </Panel>
          <Panel title={t("dashx.donut.title")} subtitle={t("dashx.donut.subtitle")} className="lg:col-span-5" glow
            actionHref="/inbox" actionLabel={t("dashx.panel.openInbox")}
            titleHint={t("dashx.donut.titleHint")}
            insightEyebrow={t("dashx.insight.eyebrow")}
            insightHint={t("dashx.insight.hint")}
            insight={(() => {
              const totalReplies = donutSlices.reduce((a, s) => a + s.value, 0);
              if (totalReplies < 3) return null;
              const positives = (data.replyClassCounts["positive"] ?? 0) + (data.replyClassCounts["meeting_intent"] ?? 0);
              const positivesPct = totalReplies > 0 ? Math.round((positives / totalReplies) * 100) : 0;
              return t("dashx.donut.insight", { positivesPct, positives, total: totalReplies });
            })()}>
            {/* Per-chart filter chips — customize the donut without going
                back to the tab filter (none on Overview tab currently). v1
                writes to global URL params, future v2 = isolated params. */}
            <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
              <span>{t("dashx.filters.applied")}:</span>
              <ChartFilterChips
                icps={filterOptions.icps}
                sellers={filterOptions.sellers}
                labels={{
                  campaigns: t("dashx.filters.campaigns"),
                  icps: t("dashx.filters.icps"),
                  sellers: t("dashx.filters.sellers"),
                  empty: t("dashx.filters.noOptions"),
                }}
              />
            </div>
            <Donut
              data={donutSlices}
              centerLabel={t("dashx.donut.centerReplies")}
              emptyLabel={t("dashx.donut.empty")}
              vsPriorLabel={t("dashx.kpi.vsPrior")}
              classifierNote={t("dashx.donut.classifierNote")}
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
            insightHint={t("dashx.insight.hint")}
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
              locale={locale}
              height={110}
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
              priorSeries={trendPrior ? [
                { name: t("dashx.trend.sent"),      color: C.seriesSent,     data: trendPrior.sent },
                { name: t("dashx.trend.replies"),   color: C.seriesReplies,  data: trendPrior.replies },
                { name: t("dashx.trend.positives"), color: C.seriesPositive, data: trendPrior.positive },
              ] : undefined}
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
            insightHint={t("dashx.insight.hint")}
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
              timezoneLabel={t("dashx.heat.timezoneLabel")}
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

      {/* Per-tab filter bar — ICP + Seller dropdowns scope the campaigns list
          and the Performance-by-step that lives below. Campaign self-filter
          would be circular, so it's omitted here. */}
      <TabFilterBar
        icps={filterOptions.icps}
        sellers={filterOptions.sellers}
        labels={tabFilterLabels}
      />

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
          subtitle={withScope(t("dashx.tbl.camp.subtitle"))}
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
          "which step is broken" question is per-sequence diagnostic.
          Header explicitly states scope (boss: "no sé de qué campaña es"). */}
      <section>
        {(() => {
          const campsSel = filters.campaignNames ?? [];
          const stepCampaignScope = campsSel.length === 0
            ? t("dashx.step.scopeAll")
            : campsSel.length === 1
              ? t("dashx.step.scopeOne", { name: campsSel[0] })
              : t("dashx.step.scopeMany", { n: campsSel.length });
          return (
            <Panel
              title={t("dashx.step.title")}
              subtitle={`${t("dashx.step.subtitle")} · ${stepCampaignScope}`}
              glow
              insightEyebrow={t("dashx.insight.eyebrow")}
              insightHint={t("dashx.insight.hint")}
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
          );
        })()}
      </section>

      </section>
      )}
      {/* ═══ CHAPTER 4 · CHANNELS ═══════════════════════════════════════════
          How each outreach channel performs · when in the week replies
          actually arrive. Channel breakdown lives here (not Overview)
          because it answers "which channel works" — a channel question. */}
      {filters.tab === "channels" && (
      <section className="space-y-4 pt-2">

      {/* Per-tab filter bar — Campaign + ICP + Seller. Filters the entire
          channels chapter (cards + comparison + heatmap). */}
      <TabFilterBar
        campaigns={filterOptions.campaigns}
        icps={filterOptions.icps}
        sellers={filterOptions.sellers}
        labels={tabFilterLabels}
      />

      {/* Unified Channels Panel — wraps the 4 channel cards + comparison
          bar in ONE container so the chapter reads as a single chapter
          instead of 3 sections (cards / comparison / heatmap). Boss
          feedback 2026-05-28: "es medio parecido todo, dame propuestas
          para reorganizar". Mix of options A + B. */}
      <Panel
        title={t("dashx.channels.title")}
        subtitle={withScope(t("dashx.channels.unifiedSubtitle"))}
        glow
        insightEyebrow={t("dashx.insight.eyebrow")}
        insightHint={t("dashx.insight.hint")}
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
        {/* Band 1 — channel cards (granular per-channel views) */}
        <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] mb-2.5" style={{ color: C.textMuted }}>
          {t("dashx.channels.bandCards")}
        </p>
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

        {/* Band 2 — head-to-head bar comparison (reply rate ranking) */}
        {data.channelBreakdown.length > 1 && (
          <div className="mt-6 pt-4 border-t" style={{ borderColor: C.border }}>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] mb-2.5" style={{ color: C.textMuted }}>
              {t("dashx.channels.bandComparison")}
            </p>
            <ChannelComparison channels={data.channelBreakdown} t={t} emptyLabel={t("dashx.channels.empty")} />
          </div>
        )}
      </Panel>

      </section>
      )}
      {/* ═══ CHAPTER 5 · SELLERS ═══════════════════════════════════════════
          Who's moving the pipeline. Ranking uses reply rate normalized by
          contacted volume (≥20 floor) so the top isn't decided by who
          happened to inherit more leads. */}
      {filters.tab === "sellers" && (
      <section className="space-y-6 pt-3">

      {/* Per-tab filter bar — Campaign + ICP. Seller self-filter would be
          circular (sellers are the rows) so we omit it. */}
      <TabFilterBar
        campaigns={filterOptions.campaigns}
        icps={filterOptions.icps}
        labels={tabFilterLabels}
      />

      {/* Per-seller KPI cards grid — boss 2026-05-28: "sumá cards por
          seller tipo de KPIs, cuántos contactó, cuántos cerró, etc."
          One card per seller, big tiles for the 4 outcome metrics. */}
      {data.sellerPerformance.length > 0 && (() => {
        type SellerKpi = {
          id: string; name: string;
          active: number; contacted: number; replied: number; positive: number;
          conversionRate: number; responseRate: number;
          sentLinkedinConn: number; sentLinkedinMsg: number; sentEmail: number; sentCall: number;
          pendingCalls: number;
        };
        const sellers = data.sellerPerformance as unknown as SellerKpi[];
        return (
          <section>
            <SectionHeader
              icon={Users}
              title={t("dashx.seller.kpiGridTitle")}
              subtitle={t("dashx.seller.kpiGridSubtitle")}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sellers.map((s, idx) => {
                const totalSent = s.sentLinkedinConn + s.sentLinkedinMsg + s.sentEmail + s.sentCall;
                const isLead = idx === 0;
                return (
                  <Link
                    key={s.id}
                    href={withFilters(`/dashboard/seller/${s.id}`, filters)}
                    className="group rounded-2xl border overflow-hidden p-4 relative transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_14px_32px_-12px_color-mix(in_srgb,var(--brand,#c9a83a)_30%,transparent)]"
                    style={{
                      backgroundColor: C.card,
                      borderColor: isLead ? `color-mix(in srgb, ${gold} 38%, ${C.border})` : C.border,
                      borderTop: `3px solid ${isLead ? gold : "#7C3AED"}`,
                      boxShadow: isLead ? `0 6px 20px color-mix(in srgb, ${gold} 14%, transparent)` : "0 1px 2px rgba(0,0,0,0.03)",
                    }}>
                    {isLead && (
                      <span aria-hidden className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none"
                        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 70%)` }} />
                    )}
                    <div className="relative flex items-center gap-2.5 mb-3">
                      <span
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[13px] font-bold tabular-nums"
                        style={{
                          background: isLead
                            ? `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`
                            : `color-mix(in srgb, #7C3AED 14%, transparent)`,
                          color: isLead ? "#1A1505" : "#7C3AED",
                          border: isLead ? "none" : `1px solid color-mix(in srgb, #7C3AED 22%, transparent)`,
                          boxShadow: isLead ? `0 2px 8px color-mix(in srgb, ${gold} 32%, transparent)` : "none",
                        }}>
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
                          {isLead ? t("dashx.seller.kpiCardEyebrowLead") : t("dashx.seller.kpiCardEyebrow")}
                        </p>
                        <p className="text-[15px] font-bold leading-tight truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                          {s.name}
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded shrink-0"
                        style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
                        {s.active} {t("dashx.seller.kpiCardActive")}
                      </span>
                    </div>
                    <div className="relative grid grid-cols-2 gap-2">
                      <SellerKpiTile label={t("dashx.seller.kpiCardContacted")} value={s.contacted} color={C.textBody} />
                      <SellerKpiTile label={t("dashx.seller.kpiCardSent")} value={totalSent} color="#0284C7" />
                      <SellerKpiTile label={t("dashx.seller.kpiCardReplies")} value={s.replied} sub={`${s.responseRate}% reply rate`} color="#7C3AED" />
                      <SellerKpiTile label={t("dashx.seller.kpiCardWon")} value={s.positive} sub={`${s.conversionRate}% conv`} color={C.green} accent={s.positive > 0} />
                    </div>
                    {s.pendingCalls > 0 && (
                      <p className="relative mt-3 text-[11px] inline-flex items-center gap-1.5"
                        style={{ color: "#D97706" }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#D97706" }} />
                        {s.pendingCalls} {t("dashx.seller.kpiCardPending")}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })()}

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
          subtitle={withScope(t("dashx.tbl.seller.subtitle"))}
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
                <Th align="left">{t("dashx.tbl.col.sentByChannel")}</Th>
                <Th align="right">{t("dashx.tbl.col.repliedFull")}</Th>
                <Th align="right">{t("dashx.tbl.col.positiveFull")}</Th>
                <Th align="right"><span title={t("dashx.tbl.col.convPctHint")}>{t("dashx.tbl.col.convPctFull")}</span></Th>
                <Th align="left">{t("dashx.tbl.col.trend14")}</Th>
                <Th align="left" style={{ width: 24 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.sellerPerformance.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters} kindKey="sellers" t={t} /></td></tr>
              ) : (() => {
                const maxConv = Math.max(1, ...data.sellerPerformance.map(s => s.conversionRate));
                const sellerLabels = {
                  expand: t("dashx.seller.expand"),
                  collapse: t("dashx.seller.collapse"),
                  campaignsTitle: t("dashx.seller.topCampaigns"),
                  icpsTitle: t("dashx.seller.topIcps"),
                  empty: t("dashx.seller.attrEmpty"),
                  sentShort: t("dashx.seller.sentShort"),
                  repliedShort: t("dashx.seller.repliedShort"),
                  positiveShort: t("dashx.seller.positiveShort"),
                  contactedShort: t("dashx.seller.contactedShort"),
                  perChannelTitle: t("dashx.seller.perChannelTitle"),
                  connSent: t("dashx.seller.connSent"),
                  connAccepted: t("dashx.seller.connAccepted"),
                  pendingCallsLabel: t("dashx.seller.pendingCallsLabel"),
                  totalSentLabel: t("dashx.seller.totalSentLabel"),
                };
                const sellerChannelLabels = {
                  linkedinSent: t("dashx.touch.linkedinSent"),
                  linkedinMsg: t("dashx.touch.linkedinMsg"),
                  emailTouch: t("dashx.touch.emailTouch"),
                  callTouch: t("dashx.touch.callTouch"),
                };
                return data.sellerPerformance.map((s: any, idx: number) => (
                  <SellerRow
                    key={s.id}
                    seller={s}
                    idx={idx}
                    maxConv={maxConv}
                    detailHref={withFilters(`/dashboard/seller/${s.id}`, filters)}
                    labels={sellerLabels}
                    channelLabels={sellerChannelLabels}
                    formulaHint={t("dashx.tbl.col.convPctHint")}
                  />
                ));
              })()}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* Channel Champions — who is best at each channel. Shows the seller
          with the highest reply rate per channel (LinkedIn / Email / Call)
          with their actual sent/replied so the operator picks the right
          person to send a new channel-specific request to. Boss 2026-05-28
          asked for more content under the seller leaderboard. */}
      {(() => {
        type SellerWithRates = {
          id: string; name: string;
          contactedLinkedin: number; repliedLinkedin: number; replyRateLinkedin: number;
          contactedEmail: number;    repliedEmail: number;    replyRateEmail: number;
          contactedCall: number;     repliedCall: number;     replyRateCall: number;
          active: number; positive: number; pendingCalls: number;
        };
        const sellersData = data.sellerPerformance as unknown as SellerWithRates[];
        const pickChampion = (channelKey: "linkedin" | "email" | "call") => {
          const contactedKey = channelKey === "linkedin" ? "contactedLinkedin" : channelKey === "email" ? "contactedEmail" : "contactedCall";
          const repliedKey   = channelKey === "linkedin" ? "repliedLinkedin"   : channelKey === "email" ? "repliedEmail"   : "repliedCall";
          const rateKey      = channelKey === "linkedin" ? "replyRateLinkedin" : channelKey === "email" ? "replyRateEmail" : "replyRateCall";
          // Floor of 5 contacted leads — anyone below that is noise.
          const eligible = sellersData.filter(s => s[contactedKey] >= 5);
          if (eligible.length === 0) return null;
          const sorted = [...eligible].sort((a, b) => b[rateKey] - a[rateKey] || b[repliedKey] - a[repliedKey]);
          return sorted[0];
        };
        const liChamp    = pickChampion("linkedin");
        const emailChamp = pickChampion("email");
        const callChamp  = pickChampion("call");
        if (!liChamp && !emailChamp && !callChamp) return null;

        const ChampCard = ({ Icon, color, channel, champion, channelLabel, contactedKey, repliedKey, rateKey }: {
          Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
          color: string;
          channel: string;
          champion: SellerWithRates | null;
          channelLabel: string;
          contactedKey: "contactedLinkedin" | "contactedEmail" | "contactedCall";
          repliedKey: "repliedLinkedin" | "repliedEmail" | "repliedCall";
          rateKey: "replyRateLinkedin" | "replyRateEmail" | "replyRateCall";
        }) => (
          <div className="rounded-xl border p-4 relative overflow-hidden flex flex-col gap-3 transition-[transform,box-shadow] hover:-translate-y-px"
            style={{
              backgroundColor: C.card,
              borderColor: C.border,
              borderTop: `3px solid ${color}`,
              boxShadow: champion ? `0 8px 22px -12px color-mix(in srgb, ${color} 30%, transparent)` : "0 1px 2px rgba(0,0,0,0.03)",
            }}>
            <span aria-hidden className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none"
              style={{ background: `radial-gradient(circle, color-mix(in srgb, ${color} 12%, transparent) 0%, transparent 70%)` }} />
            <div className="relative flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 22%, transparent)` }}>
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
                  {t("dashx.seller.champTitle")}
                </p>
                <p className="text-[14px] font-bold leading-tight" style={{ color: C.textPrimary }}>{channelLabel}</p>
              </div>
            </div>
            {champion ? (
              <>
                <div className="relative">
                  <Link href={withFilters(`/dashboard/seller/${champion.id}`, filters)}
                    className="text-[15px] font-bold leading-tight hover:underline truncate block"
                    style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {champion.name}
                  </Link>
                  <p className="text-[10.5px] mt-0.5" style={{ color: C.textDim }}>
                    {champion[repliedKey]} / {champion[contactedKey]} {t("dashx.seller.champReplies")}
                  </p>
                </div>
                <div className="relative flex items-baseline gap-1.5">
                  <span className="text-[32px] font-bold tabular-nums leading-none tracking-[-0.02em]"
                    style={{ color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {champion[rateKey]}%
                  </span>
                  <span className="text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: C.textDim }}>
                    {t("dashx.seller.champRate")}
                  </span>
                </div>
              </>
            ) : (
              <p className="relative text-[12px] py-3" style={{ color: C.textDim }}>
                {t("dashx.seller.champNoData", { channel: channelLabel })}
              </p>
            )}
          </div>
        );

        return (
          <section className="mt-6">
            <SectionHeader
              icon={Trophy}
              title={t("dashx.seller.champSectionTitle")}
              subtitle={t("dashx.seller.champSectionSubtitle")}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ChampCard
                Icon={Share2}
                color="#0284C7"
                channel="linkedin"
                channelLabel="LinkedIn"
                champion={liChamp}
                contactedKey="contactedLinkedin"
                repliedKey="repliedLinkedin"
                rateKey="replyRateLinkedin"
              />
              <ChampCard
                Icon={Mail}
                color="#047857"
                channel="email"
                channelLabel="Email"
                champion={emailChamp}
                contactedKey="contactedEmail"
                repliedKey="repliedEmail"
                rateKey="replyRateEmail"
              />
              <ChampCard
                Icon={Phone}
                color="#EA580C"
                channel="call"
                channelLabel="Call"
                champion={callChamp}
                contactedKey="contactedCall"
                repliedKey="repliedCall"
                rateKey="replyRateCall"
              />
            </div>
          </section>
        );
      })()}

      {/* Workload distribution — relative active-campaign load per seller.
          Helps the manager see who's overloaded vs free to take new flows. */}
      {(() => {
        const sellersData = data.sellerPerformance as unknown as Array<{ id: string; name: string; active: number; pendingCalls: number }>;
        const eligible = sellersData.filter(s => s.active > 0 || s.pendingCalls > 0);
        if (eligible.length < 2) return null;
        const maxActive = Math.max(1, ...eligible.map(s => s.active));
        return (
          <section className="mt-6">
            <SectionHeader
              icon={Activity}
              title={t("dashx.seller.workloadTitle")}
              subtitle={t("dashx.seller.workloadSubtitle")}
            />
            <Panel>
              <div className="space-y-2.5">
                {[...eligible].sort((a, b) => b.active - a.active).map(s => {
                  const pct = Math.max(4, Math.round((s.active / maxActive) * 100));
                  const overloaded = s.active >= maxActive * 0.85 && eligible.length > 2;
                  const barColor = overloaded ? "#D97706" : gold;
                  return (
                    <div key={s.id} className="grid items-center gap-3" style={{ gridTemplateColumns: "180px 1fr 80px 80px" }}>
                      <Link href={withFilters(`/dashboard/seller/${s.id}`, filters)} className="text-[12.5px] font-medium truncate hover:underline" style={{ color: C.textPrimary }}>
                        {s.name}
                      </Link>
                      <div className="relative h-6 rounded-md overflow-hidden" style={{ background: C.surface }}>
                        <div className="absolute inset-y-0 left-0 transition-[width] flex items-center px-2"
                          style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 70%, white))`,
                            minWidth: 36,
                          }}>
                          <span className="text-[11px] font-bold tabular-nums" style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>
                            {s.active}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10.5px] tabular-nums text-right" style={{ color: C.textDim }}>
                        {s.active} {t("dashx.seller.workloadActiveLabel")}
                      </span>
                      <span className="text-[10.5px] tabular-nums text-right"
                        style={{ color: s.pendingCalls > 0 ? "#D97706" : C.textDim }}>
                        {s.pendingCalls} {t("dashx.seller.workloadPendingLabel")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </section>
        );
      })()}

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
  titleHint, insightHint,
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
  /** Tooltip text shown when hovering a "?" badge next to the header title.
   * Use for explaining what the panel measures (e.g. how the AI classifier
   * works). */
  titleHint?: string;
  /** Same as titleHint but on the insight eyebrow — explains where the
   * insight comes from (heuristic rules vs LLM). */
  insightHint?: string;
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
                className="text-[13.5px] font-bold tracking-[-0.005em] inline-flex items-center gap-1.5"
                style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
              >
                {title}
                {titleHint && (
                  // Custom hover popover — replaces native title="" so the
                  // full hint renders properly styled with brand colors
                  // and full text wrapping (boss 2026-05-28).
                  <span className="group/tip relative inline-flex">
                    <span
                      role="img"
                      aria-label={titleHint}
                      tabIndex={0}
                      className="text-[9px] font-bold rounded-full w-3.5 h-3.5 inline-flex items-center justify-center cursor-help focus:outline-none focus:ring-2 focus:ring-amber-300"
                      style={{
                        background: "color-mix(in srgb, var(--brand, #c9a83a) 22%, transparent)",
                        color: gold,
                        border: `1px solid color-mix(in srgb, ${gold} 40%, transparent)`,
                      }}
                    >
                      ?
                    </span>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 w-72 rounded-md border px-3 py-2 text-[11px] font-medium leading-snug shadow-lg opacity-0 transition-opacity duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
                      style={{
                        background: "rgba(11, 15, 26, 0.98)",
                        color: "#E5E7EB",
                        borderColor: `color-mix(in srgb, ${gold} 35%, transparent)`,
                        boxShadow: "0 12px 32px -10px rgba(0,0,0,0.5)",
                      }}
                    >
                      {titleHint}
                    </span>
                  </span>
                )}
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
              <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] inline-flex items-center gap-1.5" style={{ color: gold }}>
                {insightEyebrow}
                {insightHint && (
                  <span className="group/tip relative inline-flex">
                    <span
                      role="img"
                      aria-label={insightHint}
                      tabIndex={0}
                      className="text-[8.5px] font-bold rounded-full w-3 h-3 inline-flex items-center justify-center cursor-help focus:outline-none focus:ring-2 focus:ring-amber-300"
                      style={{
                        background: "color-mix(in srgb, var(--brand, #c9a83a) 22%, transparent)",
                        color: gold,
                        border: `1px solid color-mix(in srgb, ${gold} 40%, transparent)`,
                      }}
                    >
                      ?
                    </span>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 w-72 rounded-md border px-3 py-2 text-[11px] font-medium normal-case tracking-normal leading-snug shadow-lg opacity-0 transition-opacity duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
                      style={{
                        background: "rgba(11, 15, 26, 0.98)",
                        color: "#E5E7EB",
                        borderColor: `color-mix(in srgb, ${gold} 35%, transparent)`,
                        boxShadow: "0 12px 32px -10px rgba(0,0,0,0.5)",
                      }}
                    >
                      {insightHint}
                    </span>
                  </span>
                )}
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

/** Live throughput stat used inside the Today welcome hero. White-on-navy
 * so it reads on the dark gradient; tiny colored icon + bold number +
 * lowercase label. Visually quiet on purpose — the strip is supposed to
 * feel alive, not shout. */
function HeroPulseStat({
  icon: Icon, value, label, color,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
          border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
        }}
      >
        <Icon size={13} />
      </span>
      <span
        className="text-[22px] font-bold tabular-nums leading-none tracking-[-0.02em]"
        style={{ color: "white", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
      >
        {value}
      </span>
      <span className="text-[11px]" style={{ color: "color-mix(in srgb, white 55%, transparent)" }}>
        {label}
      </span>
    </div>
  );
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

function SellerKpiTile({ label, value, color, sub, accent }: {
  label: string;
  value: number;
  color: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5"
      style={{
        background: accent ? `color-mix(in srgb, ${color} 8%, transparent)` : C.surface,
        borderColor: accent ? `color-mix(in srgb, ${color} 25%, transparent)` : C.border,
      }}>
      <p className="text-[9.5px] font-bold uppercase tracking-wider truncate" style={{ color: C.textDim }}>{label}</p>
      <p className="text-[20px] font-bold tabular-nums leading-tight tracking-[-0.01em]"
        style={{ color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
        {value.toLocaleString("en-US")}
      </p>
      {sub && (
        <p className="text-[9.5px] mt-0.5 truncate" style={{ color: C.textDim }}>{sub}</p>
      )}
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
