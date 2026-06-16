// /admin/reliability — REDESIGN 2026-06-10.
//
// Full-width layout with one tab per tenant (company_bio). Inside each
// tab, three sections:
//   1. Status General — narrative paragraph + KPIs that explain how
//      the tenant has been doing the last 7 days. Replaces the
//      "please ask Claude what's going on" pattern.
//   2. Status Campaigns — invites sent / queued / stuck / failed,
//      with the WHY of failures grouped by reason.
//   3. Status Accounts — sellers (LinkedIn via Unipile) + Instantly
//      mailbox health.
//
// Server component. Only super_admin sees this page (canViewSwlAdmin).

import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { redirect } from "next/navigation";
import { C } from "@/lib/design";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { getAllTenantSummaries } from "@/lib/reliability-summary";
import TenantTabsNav from "./TenantTabsNav";
import StatusGeneralSection from "./StatusGeneralSection";
import StatusCampaignsSection from "./StatusCampaignsSection";
import StatusAccountsSection from "./StatusAccountsSection";
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

  const all = await getAllTenantSummaries();
  if (all.length === 0) {
    return (
      <div className="px-6 py-12 max-w-2xl mx-auto text-center">
        <p style={{ color: C.textBody }}>No hay company_bios configurados todavía.</p>
      </div>
    );
  }

  // Resolve active tenant from URL — default to the FIRST critical/
  // warning tenant so issues bubble up; otherwise the first tab.
  const requestedTenant = typeof sp.tenant === "string" ? sp.tenant : undefined;
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

  return (
    <div className="w-full">
      {/* Header strip — full width */}
      <div className="px-6 pt-6 pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E", boxShadow: `0 3px 10px color-mix(in srgb, ${gold} 32%, transparent)` }}>
              <ShieldCheck size={18} />
            </div>
            <div>
              <h1 className="text-[20px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>Reliability</h1>
              <p className="text-[12px]" style={{ color: C.textMuted }}>
                Salud del sistema por tenant · {all.length} tenant{all.length === 1 ? "" : "s"} monitoreado{all.length === 1 ? "" : "s"} · auto-refresh cada 60s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textMuted }}>
            <RefreshCw size={11} />
            <span>actualizado: {new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</span>
          </div>
        </div>
      </div>

      {/* Tenant tabs — sticky, full width */}
      <TenantTabsNav tabs={tabs} activeBioId={activeTenant.bioId} />

      {/* Active tenant sections */}
      <div className="px-6 pb-12 space-y-5">
        <StatusGeneralSection summary={activeTenant} />
        <StatusCampaignsSection summary={activeTenant} />
        <StatusAccountsSection summary={activeTenant} />
      </div>

      <AutoRefresh />
    </div>
  );
}
