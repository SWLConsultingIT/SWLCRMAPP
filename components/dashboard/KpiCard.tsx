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
      className="relative rounded-2xl border overflow-hidden transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md flex flex-col"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        minHeight: 156,
      }}
    >
      {/* Brand accent corner — subtle radial that picks up the accent color. */}
      <div
        aria-hidden
        className="absolute -top-10 -right-10 w-28 h-28 rounded-full opacity-60 pointer-events-none"
        style={{ background: `radial-gradient(circle, ${accentColor}1f 0%, transparent 70%)` }}
      />
      {/* Header — icon + label, fixed height so the cards line up perfectly. */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 relative">
        {Icon && (
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 14%, transparent)`, color: accentColor }}>
            <Icon size={12} />
          </span>
        )}
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] truncate" style={{ color: C.textMuted }}>
          {label}
        </span>
      </div>
      {/* Main value + sparkline. flex-1 so the footer sits on the floor. */}
      <div className="px-4 flex items-end justify-between gap-2 flex-1 relative">
        <p className="text-[28px] font-bold tabular-nums leading-none" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.025em" }}>
          {value}
        </p>
        {trend && trend.length > 0 && (
          <div className="opacity-90 shrink-0 -mb-1">
            <Sparkline data={trend} color={trendColor ?? accentColor} width={78} height={32} />
          </div>
        )}
      </div>
      {/* Footer — delta on top line, hint underneath. Both single-line, truncate. */}
      <div className="px-4 pb-3 pt-2 relative" style={{ borderTop: `1px dashed color-mix(in srgb, ${C.border} 60%, transparent)`, marginTop: 8 }}>
        {delta !== undefined && delta !== null ? (
          <p className="text-[11px] font-medium truncate" style={{ color: C.textDim }}>
            {delta > 0 ? (
              <span className="font-bold" style={{ color: C.green }}>
                <ArrowUpRight size={11} className="inline -mt-0.5" /> {delta}%
              </span>
            ) : delta < 0 ? (
              <span className="font-bold" style={{ color: C.red }}>
                <ArrowDownRight size={11} className="inline -mt-0.5" /> {Math.abs(delta)}%
              </span>
            ) : (
              <span className="font-bold" style={{ color: C.textDim }}>
                <Minus size={11} className="inline -mt-0.5" /> 0%
              </span>
            )}
            <span className="ml-1">vs anterior</span>
          </p>
        ) : delta === null ? (
          <p className="text-[11px] truncate" style={{ color: C.textDim }}>Sin comparable</p>
        ) : null}
        {hint && (
          <p className="text-[10px] mt-0.5 truncate" style={{ color: C.textMuted }} title={hint}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );

  return href ? <Link href={href} className="block">{Body}</Link> : Body;
}
