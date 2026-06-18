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
  AlertTriangle, ArrowRight, ChevronRight, MessageSquare, ThumbsUp, Sparkles,
  Share2, Mail, Phone, Smartphone, FileDown, ChevronsRight, Activity,
} from "lucide-react";
import { C, N } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getDashboardData } from "@/lib/dashboard-data";
import { getT, getServerLocale } from "@/lib/i18n-server";
import ReliabilityBanner from "@/components/ReliabilityBanner";
import TabFilterBar from "@/components/dashboard/TabFilterBar";
import SellerRow from "@/components/dashboard/SellerRowExpand";
import { getSupabaseService } from "@/lib/supabase-service";
import FreshnessChip from "@/components/dashboard/FreshnessChip";
import DashboardKeyboardShortcuts from "@/components/dashboard/DashboardKeyboardShortcuts";
import SwlSignature from "@/components/dashboard/SwlSignature";
import Funnel from "@/components/dashboard/Funnel";
import MultiLineChart from "@/components/dashboard/MultiLineChart";
import ActivityStrip from "@/components/dashboard/ActivityStrip";
import Donut from "@/components/dashboard/Donut";
import Heatmap from "@/components/dashboard/Heatmap";
import IcpChannelMatrix from "@/components/dashboard/IcpChannelMatrix";
import InlineSpark from "@/components/dashboard/InlineSpark";
import StepPerformance from "@/components/dashboard/StepPerformance";
import ScoreTile from "@/components/dashboard/ScoreTile";
import ChapterNav from "@/components/dashboard/ChapterNav";
import PortfolioView from "@/components/dashboard/PortfolioView";
import { getPortfolioComparison } from "@/lib/portfolio";
import ChannelComparison from "@/components/dashboard/ChannelComparison";
import MicroKpi from "@/components/dashboard/MicroKpi";
import RateBar from "@/components/dashboard/RateBar";
import ChannelCard from "@/components/dashboard/ChannelCard";
import CallsCard from "@/components/dashboard/CallsCard";
import CallOutcomesBySeller from "@/components/dashboard/CallOutcomesBySeller";
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

