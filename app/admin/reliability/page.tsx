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
import { ShieldCheck, RefreshCw } from "lucide-react";
import { getAllTenantSummaries, getTenantCampaigns, getCampaignDetail } from "@/lib/reliability-summary";
import { getT, getServerLocale } from "@/lib/i18n-server";
import TenantTabsNav from "./TenantTabsNav";
import StatusGeneralSection from "./StatusGeneralSection";
import FlowsInFlightSection from "./FlowsInFlightSection";
import StatusAccountsSection from "./StatusAccountsSection";
import CampaignDetailSection from "./CampaignDetailSection";
import AutoRefresh from "./AutoRefresh";

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

  // Resolve active tenant from URL — default to the first critical/
  // warning tenant so issues bubble up; otherwise the first tab.
  const requestedTenant = typeof sp.tenant === "string" ? sp.tenant : undefined;
  const requestedCampaign = typeof sp.campaign === "string" ? sp.campaign : undefined;

  const activeTenant = (() => {
    if (requestedTenant) {
      const match = all.find(s => s.bioId === requestedTenant);
      if (match) return match;
    }
    return all.find(s => s.general.health === "critical")
        ?? all.find(s => s.general.health === "warning")
        ?? all[0];
  })();

  const tabs = all.map(s => ({ bioId: s.bioId, bioName: s.bioName, health: s.general.health }));

  // Drill-in path: ?tenant=X&campaign=Y → fetch the single campaign's
  // detail and replace the per-tenant body with CampaignDetailSection.
  let campaignDetail = null;
  if (requestedCampaign) {
    campaignDetail = await getCampaignDetail(requestedCampaign);
    // If the campaign doesn't belong to the active tenant, ignore.
    if (campaignDetail && campaignDetail.bioId !== activeTenant.bioId) {
      campaignDetail = null;
    }
  }

  // For the campaigns list, fetch only when we're NOT in drill-in.
  const tenantCampaigns = campaignDetail ? [] : await getTenantCampaigns(activeTenant.bioId);

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
        <div className="px-6 lg:px-10 py-7 flex items-center justify-between gap-4 flex-wrap relative z-10">
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${gold} 28%, transparent)`, color: gold }}>
            <RefreshCw size={11} />
            <span className="text-[11px] font-semibold tabular-nums">
              {t("rel.hero.lastUpdated", { when: new Date().toLocaleString(locale === "es" ? "es-AR" : "en-US", { dateStyle: "short", timeStyle: "short" }) })}
            </span>
          </div>
        </div>
        {/* Decorative bottom accent bar */}
        <div className="absolute left-0 right-0 bottom-0 h-[2px]"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 30%, ${gold} 70%, transparent 100%)`, opacity: 0.4 }} />
      </div>

      {/* Tenant tabs — sticky, full width */}
      <TenantTabsNav tabs={tabs} activeBioId={activeTenant.bioId} />

      {/* Body: either single-campaign drill-in OR tenant overview */}
      <div className="px-6 pb-12 space-y-5">
        {campaignDetail ? (
          <CampaignDetailSection detail={campaignDetail} />
        ) : (
          <>
            <StatusGeneralSection summary={activeTenant} />
            <FlowsInFlightSection summary={activeTenant} campaigns={tenantCampaigns} />
            <StatusAccountsSection summary={activeTenant} />
          </>
        )}
      </div>

      <AutoRefresh />
    </div>
  );
}
