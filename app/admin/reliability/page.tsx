// /admin/reliability — REDESIGN 2026-06-10.
//
// Full-width layout with one tab per tenant (company_bio). Inside each
// tab, four sections:
//   1. Status General — narrative paragraph + KPIs ("ask Claude" killer)
//   2. Status Campaigns — invites sent / queued / stuck / failed, WHY
//   3. Campaigns list — clickable rows that drill into a single campaign
//   4. Status Accounts — sellers (Unipile) + Instantly workspace
//
// When ?campaign=<id> is set, the campaigns list + status sections are
// replaced by a CampaignDetailSection scoped to that single campaign.

import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { redirect } from "next/navigation";
import { C } from "@/lib/design";
import { ShieldCheck } from "lucide-react";
import { getAllTenantSummaries, getTenantCampaigns, buildGlobalSummary } from "@/lib/reliability-summary";
import { getT, getServerLocale } from "@/lib/i18n-server";
import TenantTabsNav from "./TenantTabsNav";
import StatusGeneralSection from "./StatusGeneralSection";
import FlowsInFlightSection from "./FlowsInFlightSection";
import StatusAccountsSection from "./StatusAccountsSection";
import SilentStallBanner from "./SilentStallBanner";
import GeneralOverview from "./GeneralOverview";
import HistorySection from "./HistorySection";
import AutoRefresh from "./AutoRefresh";

const GENERAL_TAB_ID = "general";

export const dynamic = "force-dynamic";

const gold = "var(--brand, #c9a83a)";

export default async function ReliabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) {
    redirect("/");
  }

  const t = await getT();
  const locale = await getServerLocale();
  const all = await getAllTenantSummaries();
  if (all.length === 0) {
    return (
      <div className="px-6 py-12 max-w-2xl mx-auto text-center">
        <p style={{ color: C.textBody }}>No hay company_bios configurados todavía.</p>
      </div>
    );
  }

  // The "General" tab (cross-tenant overview) is the default landing.
  // A specific tenant tab is shown when ?tenant=<bioId> matches a known
  // company_bio; ?tenant=general (or anything else) → General.
  const requestedTenant = typeof sp.tenant === "string" ? sp.tenant : undefined;
  const requestedCampaign = typeof sp.campaign === "string" ? sp.campaign : undefined;

  const activeTenant = requestedTenant && requestedTenant !== GENERAL_TAB_ID
    ? all.find(s => s.bioId === requestedTenant) ?? null
    : null;
  const isGeneral = !activeTenant;
  const activeBioId = activeTenant?.bioId ?? GENERAL_TAB_ID;

  const tabs = all.map(s => ({ bioId: s.bioId, bioName: s.bioName, health: s.general.health }));

  // The old `?campaign=Y` drill-in was retired 2026-06-16. Flow cards
  // expand INLINE so the operator never leaves the page.
  void requestedCampaign;

  // Per-tenant campaigns fetched only when on a tenant tab.
  const tenantCampaigns = activeTenant ? await getTenantCampaigns(activeTenant.bioId) : [];
  const globalSummary = isGeneral ? buildGlobalSummary(all) : null;

  return (
    <div className="w-full">
      {/* HERO — full-width gold-accented banner. Establishes the page
          identity (Reliability = mission control). Bigger title, gold
          glow halo, decorative gradient bar at the bottom. */}
      <div className="relative overflow-hidden border-b" style={{
        borderColor: `color-mix(in srgb, ${gold} 30%, ${C.border})`,
        background: `
          radial-gradient(ellipse 90% 140% at 15% 0%, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 60%),
          radial-gradient(ellipse 60% 100% at 95% 100%, color-mix(in srgb, ${gold} 12%, transparent) 0%, transparent 60%),
          linear-gradient(180deg, ${C.card} 0%, ${C.card} 100%)
        `,
      }}>
        <div className="px-6 lg:px-10 py-10 flex items-center justify-between gap-4 flex-wrap relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 65%, white))`,
                color: "#1A1A2E",
                boxShadow: `0 8px 20px -6px color-mix(in srgb, ${gold} 45%, transparent), 0 2px 4px rgba(0,0,0,0.05)`,
              }}>
              <ShieldCheck size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: gold }}>
                  {t("rel.hero.eyebrow1")}
                </p>
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: gold }} />
                <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
                  {t("rel.hero.eyebrow2")}
                </p>
              </div>
              <h1 className="text-[28px] font-bold leading-none mb-1.5" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                {t("rel.hero.title")}
              </h1>
              <p className="text-[12.5px] leading-relaxed" style={{ color: C.textBody }}>
                {all.length === 1 ? t("rel.hero.subtitle.one") : t("rel.hero.subtitle", { count: all.length })}
              </p>
            </div>
          </div>
          {/* Hero controls — Updated/Refresh/Auto. Moved here from the
              page bottom 2026-06-16 so the operator finds them where
              mission-control style chrome lives (top-right). */}
          <AutoRefresh />
        </div>
        {/* Decorative bottom accent bar */}
        <div className="absolute left-0 right-0 bottom-0 h-[2px]"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 30%, ${gold} 70%, transparent 100%)`, opacity: 0.4 }} />
      </div>

      {/* Tenant tabs — sticky, full width. First tab is "General". */}
      <TenantTabsNav tabs={tabs} activeBioId={activeBioId} />

      {/* Body: either single-campaign drill-in OR tenant overview.
          Generous outer padding + tall vertical spacing — Fran asked for
          breathing room between sections (previously space-y-5 + py was
          too dense and sections felt crammed). */}
      <div className="px-6 lg:px-10 pt-8 pb-16 space-y-4">
        {isGeneral && globalSummary ? (
          <GeneralOverview global={globalSummary} />
        ) : activeTenant ? (
          <>
            <SilentStallBanner summary={activeTenant} />
            <StatusGeneralSection summary={activeTenant} />
            <FlowsInFlightSection summary={activeTenant} campaigns={tenantCampaigns} />
            <StatusAccountsSection summary={activeTenant} />
            <HistorySection bioId={activeTenant.bioId} />
          </>
        ) : null}
      </div>
    </div>
  );
}
