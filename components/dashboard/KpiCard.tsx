// Hero KPI card: big number + label + delta vs prior period + sparkline.
// Linkable so the click drills down into the relevant detail view (e.g. the
// "Replies" card → /queue?tab=inbox, "Positivos" → opportunities filter, etc).

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { C } from "@/lib/design";
import Sparkline from "./Sparkline";

export default function KpiCard({
  label,
  value,
  delta,
  trend,
  trendColor,
  icon: Icon,
  accent,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  trend?: number[];
  trendColor?: string;
  icon?: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  accent?: string;
  hint?: string;
  href?: string;
}) {
  const accentColor = accent ?? C.gold;
  const Body = (
    <div
      className="relative rounded-2xl border p-5 overflow-hidden transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* Brand accent corner — subtle radial that picks up the accent color. */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-50"
        style={{ background: `radial-gradient(circle, ${accentColor}22 0%, transparent 70%)` }}
      />
      <div className="flex items-start justify-between gap-2 relative">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
          {Icon && (
            <span className="w-6 h-6 rounded-md flex items-center justify-center"
              style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 14%, transparent)`, color: accentColor }}>
              <Icon size={12} />
            </span>
          )}
          <span>{label}</span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 mt-3 relative">
        <div>
          <p className="text-3xl font-bold tabular-nums" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
            {value}
          </p>
          {delta !== undefined && delta !== null && (
            <div className="flex items-center gap-1 mt-1 text-[11px] font-semibold">
              {delta > 0 ? (
                <span className="inline-flex items-center gap-0.5" style={{ color: C.green }}>
                  <ArrowUpRight size={12} /> {delta}%
                </span>
              ) : delta < 0 ? (
                <span className="inline-flex items-center gap-0.5" style={{ color: C.red }}>
                  <ArrowDownRight size={12} /> {Math.abs(delta)}%
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5" style={{ color: C.textDim }}>
                  <Minus size={12} /> 0%
                </span>
              )}
              <span style={{ color: C.textDim }}>vs período anterior</span>
            </div>
          )}
          {delta === null && (
            <p className="text-[11px] mt-1" style={{ color: C.textDim }}>
              Sin datos comparables
            </p>
          )}
          {hint && (
            <p className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>
              {hint}
            </p>
          )}
        </div>
        {trend && trend.length > 0 && (
          <div className="opacity-90">
            <Sparkline data={trend} color={trendColor ?? accentColor} width={88} height={36} />
          </div>
        )}
      </div>
    </div>
  );

  return href ? <Link href={href} className="block">{Body}</Link> : Body;
}
