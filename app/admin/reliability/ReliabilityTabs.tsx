"use client";

// Tab nav for /admin/reliability — three logical buckets so the page
// stops being a 1200-line vertical scroll:
//
//   • status   → health banner + tenant grid + action-required + sellers
//   • pipeline → queue (ready / cooldown / waiting) + dispatching
//   • history  → sent 24h reconciliation + skipped + expired
//
// Tab selection lives in the `tab` searchParam (server reads it) and the
// component just paints the active state + builds the next URL. We
// preserve every other param (tenant, noise) when switching so filters
// stick.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { C } from "@/lib/design";
import { Activity, Workflow, History, type LucideIcon } from "lucide-react";

export type ReliabilityTabKey = "status" | "pipeline" | "history";

const gold = "var(--brand, #c9a83a)";

type Counts = { status: number; pipeline: number; history: number };

export default function ReliabilityTabs({
  active,
  counts,
}: {
  active: ReliabilityTabKey;
  counts: Counts;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const buildHref = (tab: ReliabilityTabKey) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (tab === "status") next.delete("tab");
    else next.set("tab", tab);
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  const tabs: Array<{ key: ReliabilityTabKey; label: string; sub: string; icon: LucideIcon; tone: "danger" | "neutral" | "muted" }> = [
    { key: "status",   label: "Status",   sub: "Acción + salud por tenant",     icon: Activity, tone: counts.status > 0 ? "danger" : "neutral" },
    { key: "pipeline", label: "Pipeline", sub: "Queue, cooldowns, en vuelo",    icon: Workflow, tone: counts.pipeline > 0 ? "neutral" : "muted" },
    { key: "history",  label: "History",  sub: "24h enviado, skipped, expired", icon: History,  tone: "muted" },
  ];

  return (
    <div className="rounded-2xl border overflow-hidden mb-5"
      style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="grid grid-cols-3">
        {tabs.map((t, i) => {
          const isActive = t.key === active;
          const Icon = t.icon;
          const accent = t.tone === "danger" ? C.red : t.tone === "neutral" ? gold : C.textMuted;
          const count = counts[t.key];
          return (
            <Link
              key={t.key}
              href={buildHref(t.key)}
              prefetch={false}
              className="px-4 py-3 flex items-center gap-3 transition-colors hover:bg-black/[0.02] relative"
              style={{
                borderLeft: i > 0 ? `1px solid ${C.border}` : "none",
                borderBottom: isActive ? `2px solid ${accent}` : "2px solid transparent",
                backgroundColor: isActive ? `color-mix(in srgb, ${accent} 6%, transparent)` : "transparent",
              }}
            >
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: isActive ? `color-mix(in srgb, ${accent} 14%, transparent)` : C.surface,
                  color: isActive ? accent : C.textMuted,
                }}>
                <Icon size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold" style={{ color: isActive ? C.textPrimary : C.textBody }}>
                    {t.label}
                  </span>
                  {count > 0 && (
                    <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                        color: accent,
                      }}>
                      {count}
                    </span>
                  )}
                </div>
                <p className="text-[10.5px] truncate" style={{ color: C.textMuted }}>{t.sub}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
