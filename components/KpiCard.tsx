"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { C } from "@/lib/design";

export type KpiTone = "neutral" | "brand" | "positive" | "info" | "warning" | "danger";

export type KpiCardProps = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: KpiTone;
  /** Numeric delta vs prior period. Positive = growth, negative = decline. */
  delta?: number | null;
  /** Optional unit suffix for the delta value (default: '%'). */
  deltaUnit?: string;
  /** Whether a negative delta is good (e.g. "fail rate dropped"). Inverts color logic. */
  deltaInverted?: boolean;
  /** Optional spark line: 5-14 daily values; rendered as a faint inline mini-bar trend. */
  spark?: number[] | null;
  /** Short subtext below the value (e.g. "vs last 7 days"). */
  sub?: string;
};

// Per ui-ux-pro-max + Vercel guidelines: ONE accent color per card (no gradients
// over the whole surface), tabular-nums for the number column, focus-visible
// ring for keyboard nav, named transitions (no `transition: all`). The optional
// sparkline uses divs (no chart lib) so it inherits the existing styling cascade.
const TONE_COLOR: Record<KpiTone, string> = {
  neutral:  C.textBody,
  brand:   "var(--brand, #c9a83a)",
  positive: C.green,
  info:     C.blue,
  warning:  "#D97706",
  danger:   C.red,
};

export default function KpiCard({
  label, value, icon: Icon, tone = "neutral",
  delta = null, deltaUnit = "%", deltaInverted = false,
  spark = null, sub,
}: KpiCardProps) {
  const accent = TONE_COLOR[tone];

  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const goodDirection = hasDelta && ((delta as number) > 0 !== deltaInverted);
  const flatDelta = hasDelta && Math.abs(delta as number) < 0.5;
  const deltaColor = !hasDelta ? C.textDim : flatDelta ? C.textMuted : goodDirection ? C.green : C.red;
  const DeltaIcon = !hasDelta ? Minus : flatDelta ? Minus : (delta as number) > 0 ? ArrowUpRight : ArrowDownRight;

  const sparkValid = Array.isArray(spark) && spark.length >= 2;
  const sparkMax = sparkValid ? Math.max(1, ...spark as number[]) : 1;

  return (
    <div
      className="rounded-xl border px-5 py-4 transition-[box-shadow,border-color] duration-200 focus-within:ring-2 focus-within:ring-offset-1"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        // Single 2px accent on the LEFT edge — replaces the prior top-border +
        // radial gradient + icon-shadow stack. Clearer hierarchy, less noise.
        boxShadow: `inset 2px 0 0 ${accent}`,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em] leading-tight"
          style={{ color: C.textMuted }}
        >
          {label}
        </span>
        <Icon size={14} style={{ color: accent, opacity: 0.85 }} />
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <p
          className="text-[28px] font-bold leading-none"
          style={{
            color: C.textPrimary,
            fontFamily: "var(--font-outfit), system-ui, sans-serif",
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </p>
        {hasDelta && (
          <span
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums"
            style={{ color: deltaColor, fontVariantNumeric: "tabular-nums" }}
          >
            <DeltaIcon size={11} strokeWidth={2.5} />
            {flatDelta ? "0" : Math.abs(Math.round((delta as number) * 10) / 10)}
            {deltaUnit}
          </span>
        )}
      </div>

      {(sub || sparkValid) && (
        <div className="flex items-end justify-between gap-3 mt-2 min-h-[18px]">
          {sub && (
            <p className="text-[10px] leading-tight" style={{ color: C.textDim }}>
              {sub}
            </p>
          )}
          {sparkValid && (
            <div
              className="flex items-end gap-[2px] h-[18px] ml-auto"
              aria-hidden="true"
              style={{ minWidth: 56 }}
            >
              {(spark as number[]).map((v, i) => {
                const pct = Math.max(8, Math.round((v / sparkMax) * 100));
                return (
                  <div
                    key={i}
                    style={{
                      width: 4,
                      height: `${pct}%`,
                      backgroundColor: accent,
                      opacity: 0.35 + (i / spark!.length) * 0.55,
                      borderRadius: 1,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
