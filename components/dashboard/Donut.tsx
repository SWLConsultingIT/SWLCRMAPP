"use client";

// Reply classification donut — premium interactive version.
//   - Hover/click any slice → it pops out, dims the others, the center
//     label switches from total → that slice's count + %.
//   - Click navigates to the inbox filtered by that classification (each
//     slice gets a `href`).
//   - Period delta chip per legend item showing +/- vs prior period.
//   - Vertical legend on the right uses the panel width and gives each
//     entry room to breathe.

import Link from "next/link";
import { useState } from "react";
import { C } from "@/lib/design";

type Slice = {
  label: string;
  value: number;
  color: string;
  /** Optional classification id for /inbox?classification=... drill-down. */
  classKey?: string;
  /** Prior-period count for the delta chip. */
  prior?: number;
};

const gold = "var(--brand, #c9a83a)";

export default function Donut({
  data,
  size = 240,
  thickness = 32,
  centerLabel = "replies",
  emptyLabel = "No replies in the period",
  vsPriorLabel = "vs prior",
  classifierNote,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  emptyLabel?: string;
  /** Locale label used for the delta chip tooltip. */
  vsPriorLabel?: string;
  /** When set, renders a permanent caption under the legend explaining
   * how the classification works (boss feedback 2026-05-28: "meeting
   * intent cómo se hace?"). Hidden tooltips weren't enough. */
  classifierNote?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const total = data.reduce((acc, s) => acc + s.value, 0);
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  // Center label content — defaults to total, switches to the hovered
  // slice's count + classification on hover.
  const centerContent = hoverIdx !== null && data[hoverIdx]
    ? {
        primary: data[hoverIdx].value.toLocaleString("en-US"),
        secondary: data[hoverIdx].label,
        color: data[hoverIdx].color,
      }
    : {
        primary: total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total.toLocaleString("en-US"),
        secondary: centerLabel,
        color: C.textPrimary,
      };

  return (
    <div className="w-full flex flex-col sm:flex-row items-center sm:items-stretch gap-4 sm:gap-5 py-1">
      {/* Ring */}
      <div
        className="relative shrink-0 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        {/* Gold glow halo — visible only when something's hovered, so the
            interaction feels alive without being noisy at rest. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full transition-opacity duration-200 pointer-events-none"
          style={{
            background: `radial-gradient(circle, color-mix(in srgb, ${gold} 10%, transparent) 0%, transparent 65%)`,
            opacity: hoverIdx !== null ? 1 : 0.4,
          }}
        />
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {total > 0 && (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={thickness} opacity={0.4} />
          )}
          <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
            {total === 0 ? (
              <circle r={r} fill="none" stroke={C.border} strokeWidth={thickness} strokeDasharray="2,4" opacity={0.6} />
            ) : data.map((s, i) => {
              if (s.value === 0) return null;
              const len = (s.value / total) * c;
              const dasharray = `${len} ${c - len}`;
              const dashoffset = -offset;
              offset += len;
              const isHover = hoverIdx === i;
              const isOther = hoverIdx !== null && hoverIdx !== i;
              return (
                <circle key={i}
                  r={r} fill="none"
                  stroke={s.color}
                  strokeWidth={isHover ? thickness + 4 : thickness}
                  strokeLinecap="butt"
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset}
                  opacity={isOther ? 0.28 : 1}
                  style={{ transition: "stroke-width 160ms, opacity 160ms", cursor: "pointer" }}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              );
            })}
          </g>
          <g pointerEvents="none">
            <text
              x={size / 2}
              y={size / 2 - 4}
              textAnchor="middle"
              fontSize={hoverIdx !== null ? 30 : 32}
              fontWeight={700}
              fill={centerContent.color}
              style={{ fontFeatureSettings: '"tnum"', letterSpacing: "-0.02em", transition: "fill 160ms" }}
            >
              {centerContent.primary}
            </text>
            <text
              x={size / 2}
              y={size / 2 + 16}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={700}
              fill={C.textMuted}
              letterSpacing="0.18em"
              style={{ textTransform: "uppercase" }}
            >
              {centerContent.secondary}
            </text>
            {hoverIdx !== null && total > 0 && data[hoverIdx] && (
              <text
                x={size / 2}
                y={size / 2 + 32}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={600}
                fill={C.textBody}
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {Math.round((data[hoverIdx].value / total) * 100)}%
              </text>
            )}
          </g>
        </svg>
      </div>

      {/* Right column — clickable legend with delta chips. Each row links
          into /inbox?classification=<key> so the donut becomes a drill-in
          (boss feedback round 5 #2). */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
        {data.length === 0 ? (
          <p className="text-[12px] text-center sm:text-left" style={{ color: C.textDim }}>{emptyLabel}</p>
        ) : (
          <ul className="space-y-1">
            {data.map((s, i) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              const isHover = hoverIdx === i;
              const dim = hoverIdx !== null && !isHover;
              // Delta chip — only rendered when there's a prior figure
              // to compare against, AND the change is meaningful. 0/0
              // becomes null so we don't crow about "+0% from 0".
              const delta = (s.prior != null && s.prior > 0)
                ? Math.round(((s.value - s.prior) / s.prior) * 100)
                : (s.prior === 0 && s.value > 0 ? 100 : null);
              const href = s.classKey ? `/inbox?classification=${encodeURIComponent(s.classKey)}` : null;
              const rowInner = (
                <>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: s.color,
                      boxShadow: isHover ? `0 0 0 3px color-mix(in srgb, ${s.color} 22%, transparent)` : "none",
                    }}
                  />
                  <span className="flex-1 truncate" style={{ color: C.textBody }}>{s.label}</span>
                  {delta !== null && (
                    <span
                      className="inline-flex items-center text-[9.5px] font-bold tabular-nums px-1.5 py-[1px] rounded"
                      style={{
                        backgroundColor: delta > 0
                          ? "color-mix(in srgb, #10B981 14%, transparent)"
                          : delta < 0
                          ? "color-mix(in srgb, #DC2626 14%, transparent)"
                          : `color-mix(in srgb, ${C.textMuted} 8%, transparent)`,
                        color: delta > 0 ? "#059669" : delta < 0 ? "#DC2626" : C.textMuted,
                      }}
                      title={vsPriorLabel}
                    >
                      {delta > 0 ? "+" : ""}{delta}%
                    </span>
                  )}
                  <span className="font-semibold" style={{ color: C.textPrimary }}>{s.value}</span>
                  <span className="text-[10.5px] tabular-nums" style={{ color: C.textDim }}>{pct}%</span>
                </>
              );
              const rowProps = {
                onMouseEnter: () => setHoverIdx(i),
                onMouseLeave: () => setHoverIdx(null),
                className: "flex items-center gap-2.5 px-2 py-1 rounded-md text-[12px] tabular-nums transition-[background-color,opacity] cursor-pointer",
                style: {
                  backgroundColor: isHover ? `color-mix(in srgb, ${s.color} 10%, transparent)` : "transparent",
                  opacity: dim ? 0.55 : 1,
                },
              } as const;
              return (
                <li key={s.label}>
                  {href ? (
                    <Link href={href} {...rowProps}>{rowInner}</Link>
                  ) : (
                    <div {...rowProps}>{rowInner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* Classifier footnote — visible, no hover. */}
        {classifierNote && data.length > 0 && (
          <p className="text-[10px] leading-snug mt-1 px-2" style={{ color: C.textDim }}>
            {classifierNote}
          </p>
        )}
      </div>
    </div>
  );
}
