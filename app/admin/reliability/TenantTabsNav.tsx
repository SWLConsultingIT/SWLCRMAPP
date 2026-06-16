"use client";

// Tab nav for /admin/reliability — one tab per tenant (company_bio).
// Tab selection lives in the `tenant` searchParam; the server reads it
// and renders that tenant's summary. The active tab gets a colored
// indicator pill based on the health verdict so operators can see at
// a glance which tenant needs attention before clicking through.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { C } from "@/lib/design";
import { AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

export type TenantTab = {
  bioId: string;
  bioName: string;
  health: "healthy" | "warning" | "critical";
};

export default function TenantTabsNav({
  tabs,
  activeBioId,
}: {
  tabs: TenantTab[];
  activeBioId: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const buildHref = (bioId: string) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.set("tenant", bioId);
    return `${pathname}?${next.toString()}`;
  };

  const tone = (h: TenantTab["health"]) => {
    if (h === "critical") return { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 10%, transparent)", icon: AlertTriangle };
    if (h === "warning") return { fg: "#D97706", bg: "color-mix(in srgb, #D97706 10%, transparent)", icon: AlertCircle };
    return { fg: C.green, bg: `color-mix(in srgb, ${C.green} 10%, transparent)`, icon: CheckCircle2 };
  };

  return (
    <div className="border-b mb-6 sticky top-0 z-30" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${C.bg} 95%, transparent)`, backdropFilter: "blur(8px)" }}>
      <div className="flex items-center gap-1 px-6 overflow-x-auto" style={{ minHeight: 56 }}>
        {tabs.map(t => {
          const isActive = t.bioId === activeBioId;
          const T = tone(t.health);
          const Icon = T.icon;
          return (
            <Link
              key={t.bioId}
              href={buildHref(t.bioId)}
              className="shrink-0 flex items-center gap-2 px-4 py-3 transition-opacity hover:opacity-90"
              style={{
                borderBottom: isActive ? `2px solid ${gold}` : "2px solid transparent",
                color: isActive ? C.textPrimary : C.textBody,
                fontWeight: isActive ? 700 : 500,
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
              }}
            >
              <Icon size={14} style={{ color: T.fg }} />
              <span className="text-sm whitespace-nowrap">{t.bioName}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: T.bg, color: T.fg }}>
                {t.health === "healthy" ? "ok" : t.health === "warning" ? "atención" : "crítico"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
