// Hero stat card — the dashboard's marquee number. Sits at the top of the
// Overview chapter, paired with an AI Insight panel on the right side.
//
// Design: huge tabular number (52px) with gold gradient text, sparkline
// occupies the lower half, delta chip + secondary stats fill the side
// column. The card is dark-navy to anchor the gold; this is the single
// place on the dashboard where the "gold on dark" treatment lives, so it
// reads as the executive headline rather than yet-another-KPI-card.

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { C, N, T } from "@/lib/design";
import Sparkline from "./Sparkline";

const gold = "var(--brand, #c9a83a)";

export default function HeroStat({
  eyebrow,
  label,
  value,
  unit,
  delta,
  vsPriorLabel,
  noPriorLabel,
  trend,
  href,
  secondary = [],
  icon: Icon,
}: {
  eyebrow: string;
  label: string;
  value: string | number;
  unit?: string;
  delta?: number | null;
  vsPriorLabel: string;
  noPriorLabel: string;
  trend?: number[];
  href?: string;
  /** Up to 3 secondary stats rendered in the right column underneath the delta */
  secondary?: { label: string; value: string | number; tone?: "default" | "success" | "warning" | "danger" }[];
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  const Body = (
    <div
      className="relative rounded-2xl border overflow-hidden flex flex-col sm:flex-row"
      style={{
        borderColor: `color-mix(in srgb, ${gold} 32%, ${N.hairline})`,
        background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 55%, ${N.ink3} 100%)`,
        minHeight: 260,
        boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 18%, transparent), 0 18px 40px -16px ${N.ink}`,
      }}
    >
      {/* Background glow — gold radial in the top-right corner so the hero
          number sits inside a halo of warmth */}
      <div
        aria-hidden
        className="absolute -top-24 -right-24 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 22%, transparent) 0%, transparent 65%)` }}
      />

      {/* Left — hero number + sparkline */}
      <div className="relative flex-1 p-5 sm:p-6 flex flex-col justify-between">
        <div className="flex items-start gap-3">
          {Icon && (
            <span
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`,
                color: N.ink,
                boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 38%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
              }}
            >
              <Icon size={16} />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <p
              className={`${T.label}`}
              style={{ color: N.goldOnDark, opacity: 0.85 }}
            >
              {eyebrow}
            </p>
            <p
              className="text-[12.5px] mt-0.5"
              style={{ color: "color-mix(in srgb, white 70%, transparent)" }}
            >
              {label}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="flex items-baseline gap-2 flex-wrap">
            <span
              className={`${T.numHero}`}
              style={{
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                background: `linear-gradient(135deg, #FFF7DA 0%, ${gold} 60%, ${N.goldOnDark} 100%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                textShadow: `0 1px 0 color-mix(in srgb, ${gold} 12%, transparent)`,
              }}
            >
              {value}
            </span>
            {unit && (
              <span className="text-[16px] font-semibold" style={{ color: "color-mix(in srgb, white 65%, transparent)" }}>
                {unit}
              </span>
            )}
          </p>

          {trend && trend.length > 0 && (
            <div className="mt-3 -ml-1">
              <Sparkline data={trend} color={gold} width={220} height={36} />
            </div>
          )}
        </div>
      </div>

      {/* Right — delta + secondary stats column. Hairline divider in gold
          so the dark surface is visibly split into "number side" and
          "context side" without a heavy border. */}
      <div
        className="relative w-full sm:w-[220px] shrink-0 p-5 sm:p-6 flex flex-col gap-4"
        style={{
          borderTop: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
          backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)`,
        }}
      >
        <div
          className="absolute hidden sm:block left-0 top-6 bottom-6 w-px"
          aria-hidden
          style={{ background: `linear-gradient(to bottom, transparent 0%, color-mix(in srgb, ${gold} 38%, transparent) 50%, transparent 100%)` }}
        />

        {/* Delta */}
        <div>
          <p className={`${T.label}`} style={{ color: "color-mix(in srgb, white 55%, transparent)" }}>
            {vsPriorLabel}
          </p>
          <div className="mt-1.5">
            {delta !== undefined && delta !== null ? (
              delta > 0 ? (
                <p className="flex items-baseline gap-1.5">
                  <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: "#26D07C" }}>
                    <ArrowUpRight size={16} className="inline -mt-0.5 mr-0.5" />
                    {delta}%
                  </span>
                </p>
              ) : delta < 0 ? (
                <p className="flex items-baseline gap-1.5">
                  <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: "#FF6B6B" }}>
                    <ArrowDownRight size={16} className="inline -mt-0.5 mr-0.5" />
                    {Math.abs(delta)}%
                  </span>
                </p>
              ) : (
                <p className="flex items-baseline gap-1.5">
                  <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: "color-mix(in srgb, white 50%, transparent)" }}>
                    <Minus size={16} className="inline -mt-0.5 mr-0.5" />0%
                  </span>
                </p>
              )
            ) : (
              <p className="text-[12px]" style={{ color: "color-mix(in srgb, white 50%, transparent)" }}>
                {noPriorLabel}
              </p>
            )}
          </div>
        </div>

        {/* Secondary stats */}
        {secondary.length > 0 && (
          <div className="flex flex-col gap-2.5 pt-3" style={{ borderTop: `1px dashed color-mix(in srgb, ${gold} 18%, transparent)` }}>
            {secondary.map((s, i) => {
              const toneColor = s.tone === "success" ? "#26D07C"
                : s.tone === "warning" ? "#F2B23E"
                : s.tone === "danger" ? "#FF6B6B"
                : "color-mix(in srgb, white 90%, transparent)";
              return (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: "color-mix(in srgb, white 55%, transparent)" }}>
                    {s.label}
                  </span>
                  <span className="text-[15px] font-bold tabular-nums" style={{ color: toneColor }}>
                    {s.value}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return href ? <Link href={href} className="block transition-opacity hover:opacity-95">{Body}</Link> : Body;
}