const DASHBOARD_TABS = ["today", "overview", "icps", "campaigns", "channels", "sellers", "portfolio"] as const;
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
  const isSuperAdmin = scope.tier === "super_admin";
  // Portfolio is a super-admin-only cross-tenant comparison. Non-super-admins
  // who hit ?tab=portfolio fall back to Overview (so the page isn't blank).
  if (filters.tab === "portfolio" && !isSuperAdmin) filters.tab = "overview";
  const onPortfolio = filters.tab === "portfolio";
  const pdaysRaw = Number(Array.isArray(sp.pdays) ? sp.pdays[0] : sp.pdays);
  const pdays = [7, 30, 90].includes(pdaysRaw) ? pdaysRaw : 7;
  const portfolioData = onPortfolio ? await getPortfolioComparison(pdays) : null;
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
  // Always-visible classifications — per boss feedback (2026-05-28 fix),
  // "Positive" + "Negative" must show up in the legend even when the count
  // is 0, because they're the two outcome poles the operator scans for
  // (win/lose). Meeting intent is a sub-flavor of positive — it shows up
  // only when there's actual data. Original 2026-05-27 version had this
  // backwards (showed meeting_intent always, hid negative).
  const ALWAYS_SHOW_REPLY_CLASSES = new Set(["positive", "negative"]);
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
        className="relative rounded-2xl overflow-hidden px-8 sm:px-14 py-10 sm:py-14"
        style={{
          background: `
            radial-gradient(50% 80% at 92% 50%, color-mix(in srgb, ${gold} 22%, transparent) 0%, transparent 60%),
            radial-gradient(35% 60% at 8% 20%, color-mix(in srgb, ${gold} 11%, transparent) 0%, transparent 65%),
            radial-gradient(60% 40% at 50% 110%, color-mix(in srgb, ${gold} 8%, transparent) 0%, transparent 70%),
            linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)
          `,
          border: `1px solid color-mix(in srgb, ${gold} 28%, ${N.hairline})`,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 32%, transparent) inset, 0 0 60px -10px color-mix(in srgb, ${gold} 18%, transparent) inset, 0 24px 60px -28px ${N.ink}, 0 0 0 1px color-mix(in srgb, ${gold} 8%, transparent)`,
        }}
      >
        {/* Hairline gold accent across the very top edge — editorial detail */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${gold} 56%, transparent) 25%, color-mix(in srgb, ${gold} 56%, transparent) 75%, transparent 100%)` }} />
        {/* Static atmospheric glow — large soft bloom behind where the
            SWL lockup sits. Same anchor as the radial in the bg but
            blurred for depth. Gives the right half of the card real
            "presence" without animating. */}
        <span aria-hidden className="absolute top-1/2 right-0 -translate-y-1/2 w-[640px] h-[440px] pointer-events-none"
          style={{
            background: `radial-gradient(circle at 70% 50%, color-mix(in srgb, ${gold} 28%, transparent) 0%, transparent 60%)`,
            filter: "blur(40px)",
          }} />
        {/* Counter wash on the left for warmth where the wordmark sits */}
        <span aria-hidden className="absolute top-0 left-0 w-[360px] h-[260px] pointer-events-none"
          style={{
            background: `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 65%)`,
            filter: "blur(30px)",
          }} />

        <div className="relative flex items-center justify-between gap-12 sm:gap-16 flex-wrap">
          {/* ── Left column — GrowthAI wordmark (white + gold "AI"),
              SALES ENGINE eyebrow under it, welcome copy. Capped to
              560px so the SWL lockup doesn't get exiled to the far
              right edge; the negative space between columns is now
              filled by the gold ambient bloom baked into the bg. */}
          <div className="min-w-0 flex-1 max-w-[560px]">
            <div className="mb-7">
              <p
                className="text-[28px] sm:text-[32px] font-bold leading-none"
                style={{
                  color: "white",
                  fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                Growth<span style={{ color: gold }}>AI</span>
              </p>
              <div className="flex items-center gap-2.5 mt-2.5">
                <span aria-hidden className="block h-px w-6"
                  style={{ background: `linear-gradient(90deg, ${gold} 0%, transparent 100%)` }} />
                <span
                  className="text-[10.5px] font-bold uppercase"
                  style={{
                    color: gold,
                    letterSpacing: "0.32em",
                    fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  }}
                >
                  {t("dashx.hero.section")}
                </span>
              </div>
            </div>

            <h1
              className="text-[34px] sm:text-[46px] font-semibold leading-[1.02]"
              style={{
                color: "white",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                letterSpacing: "-0.03em",
                textShadow: `0 2px 24px color-mix(in srgb, ${gold} 14%, transparent)`,
              }}
            >
              {t("dashx.today.heroTitle")}
            </h1>
            <p
              className="text-[14px] mt-4 max-w-[560px] leading-relaxed"
              style={{
                color: "color-mix(in srgb, white 64%, transparent)",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
              }}
            >
              {t("dashx.today.heroDesc")}
            </p>
          </div>

          {/* ── Right column — exact LogoLoader lockup, no card ─────
              Mirrors the splash screen lockup so the hero shows the
              same identity the user sees on every page transition.
              Mark (gold parallelograms, cropped from the PNG) +
              typographic "SWL" wordmark, both share the same 4.5s
              cycle (logo-loader-mark-glow + logo-loader-mark-shine +
              logo-loader-wordmark-shimmer). The dark-mode rule in
              globals.css already gives the mark a hotter glow on the
              navy hero bg. */}
          {(() => {
            const SWL_LOGO = "https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png";
            const size = 96;
            // Same crop math the LogoLoader uses — only the gold mark
            // portion of the PNG, the white "SWL" letters get hidden
            // because the gold typographic wordmark next to it carries
            // the lettering instead.
            const markCropRatio = 0.34;
            const fullPngWidth = size * (280 / 136);
            const markWidth = Math.round(fullPngWidth * markCropRatio);
            return (
              <div className="logo-loader-stage shrink-0" aria-hidden>
                <div
                  className="logo-loader-mark-wrap"
                  style={{ width: markWidth, height: size }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={SWL_LOGO}
                    alt=""
                    className="logo-loader-mark-img"
                    style={{
                      width: fullPngWidth,
                      height: size,
                      objectFit: "cover",
                      objectPosition: "left center",
                    }}
                  />
                  <span
                    className="logo-loader-mark-shine"
                    style={{
                      width: markWidth,
                      height: size,
                      WebkitMaskImage: `url(${SWL_LOGO})`,
                      maskImage: `url(${SWL_LOGO})`,
                      WebkitMaskSize: `${fullPngWidth}px ${size}px`,
                      maskSize: `${fullPngWidth}px ${size}px`,
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskPosition: "left center",
                      maskPosition: "left center",
                    }}
                  />
                </div>
                <span
                  className="logo-loader-wordmark"
                  style={{
                    fontSize: Math.round(size * 0.85),
                    lineHeight: 1,
                    fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  }}
                >
                  SWL
                </span>
              </div>
            );
          })()}
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
            // Portfolio — cross-tenant comparison, super-admin only.
            ...(isSuperAdmin ? [{ id: "portfolio", number: 7, label: "Portfolio" }] : []),
          ]}
        />
      </Suspense>

      {/* ─── Filter bar — sits below tabs because filters scope the active
          tab's content. Suspense boundary required for useSearchParams.
          Hidden on Today (boss 2026-05-28): the Today card is the
          "what's on my plate right now" landing surface; a date window
          would just hide work the seller still has to do. */}
      {/* Unified filter bar — ONE line for every analytics tab: Period ·
          Campaign · ICPs · Sellers (boss 2026-06-08). URL state is global so
          the data layer filters every section against it; rendering it once
          here replaces the old period-only top bar + per-tab dropdown bars. */}
      {filters.tab !== "today" && filters.tab !== "portfolio" && (
        <Suspense fallback={<div className="h-10" />}>
          <TabFilterBar
            showPeriod
            campaigns={filterOptions.campaigns}
            icps={filterOptions.icps}
            sellers={filterOptions.sellers}
            labels={tabFilterLabels}
          />
        </Suspense>
      )}

      {/* ═══ PORTFOLIO · cross-tenant comparison (super-admin only) ═══ */}
      {onPortfolio && portfolioData && (
        <PortfolioView companies={portfolioData} days={pdays} locale={locale === "es" ? "es" : "en"} />
      )}

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
        counts={data.todayLists.counts}
      />

      {/* Mis números (#14) — period KPIs, premium-styled to match TodayCard.
          Deltas are real % change vs the prior equal-length window
          (data.deltas); the 4th tile is response rate, a derived metric
          that's actually meaningful (replaced a bogus "+100% You vs Team"). */}
      <section
        className="rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: C.card,
          borderColor: `color-mix(in srgb, ${gold} 28%, ${C.border})`,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 18%, transparent), 0 8px 24px -12px ${N.ink}`,
        }}
      >
        <div
          className="relative px-5 py-3.5 flex items-center gap-3 overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
            borderBottom: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
          }}
        >
          <span aria-hidden className="absolute -top-16 -left-12 w-48 h-48 rounded-full pointer-events-none"
            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 65%)` }} />
          <span className="relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`, color: N.ink }}>
            <Activity size={14} />
          </span>
          <div className="relative min-w-0">
            <h3 className="text-[14px] font-semibold tracking-[-0.005em]" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {t("dashboard.myMetrics.title")}
            </h3>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: "color-mix(in srgb, white 60%, transparent)" }}>
              {periodLabel}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ backgroundColor: C.border }}>
          {[
            { label: t("dashboard.myMetrics.leadsReached"), value: data.headline?.contactedLeads ?? 0, delta: data.deltas?.contacted ?? null, Icon: Users,          color: gold },
            { label: t("dashboard.myMetrics.replies"),      value: data.headline?.repliedCount ?? 0,    delta: data.deltas?.replied ?? null,   Icon: MessageSquare, color: C.blue },
            { label: t("dashboard.myMetrics.positive"),     value: data.headline?.positiveCount ?? 0,    delta: data.deltas?.positive ?? null,  Icon: ThumbsUp,      color: C.green },
            { label: t("dashboard.responseRate"),           value: `${data.headline?.responseRate ?? 0}%`, delta: null,                         Icon: Target,        color: gold },
          ].map((m) => (
            <div key={m.label} className="px-5 py-4 flex flex-col gap-2" style={{ backgroundColor: C.card }}>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `color-mix(in srgb, ${m.color} 12%, transparent)`, color: m.color }}>
                  <m.Icon size={12} />
                </span>
                <span className="text-[11px] font-medium leading-tight" style={{ color: C.textMuted }}>{m.label}</span>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[26px] font-bold leading-none tabular-nums" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                  {m.value}
                </span>
                {m.delta != null && m.delta !== 0 && (
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: m.delta >= 0 ? C.green : C.red }}>
                    {m.delta >= 0 ? "+" : "−"}{Math.abs(m.delta)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
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

        {/* Filters live in the unified top bar now (one line, all tabs). */}

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
          const callsMade = data.callsBreakdown.made ?? 0;
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
              const won = data.funnel.find(s => s.stage === "won")?.count ?? 0;
              if (sent < 3) return null;
              const acceptPct = sent > 0 ? Math.round((accepted / sent) * 100) : 0;
              // Reply rate MUST match the global "Reply rate" KPI
              // (headline.responseRate = replied / contacted). Previously this
              // used replied/accepted → different denominator → didn't match
              // the headline metric (boss 2026-06-08: "no coincide con la
              // métrica global").
              const replyPct = headline.responseRate;
              return t("dashx.funnel.insight", { acceptPct, replyPct, won });
            })()}>
            <Funnel
              {...funnel18n}
              stages={data.funnel.map(s => {
                const key = stageKey(s.stage);
                const defKey = `dashx.funnel.def.${key}`;
                const def = t(defKey);
                return {
                  ...s,
                  // Drop the period-over-period prior: it drove a vs-prior
                  // delta column that showed confusing negative %s (boss
                  // 2026-06-08). The funnel keeps the left "% of previous"
                  // step-conversion, which is the real funnel story.
                  prior: null,
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
            {/* Reply classification inherits the unified top filter bar — no
                per-chart filters (boss 2026-06-08: "no quiero que tenga filtros
                ahí, que levante los filtros de la hoja general"). donutSlices
                already comes from data.replyClassCounts, filtered by the global
                URL params the top bar writes. */}
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

      {/* ─── Calls by user (boss 2026-06-09): per-seller call activity +
          outcomes for the period, on the Overview at-a-glance. Respects the
          top filter bar (period/campaign/icp/seller). */}
      <section>
        <Panel
          title={t("dashx.callsByUser.title")}
          subtitle={withScope(t("dashx.callsByUser.subtitle"))}
          actionHref="/queue?tab=calls"
          actionLabel={t("dashx.calls.openQueue")}
          glow
        >
          <CallOutcomesBySeller rows={data.callOutcomesBySeller} bare />
        </Panel>
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
                <Th align="right">{t("dashx.tbl.col.flows")}</Th>
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
                <tr><td colSpan={11} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}><EmptyTableState filtered={hasFilters} kindKey="icps" t={t} /></td></tr>
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
                      <NumCell value={icp.flows ?? 0} accent={(icp.flows ?? 0) > 0 ? gold : undefined} bold />
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

      {/* Filters live in the unified top bar now (one line, all tabs). */}


      <section>
        {/* Status chips removed 2026-05-28: the by-ICP accordion shows every
            flow with its status badge inline, so the standalone Active /
            Paused / Completed filter on top was duplicating the badge in the
            row. Drilling into a specific flow's history still works via the
            "Campaigns →" link inside the expanded step body. */}
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
          title={t("dashx.campsByIcp.title")}
          subtitle={withScope(t("dashx.campsByIcp.subtitle"))}
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
          {/* Suppress native <details> marker — chevron is rendered manually. */}
          <style>{`
            .icp-acc summary { list-style: none; cursor: pointer; }
            .icp-acc summary::-webkit-details-marker { display: none; }
            .icp-acc details[open] > summary .acc-chevron { transform: rotate(90deg); }
            .icp-acc .acc-chevron { transition: transform 0.18s ease; }
          `}</style>
          {data.campaignPerformance.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs" style={{ color: C.textMuted }}>
              <EmptyTableState filtered={hasFilters} kindKey="campaigns" t={t} />
            </div>
          ) : (() => {
            // Boss 2026-05-28: every flow rendered under its dominant ICP
            // instead of a flat campaign table. Two-level accordion: outer
            // is the ICP section (rolls up totals across its flows); inner
            // is per-flow with step-performance shown inline when expanded.
            const ranked = [...data.campaignPerformance].sort((a, b) => b.conversionRate - a.conversionRate);
            const rankByName = new Map(ranked.map((c, idx) => [c.name, idx]));
            // RateBar `max` is computed per-section now (boss 2026-05-28 r2):
            // each ICP block compares its own flows against each other, not
            // against a global max that would squash bars in the same ICP.
            type Flow = typeof data.campaignPerformance[number];
            const byIcp = new Map<string, { icpId: string | null; icpName: string | null; flows: Flow[] }>();
            for (const c of data.campaignPerformance) {
              const key = c.icp_profile_id ?? "_none";
              let g = byIcp.get(key);
              if (!g) { g = { icpId: c.icp_profile_id, icpName: c.icp_profile_name, flows: [] }; byIcp.set(key, g); }
              g.flows.push(c);
            }
            const sections = Array.from(byIcp.values())
              .map(g => ({
                ...g,
                totalLeads:     g.flows.reduce((s, f) => s + f.leads, 0),
                totalReplies:   g.flows.reduce((s, f) => s + f.replied, 0),
                totalPositive:  g.flows.reduce((s, f) => s + f.positive, 0),
                activeCount:    g.flows.filter(f => f.status === "active" || f.status === "paused").length,
              }))
              .sort((a, b) => b.totalPositive - a.totalPositive || b.totalLeads - a.totalLeads);
            // Same per-ICP metrics shown in the ICPS tab "ICP Comparison"
            // (boss 2026-06-08: surface them here too). Looked up by ICP id.
            const icpPerfById = new Map(data.icpPerformance.map((p: any) => [p.id, p]));
            const campsByIcpTouchLabels = {
              linkedinSent: t("dashx.touch.linkedinSent"),
              linkedinMsg: t("dashx.touch.linkedinMsg"),
              emailTouch: t("dashx.touch.emailTouch"),
              callTouch: t("dashx.touch.callTouch"),
            };
            return (
              <div className="icp-acc space-y-3">
                {sections.map((sec, secIdx) => (
                  <details key={sec.icpId ?? "_none"} open={secIdx === 0}
                    className="rounded-2xl border overflow-hidden"
                    style={{ borderColor: C.border, backgroundColor: C.card }}>
                    <summary className="px-4 py-3 flex items-center gap-3 hover:bg-black/[0.02] transition-colors">
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                          boxShadow: `0 3px 10px color-mix(in srgb, ${gold} 25%, transparent)`,
                        }}>
                        <Target size={14} style={{ color: "#fff" }} strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: gold }}>
                          {t("dashx.campsByIcp.eyebrow")}
                        </p>
                        <p className="text-[15px] font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                          {sec.icpName ?? t("dashx.tbl.icp.unknown")}
                          <span className="ml-2 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md align-middle"
                            style={{ backgroundColor: C.surface, color: C.textMuted }}>
                            {sec.flows.length} {sec.flows.length === 1 ? t("dashx.campsByIcp.flow") : t("dashx.campsByIcp.flows")}
                          </span>
                        </p>
                      </div>
                      <div className="hidden md:flex items-center gap-5 shrink-0 mr-2">
                        <div className="text-right">
                          <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("dashx.campsByIcp.leadsCol")}</p>
                          <p className="text-[15px] font-bold tabular-nums leading-none mt-0.5" style={{ color: C.textPrimary }}>{sec.totalLeads}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("dashx.campsByIcp.repliesCol")}</p>
                          <p className="text-[15px] font-bold tabular-nums leading-none mt-0.5" style={{ color: sec.totalReplies > 0 ? C.blue : C.textPrimary }}>{sec.totalReplies}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("dashx.campsByIcp.positiveCol")}</p>
                          <p className="text-[15px] font-bold tabular-nums leading-none mt-0.5" style={{ color: sec.totalPositive > 0 ? C.green : C.textPrimary }}>{sec.totalPositive}</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="acc-chevron shrink-0" style={{ color: C.textMuted }} />
                    </summary>
                    <div className="p-4 space-y-3 border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      {/* ICP-level metrics — mirror the ICPS tab "ICP
                          Comparison" row (boss 2026-06-08): channel touches +
                          contacted / replied / positive + response & conversion
                          rates, so this section carries the same data. */}
                      {(() => {
                        const ip: any = sec.icpId ? icpPerfById.get(sec.icpId) : null;
                        if (!ip) return null;
                        return (
                          <div className="rounded-xl border p-3 flex flex-wrap items-center gap-x-5 gap-y-2"
                            style={{ borderColor: C.border, backgroundColor: C.card }}>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{t("dashx.tbl.col.sentByChannel")}</span>
                              <ChannelTouches
                                linkedinSent={ip.linkedinSent ?? 0}
                                linkedinMsg={ip.linkedinMsg ?? 0}
                                emailTouch={ip.emailTouch ?? 0}
                                callTouch={ip.callTouch ?? 0}
                                labels={campsByIcpTouchLabels}
                              />
                            </div>
                            <MiniStat label={t("dashx.tbl.col.contacted")} value={ip.contacted ?? 0} />
                            <MiniStat label={t("dashx.tbl.col.repliedFull")} value={ip.replied ?? 0} />
                            <MiniStat label={t("dashx.tbl.col.positiveFull")} value={ip.positive ?? 0} accent={(ip.positive ?? 0) > 0 ? C.green : undefined} />
                            <MiniStat label={t("dashx.sellerAvg.replyRate")} value={`${ip.responseRate ?? 0}%`} accent="#7C3AED" />
                            <MiniStat label={t("dashx.sellerAvg.conversion")} value={`${ip.conversionRate ?? 0}%`} accent={C.green} />
                          </div>
                        );
                      })()}
                      {/* Dedicated head-to-head comparison section (boss
                          2026-05-28 r4): scorecard-style podium where each
                          flow takes a tall card with rank medal + 4 big
                          stat tiles (Contacted/Won/Lost/Steps) + conv% bar
                          + status. The cards ARE the flow rows now — no
                          separate compact strip; clicking expands the
                          step performance below. */}
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: C.textMuted }}>
                        {t("dashx.campsByIcp.compSectionTitle")}
                      </p>
                      {(() => {
                        const sortedFlows = [...sec.flows].sort((a, b) => b.conversionRate - a.conversionRate || b.positive - a.positive);
                        const sectionMaxConv = Math.max(1, ...sortedFlows.map(f => f.conversionRate));
                        // Top is whoever has the highest conv% AND at least
                        // one contact. A flow with 0 contacts isn't "best"
                        // — it's dormant, no signal.
                        const topName = sortedFlows.find(f => (f.leads - (f.uncontactedLeads ?? 0)) > 0 && f.conversionRate > 0)?.name ?? null;
                        return sortedFlows.map((c: Flow, sortIdx) => {
                          const flowSteps = data.stepPerformanceByFlow?.[c.name] ?? [];
                          const contacted = Math.max(0, c.leads - (c.uncontactedLeads ?? 0));
                          const isTop = c.name === topName;
                          const isDormant = contacted === 0;
                          // Medal color: gold #1 (the real top), silver #2,
                          // bronze #3, neutral border for the rest. Dormant
                          // flows (no contacts) skip the medal so they don't
                          // pretend to be ranked.
                          const medalColor = isDormant ? C.textDim
                            : sortIdx === 0 && isTop ? "#D4AF37"
                            : sortIdx === 1 ? "#9CA3AF"
                            : sortIdx === 2 ? "#A0522D"
                            : C.textDim;
                          const accentBorder = isTop ? gold : C.border;
                          return (
                          <details key={c.name} data-camp-status={c.status} className="rounded-xl border overflow-hidden"
                            style={{
                              borderColor: accentBorder,
                              backgroundColor: C.card,
                              borderTopWidth: 3,
                              borderTopColor: isTop ? gold : medalColor === C.textDim ? C.border : medalColor,
                              boxShadow: isTop ? `0 4px 14px color-mix(in srgb, ${gold} 18%, transparent)` : "0 1px 2px rgba(0,0,0,0.03)",
                            }}>
                            <summary className="px-4 py-3 cursor-pointer hover:bg-black/[0.02] transition-colors">
                              {/* Header row: rank medal + flow name + status + chevron */}
                              <div className="flex items-center gap-3 mb-3">
                                <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[12px] font-bold tabular-nums"
                                  style={{
                                    background: isDormant ? C.surface : `color-mix(in srgb, ${medalColor} 18%, transparent)`,
                                    color: medalColor,
                                    border: `1px solid color-mix(in srgb, ${medalColor} 35%, transparent)`,
                                  }}>
                                  {isDormant ? "—" : `#${sortIdx + 1}`}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <Link
                                    href={withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters)}
                                    className="text-[14px] font-bold truncate hover:underline block"
                                    style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
                                  >
                                    {c.name}
                                  </Link>
                                  {isTop && (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em] mt-0.5" style={{ color: gold }}>
                                      <Trophy size={9} /> {t("dashx.campsByIcp.medalBest")}
                                    </span>
                                  )}
                                  {isDormant && (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em] mt-0.5" style={{ color: C.textDim }}>
                                      {t("dashx.campsByIcp.medalDormant")}
                                    </span>
                                  )}
                                </div>
                                <StatusBadge status={c.status} t={t} />
                                <ChevronRight size={16} className="acc-chevron shrink-0" style={{ color: C.textMuted }} />
                              </div>
                              {/* 4 big stat tiles — Contacted / Won / Lost / Steps.
                                  Each one deep-links into the matching section
                                  of the campaign detail. The Link inside the
                                  <summary> stops propagation so the click
                                  navigates instead of toggling the accordion. */}
                              {(() => {
                                const detailBase = withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters);
                                const detailHref = (anchor: string) => `${detailBase}#${anchor}`;
                                return (
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                                    <ScoreTile label={t("dashx.campsByIcp.colContacted")} value={contacted} color="#0284C7" href={detailHref("funnel")} />
                                    <ScoreTile label={t("dashx.campsByIcp.colWon")} value={c.positive} color={C.green} accent={c.positive > 0} href={detailHref("leads")} />
                                    <ScoreTile label={t("dashx.campsByIcp.colLost")} value={c.negative ?? 0} color={C.red} accent={(c.negative ?? 0) > 0} href={detailHref("leads")} />
                                    <ScoreTile label={t("dashx.campsByIcp.colSteps")} value={c.totalSteps || "—"} color="#7C3AED" href={detailHref("sequence")} />
                                  </div>
                                );
                              })()}
                              {/* Conv% — full-width bar with the rate as a
                                  big right-aligned label. Bar scaled to the
                                  section's top conv so #1 hits 100%. */}
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
                                  <div className="h-full rounded-full" style={{
                                    width: `${Math.min(100, Math.round((c.conversionRate / sectionMaxConv) * 100))}%`,
                                    background: c.conversionRate > 0
                                      ? `linear-gradient(90deg, ${C.green}, color-mix(in srgb, ${C.green} 60%, white))`
                                      : C.border,
                                  }} />
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-[22px] font-bold tabular-nums leading-none" style={{
                                    color: c.conversionRate > 0 ? C.green : C.textDim,
                                    fontFamily: "var(--font-outfit), system-ui, sans-serif",
                                    letterSpacing: "-0.02em",
                                  }}>
                                    {c.conversionRate}%
                                  </p>
                                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] mt-0.5" style={{ color: C.textDim }}>
                                    {t("dashx.campsByIcp.colConv")}
                                  </p>
                                </div>
                              </div>
                            </summary>
                            <div className="px-4 py-4 border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              {flowSteps.length === 0 ? (
                                <p className="text-[12px] text-center py-4" style={{ color: C.textMuted }}>
                                  {t("dashx.step.empty")}
                                </p>
                              ) : (
                                <StepPerformance
                                  steps={flowSteps}
                                  locale={locale}
                                  hrefFor={(step) => `${withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters)}#step-${step}`}
                                />
                              )}
                              <div className="mt-3 flex justify-end">
                                <Link href={withFilters(`/dashboard/campaign/${encodeURIComponent(c.name)}`, filters)}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
                                  style={{ color: gold }}>
                                  {t("dashx.panel.openCampaigns")} <ArrowRight size={11} />
                                </Link>
                              </div>
                            </div>
                          </details>
                        );
                      });
                      })()}
                    </div>
                  </details>
                ))}
              </div>
            );
          })()}
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

      {/* Filters live in the unified top bar now (one line, all tabs). */}

      {/* Unified Channels Panel — wraps the 4 channel cards + comparison
          bar in ONE container so the chapter reads as a single chapter
          instead of 3 sections (cards / comparison / heatmap). Boss
          feedback 2026-05-28: "es medio parecido todo, dame propuestas
          para reorganizar". Mix of options A + B. */}
      <Panel
        title={t("dashx.channels.title")}
        subtitle={withScope(t("dashx.channels.unifiedSubtitle"))}
        actionHref="/queue?tab=inbox"
        actionLabel={t("dashx.panel.openInbox")}
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
            <ChannelComparison channels={data.channelBreakdown} t={t} emptyLabel={t("dashx.channels.empty")} linkedinConnections={data.linkedinConnections} />
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

      {/* Filters live in the unified top bar now (one line, all tabs). */}

      {/* Call outcomes by seller — per-seller, per-day call monitoring with
          outcome reasons. Moved here from Channels (Fran 2026-06-11): it's a
          seller metric, not a channel one. Wrapped in Panel + bare so it
          matches the rest of the dashboard tables (dark header + flush table). */}
      <section>
        <Panel
          title={t("dashx.callsByUser.title")}
          subtitle={withScope(t("dashx.callsByUser.subtitle"))}
          actionHref="/queue?tab=calls"
          actionLabel={t("dashx.calls.openQueue")}
          glow
        >
          <CallOutcomesBySeller rows={data.callOutcomesBySeller} bare />
        </Panel>
      </section>

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
                <Th align="right"><span title={t("dashx.tbl.col.activeColHint")} style={{ cursor: "help" }}>{t("dashx.tbl.col.active")}</span></Th>
                <Th align="right"><span title={t("dashx.tbl.col.contactedColHint")} style={{ cursor: "help" }}>{t("dashx.tbl.col.contacted")}</span></Th>
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

      {/* Team averages — boss 2026-05-29: "ya sé que tenemos el detalle de
          los sellers pero está muy escondido tenemos que ser más simples".
          Surfaces each seller's delta vs the team baseline on 4 axes
          (Reply % · Conv % · Contacted · Positives) without forcing the
          operator to drill into the per-seller detail page. Empty state
          when there's < 2 sellers (no team to compare against). */}
      {(() => {
        type SellerForAvg = {
          id: string; name: string;
          contacted: number; replied: number; positive: number;
          responseRate: number; conversionRate: number;
        };
        const sellers = data.sellerPerformance as unknown as SellerForAvg[];
        if (sellers.length === 0) return null;
        // Only show the comparison when there are ≥2 sellers (otherwise
        // every delta is trivially 0). Render the section header + an
        // empty hint so the seller knows the feature exists.
        const hasTeam = sellers.length >= 2;
        const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
        const teamReplyRate = Math.round(avg(sellers.map(s => s.responseRate)));
        const teamConvRate  = Math.round(avg(sellers.map(s => s.conversionRate)));
        const teamContacted = Math.round(avg(sellers.map(s => s.contacted)) * 10) / 10;
        const teamPositive  = Math.round(avg(sellers.map(s => s.positive)) * 10) / 10;
        // Per-seller deltas: rates use percentage-point deltas (absolute),
        // counts use percent deltas (relative to the team avg) so the
        // sign + magnitude reads as "this seller is X% off the baseline".
        return (
          <Panel
            title={t("dashx.sellerAvg.title")}
            subtitle={t("dashx.sellerAvg.subtitle")}
            glow
          >
            {/* Top strip — the TEAM BASELINE (average across all sellers).
                Wrapped + gold-labeled so it visibly reads as "the team total",
                distinct from the per-seller cards below (boss 2026-06-08). */}
            <div className="rounded-2xl border mb-4 overflow-hidden"
              style={{ borderColor: `color-mix(in srgb, ${gold} 32%, ${C.border})`, background: `color-mix(in srgb, ${gold} 6%, ${C.card})` }}>
              <div className="flex items-center gap-2 px-3 pt-2.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: gold }} />
                <p className="text-[9.5px] font-bold uppercase tracking-[0.16em]" style={{ color: gold }}>
                  {t("dashx.sellerAvg.teamTotalLabel")}
                </p>
                <span className="text-[10px]" style={{ color: C.textDim }}>· {t("dashx.sellerAvg.teamTotalHint", { n: sellers.length })}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
                {[
                  { label: t("dashx.sellerAvg.replyRate"),  value: `${teamReplyRate}%`, color: "#7C3AED" },
                  { label: t("dashx.sellerAvg.conversion"), value: `${teamConvRate}%`,  color: C.green },
                  { label: t("dashx.sellerAvg.contacted"),  value: teamContacted,        color: "#0284C7" },
                  { label: t("dashx.sellerAvg.positives"),  value: teamPositive,         color: gold },
                ].map(tile => (
                  <div key={tile.label} className="rounded-xl border px-3 py-2.5"
                    style={{ borderColor: C.border, backgroundColor: C.card }}>
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textDim }}>
                      {tile.label}
                    </p>
                    <p className="text-[22px] font-bold tabular-nums leading-tight tracking-[-0.02em] mt-0.5"
                      style={{ color: tile.color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                      {tile.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {!hasTeam ? (
              <p className="text-center py-6 text-[12px] italic" style={{ color: C.textMuted }}>
                {t("dashx.sellerAvg.empty")}
              </p>
            ) : (
              <div className="space-y-2">
                {sellers.map(s => {
                  const dReply = s.responseRate - teamReplyRate;     // pp
                  const dConv  = s.conversionRate - teamConvRate;     // pp
                  const dCont  = teamContacted > 0 ? Math.round(((s.contacted - teamContacted) / teamContacted) * 100) : 0;
                  const dPos   = teamPositive > 0  ? Math.round(((s.positive  - teamPositive)  / teamPositive)  * 100) : 0;
                  const scores = [dReply, dConv, dCont, dPos];
                  const wins = scores.filter(d => d > 0).length;
                  const losses = scores.filter(d => d < 0).length;
                  const verdict = wins >= 3 ? "above" : losses >= 3 ? "below" : "track";
                  const verdictColor = verdict === "above" ? C.green : verdict === "below" ? C.red : C.textMuted;
                  const verdictLabel = verdict === "above"
                    ? t("dashx.sellerAvg.aboveTeam")
                    : verdict === "below"
                      ? t("dashx.sellerAvg.belowTeam")
                      : t("dashx.sellerAvg.onTrack");
                  return (
                    <Link key={s.id} href={withFilters(`/dashboard/seller/${s.id}`, filters)}
                      className="block rounded-xl border px-4 py-3 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:shadow-md group"
                      style={{ borderColor: C.border, backgroundColor: C.card }}>
                      <div className="flex items-center gap-3 mb-2">
                        <p className="text-[14px] font-bold truncate flex-1 group-hover:underline"
                          style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                          {s.name}
                        </p>
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${verdictColor} 14%, transparent)`,
                            color: verdictColor,
                            border: `1px solid color-mix(in srgb, ${verdictColor} 30%, transparent)`,
                          }}>
                          {verdictLabel}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <DeltaChip label={t("dashx.sellerAvg.replyRate")}  value={`${s.responseRate}%`}    delta={dReply} unit="pp" />
                        <DeltaChip label={t("dashx.sellerAvg.conversion")} value={`${s.conversionRate}%`}  delta={dConv}  unit="pp" />
                        <DeltaChip label={t("dashx.sellerAvg.contacted")}  value={s.contacted}              delta={dCont}  unit="%" />
                        <DeltaChip label={t("dashx.sellerAvg.positives")}  value={s.positive}               delta={dPos}   unit="%" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Panel>
        );
      })()}

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
          // No champion without PROVEN activity on the channel (boss 2026-06-08:
          // "no puedo estar primero si no hice ningún llamado"). A seller can be
          // assigned call-channel leads without ever dialing; requiring ≥1 reply
          // on the channel ensures the crown reflects real outreach + result.
          const top = sorted[0];
          return top && top[repliedKey] > 0 ? top : null;
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

      {/* Workload Distribution removed (boss 2026-06-08): noise — the active /
          pending counts already live in the seller leaderboard above. */}

      </section>
      )}
      <SwlSignature caption={t("dashx.brand.captionMain")} tagline={t("dashx.brand.tagline")} />
    </div>
  );
}

// ─── Local presentation primitives ──────────────────────────────────────

// Compact label + value chip, used in the Campaigns-by-ICP metrics strip.
function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="text-right">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textDim }}>{label}</p>
      <p className="text-[14px] font-bold tabular-nums leading-none mt-0.5" style={{ color: accent ?? C.textPrimary }}>
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </p>
    </div>
  );
}

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

// ScoreTile lives in `components/dashboard/ScoreTile.tsx` so it can carry
// the onClick stopPropagation needed when the tile is wrapped in a Link
// inside the <details>/<summary> head-to-head card — Server Components
// (this file) cannot pass event handlers across the RSC boundary.

/** DeltaChip — used by the Sellers tab "Team averages" comparison rows.
 * Renders label + current value + signed delta vs the team baseline with
 * an up/down arrow + color (green when above, red when below, muted at 0).
 * `unit="pp"` for rate deltas (percentage points), `unit="%"` for count
 * deltas (relative to baseline). */
function DeltaChip({ label, value, delta, unit }: {
  label: string;
  value: string | number;
  delta: number;
  unit: "pp" | "%";
}) {
  const positive = delta > 0;
  const negative = delta < 0;
  const color = positive ? C.green : negative ? C.red : C.textMuted;
  const sign = positive ? "+" : negative ? "" : "±";
  return (
    <div className="rounded-lg border px-2.5 py-1.5"
      style={{ borderColor: C.border, backgroundColor: C.surface }}>
      <p className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color: C.textDim }}>{label}</p>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-[15px] font-bold tabular-nums leading-none" style={{ color: C.textPrimary }}>
          {value}
        </span>
        <span className="text-[10px] font-bold tabular-nums" style={{ color }}>
          {positive ? "▴" : negative ? "▾" : "─"} {sign}{Math.abs(delta)}{unit}
        </span>
      </div>
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

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
