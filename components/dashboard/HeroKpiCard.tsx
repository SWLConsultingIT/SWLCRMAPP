// Hero KPI card — the "valuable" second-row card under the TodayCard.
// Bigger than MicroKpi (taller, larger number, optional sparkline + small
// trend chip) so the eye reads it as the headline outcome of the period.
//
// Used for the 4 metrics that matter most after the to-do hero: Won /
// Lost / Reply Rate / Win Rate. Each card deep-links into the surface
// where the operator can act on the number.

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { C, T } from "@/lib/design";
import Sparkline from "./Sparkline";

const gold = "var(--brand, #c9a83a)";

export default function HeroKpiCard({
  label,
  value,
  unit,
  hint,
  delta,
  vsPriorLabel,
  noPriorLabel,
  trend,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  delta?: number | null;
  vsPriorLabel: string;
  noPriorLabel: string;
  trend?: number[];
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  accent?: string;
  href?: string;
}) {
  const accentColor = accent ?? gold;
  const isUp = typeof delta === "number" && delta > 0;
  const isDown = typeof delta === "number" && delta < 0;

  const Body = (
    <div
      className="relative rounded-2xl border overflow-hidden p-4 pb-3.5 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-lg group"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        minHeight: 144,
      }}
    >
      {/* Accent corner halo — radial in the channel/accent color, becomes
          more visible on hover. Gives each card a subtle "glow" that
          differentiates it from the flat MicroKpi strip below. */}
      <span
        aria-hidden
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none opacity-60 transition-opacity group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${accentColor} 22%, transparent) 0%, transparent 65%)` }}
      />
      {/* Left edge accent line — narrows when hovered. Quiet brand cue. */}
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ background: `linear-gradient(180deg, ${accentColor} 0%, color-mix(in srgb, ${accentColor} 40%, transparent) 100%)` }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {Icon && (
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 14%, transparent)`, color: accentColor }}
              >
                <Icon size={11} />
              </span>
            )}
            <p className={`${T.label} truncate`} style={{ color: C.textMuted }}>
              {label}
            </p>
          </div>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span
              className="text-[32px] font-bold tabular-nums leading-none tracking-[-0.025em]"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
            >
              {value}
            </span>
            {unit && (
              <span className="text-[12px] font-semibold" style={{ color: C.textMuted }}>
                {unit}
              </span>
            )}
          </p>
        </div>

        {trend && trend.length > 0 && (
          <div className="shrink-0 -mr-1 -mt-1 opacity-90">
            <Sparkline data={trend} color={accentColor} width={62} height={28} />
          </div>
        )}
      </div>

      {/* Footer — delta chip + hint */}
      <div className="relative mt-3 pt-2.5 flex items-center justify-between gap-2" style={{ borderTop: `1px dashed color-mix(in srgb, ${C.border} 65%, transparent)` }}>
        <span className="text-[10.5px] truncate" style={{ color: C.textDim }} title={hint}>
          {hint}
        </span>
        {delta !== undefined && delta !== null ? (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 text-[10.5px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
            style={{
              backgroundColor: isUp
                ? "color-mix(in srgb, #10B981 14%, transparent)"
                : isDown
                ? "color-mix(in srgb, #DC2626 14%, transparent)"
                : "color-mix(in srgb, var(--c-textMuted) 8%, transparent)",
              color: isUp ? "#059669" : isDown ? "#DC2626" : C.textMuted,
            }}
            title={vsPriorLabel}
          >
            {isUp ? <ArrowUpRight size={10} /> : isDown ? <ArrowDownRight size={10} /> : <Minus size={10} />}
            {Math.abs(delta)}%
          </span>
        ) : delta === null ? (
          <span className="shrink-0 text-[10px]" style={{ color: C.textDim }} title={noPriorLabel}>
            —
          </span>
        ) : null}
      </div>
    </div>
  );

  return href ? <Link href={href} className="block">{Body}</Link> : Body;
}
