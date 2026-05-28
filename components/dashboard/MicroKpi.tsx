// Compact KPI strip used beneath the HeroStat row on Overview.
//
// Why a separate component from KpiCard: KpiCard is the standalone hero
// box used when a stat needs to stand on its own (sparkline, footer hint,
// delta, etc). MicroKpi is the "supporting cast" used when 3-4 secondary
// numbers sit beneath the hero — single line, no sparkline, light delta
// chip on the right. Keeps the eye on the hero while still surfacing
// secondary KPIs at-a-glance.

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { C, T } from "@/lib/design";

export default function MicroKpi({
  label,
  value,
  hint,
  delta,
  vsPriorLabel,
  noPriorLabel,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  delta?: number | null;
  vsPriorLabel: string;
  noPriorLabel: string;
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  accent?: string;
  href?: string;
}) {
  const accentColor = accent ?? C.gold;
  const Body = (
    <div
      // Boss feedback 2026-05-28 round B: cards needed more visual
      // hierarchy. Icon tile larger (44×44), padding bumped, accent rail
      // thicker on the left, number much bigger so the eye lands on it
      // before the label.
      className="relative rounded-xl border overflow-hidden px-4 py-4 flex items-center gap-3.5 transition-[transform,box-shadow] hover:-translate-y-[1px] hover:shadow-md"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        borderLeft: `4px solid ${accentColor}`,
      }}
    >
      {Icon && (
        <span
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${accentColor} 14%, transparent)`,
            color: accentColor,
            border: `1px solid color-mix(in srgb, ${accentColor} 22%, transparent)`,
          }}
        >
          <Icon size={18} />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className={`${T.label} truncate`} style={{ color: C.textMuted }}>
          {label}
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className="text-[28px] font-bold tabular-nums leading-none tracking-[-0.02em]"
            style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
          >
            {value}
          </span>
          {hint && (
            <span className="text-[10.5px] truncate" style={{ color: C.textDim }}>
              {hint}
            </span>
          )}
        </div>
      </div>
      {/* Delta chip — only renders when we have a number; explicitly tucked
          in the corner so the eye reads the value first. */}
      {delta !== undefined && delta !== null ? (
        <span
          className="shrink-0 inline-flex items-center gap-0.5 text-[10.5px] font-bold tabular-nums px-1.5 py-1 rounded-md"
          style={{
            backgroundColor: delta > 0
              ? "color-mix(in srgb, #10B981 12%, transparent)"
              : delta < 0
              ? "color-mix(in srgb, #DC2626 12%, transparent)"
              : C.surface,
            color: delta > 0 ? "#059669" : delta < 0 ? "#DC2626" : C.textMuted,
          }}
          title={vsPriorLabel}
        >
          {delta > 0 ? <ArrowUpRight size={10} /> : delta < 0 ? <ArrowDownRight size={10} /> : <Minus size={10} />}
          {Math.abs(delta)}%
        </span>
      ) : delta === null ? (
        <span className="shrink-0 text-[10px]" style={{ color: C.textDim }} title={noPriorLabel}>
          —
        </span>
      ) : null}
    </div>
  );

  return href ? <Link href={href} className="block">{Body}</Link> : Body;
}
