"use client";

// Tab nav for /admin/reliability — one tab per tenant (company_bio).
// Sticky pill-style tabs with elevated active state + health pill so
// the operator sees at a glance which tenant needs attention.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { C } from "@/lib/design";
import { AlertTriangle, AlertCircle, CheckCircle2, Globe } from "lucide-react";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

export type TenantTab = {
  bioId: string;
  bioName: string;
  health: "healthy" | "warning" | "critical";
};

export const GENERAL_TAB_ID = "general";

export default function TenantTabsNav({
  tabs,
  activeBioId,
}: {
  tabs: TenantTab[];
  activeBioId: string;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();

  const buildHref = (bioId: string) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.set("tenant", bioId);
    // When the seller switches tenant, drop the campaign drill-in so
    // they always land on the tenant overview, not a stale campaign
    // detail from a different tenant.
    next.delete("campaign");
    return `${pathname}?${next.toString()}`;
  };

  const tone = (h: TenantTab["health"]) => {
    if (h === "critical") return { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 12%, transparent)", border: "color-mix(in srgb, #DC2626 32%, transparent)", icon: AlertTriangle };
    if (h === "warning") return { fg: "#D97706", bg: "color-mix(in srgb, #D97706 12%, transparent)", border: "color-mix(in srgb, #D97706 32%, transparent)", icon: AlertCircle };
    return { fg: C.green, bg: `color-mix(in srgb, ${C.green} 12%, transparent)`, border: `color-mix(in srgb, ${C.green} 32%, transparent)`, icon: CheckCircle2 };
  };

  return (
    <div className="sticky top-0 z-30 border-b" style={{
      borderColor: C.border,
      background: `color-mix(in srgb, ${C.bg} 92%, transparent)`,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    }}>
      <div className="px-6 lg:px-10 py-3 flex items-center gap-2 overflow-x-auto">
        {/* General tab — first, always present. The default landing. */}
        {(() => {
          const isActive = activeBioId === GENERAL_TAB_ID;
          return (
            <Link
              href={buildHref(GENERAL_TAB_ID)}
              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl transition-all"
              style={isActive ? {
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                color: "#1A1A2E",
                boxShadow: `0 4px 14px -4px color-mix(in srgb, ${gold} 45%, transparent), 0 1px 3px rgba(0,0,0,0.06)`,
                border: `1px solid color-mix(in srgb, ${gold} 50%, transparent)`,
              } : {
                backgroundColor: C.card,
                color: C.textBody,
                border: `1px solid ${C.border}`,
              }}
            >
              <Globe size={13} style={{ color: isActive ? "#1A1A2E" : gold }} />
              <span className="text-[13px] font-semibold whitespace-nowrap" style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {t("rel.tabs.general")}
              </span>
            </Link>
          );
        })()}
        {/* Divider */}
        <div className="shrink-0 w-px h-8 mx-1" style={{ backgroundColor: C.border }} />
        {tabs.map(tab => {
          const isActive = tab.bioId === activeBioId;
          const T = tone(tab.health);
          const Icon = T.icon;
          return (
            <Link
              key={tab.bioId}
              href={buildHref(tab.bioId)}
              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl transition-all"
              style={isActive ? {
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                color: "#1A1A2E",
                boxShadow: `0 4px 14px -4px color-mix(in srgb, ${gold} 45%, transparent), 0 1px 3px rgba(0,0,0,0.06)`,
                border: `1px solid color-mix(in srgb, ${gold} 50%, transparent)`,
              } : {
                backgroundColor: C.card,
                color: C.textBody,
                border: `1px solid ${C.border}`,
              }}
            >
              <Icon size={13} style={{ color: isActive ? "#1A1A2E" : T.fg }} />
              <span className="text-[13px] font-semibold whitespace-nowrap" style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {tab.bioName}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full"
                style={isActive ? {
                  backgroundColor: "rgba(26,26,46,0.18)",
                  color: "#1A1A2E",
                } : {
                  backgroundColor: T.bg,
                  color: T.fg,
                  border: `1px solid ${T.border}`,
                }}>
                {tab.health === "healthy" ? "ok" : tab.health === "warning" ? "atención" : "crítico"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
