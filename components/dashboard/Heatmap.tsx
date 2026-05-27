"use client";

// Activity heatmap — 7 days × 24 hours with optional per-channel filter
// and a "best contact window" callout. Round 5 boss feedback #3:
//   - Channel filter chips (All / LinkedIn / Email / Call) so the
//     operator can spot per-channel reply timing patterns.
//   - Best window callout next to the grid: derives the single hottest
//     (day, hour) cell of the active matrix and frames it as a
//     recommendation.
//
// Labels (days, channel chips, unit, callout copy) come in via props so
// the parent owns localization.

import { useState } from "react";
import { Share2, Mail, Phone, Layers } from "lucide-react";
import { C } from "@/lib/design";

const DEFAULT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const gold = "var(--brand, #c9a83a)";

export type HeatmapChannelKey = "all" | "linkedin" | "email" | "call";

export default function Heatmap({
  matrix,
  byChannel,
  days = DEFAULT_DAYS,
  unitLabel = "events",
  legendMin = "Less",
  legendMax = "More",
  channelLabels = { all: "All", linkedin: "LinkedIn", email: "Email", call: "Calls" },
  bestWindowLabel = "Best window",
  bestWindowEmpty = "Not enough data yet",
  bestWindowSubtitle = "Recommended outreach time",
  peakLabel = "Peak (top 3)",
  timezoneLabel = "Hours in",
}: {
  /** Aggregate fallback. Used when byChannel is not supplied. */
  matrix: number[][];
  /** Per-channel matrices — when provided, renders a channel filter on
   *  top of the grid. Keys: all / linkedin / email / call. */
  byChannel?: Record<HeatmapChannelKey, number[][]>;
  days?: string[];
  unitLabel?: string;
  legendMin?: string;
  legendMax?: string;
  channelLabels?: Record<HeatmapChannelKey, string>;
  bestWindowLabel?: string;
  bestWindowEmpty?: string;
  bestWindowSubtitle?: string;
  peakLabel?: string;
  timezoneLabel?: string;
}) {
  const [channel, setChannel] = useState<HeatmapChannelKey>("all");
  // Hours in the grid are interpreted in the browser's local timezone (we
  // store reply timestamps in UTC and pass them to .getHours() which converts
  // to local). Surfacing the resolved zone removes any "what timezone is this"
  // ambiguity boss flagged on 2026-05-27.
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const active = byChannel?.[channel] ?? matrix;
  const max = Math.max(1, ...active.flat());

  // Top-3 hot cells of the active matrix (for the gold ring markers).
  type Cell = { d: number; h: number; v: number };
  const cells: Cell[] = [];
  for (let d = 0; d < active.length; d++) {
    for (let h = 0; h < 24; h++) {
      const v = active[d]?.[h] ?? 0;
      if (v > 0) cells.push({ d, h, v });
    }
  }
  const sorted = cells.sort((a, b) => b.v - a.v);
  const top3 = sorted.slice(0, 3);
  const peak = sorted[0];
  const isTop = (d: number, h: number) => top3.some(c => c.d === d && c.h === h);

  const channelChips: { id: HeatmapChannelKey; Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; color: string }[] = [
    { id: "all",      Icon: Layers,  color: C.textBody },
    { id: "linkedin", Icon: Share2,  color: "#0A66C2" },
    { id: "email",    Icon: Mail,    color: "#059669" },
    { id: "call",     Icon: Phone,   color: "#EA580C" },
  ];

  const CELL = 22;
  const GAP = 4;

  return (
    <div className="w-full">
      {/* Timezone hint — always visible so the operator knows the hour
          axis is local, not UTC. Small + dim so it doesn't compete with
          the chart. */}
      {browserTz && (
        <p className="text-[10.5px] mb-2 flex items-center gap-1.5" style={{ color: C.textDim }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.textMuted }} aria-hidden />
          {timezoneLabel} <span className="font-medium" style={{ color: C.textMuted }}>{browserTz}</span>
        </p>
      )}
      {/* Channel filter chips (only when per-channel matrices supplied) */}
      {byChannel && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {channelChips.map(c => {
            const on = c.id === channel;
            const Icon = c.Icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChannel(c.id)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors"
                style={{
                  backgroundColor: on ? `color-mix(in srgb, ${c.color} 14%, transparent)` : "transparent",
                  borderColor: on ? `color-mix(in srgb, ${c.color} 38%, transparent)` : C.border,
                  color: on ? c.color : C.textMuted,
                }}
              >
                <Icon size={12} />
                {channelLabels[c.id]}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Grid */}
        <div className="overflow-x-auto flex-1 min-w-0">
          <div className="inline-block min-w-full">
            {/* Hour axis */}
            <div className="flex items-center mb-2 pl-12" style={{ gap: GAP }}>
              {Array.from({ length: 24 }).map((_, h) => (
                <div
                  key={h}
                  className="text-[9.5px] text-center font-semibold tracking-wider"
                  style={{ width: CELL, color: h % 3 === 0 ? C.textMuted : C.textDim }}
                >
                  {h % 3 === 0 ? `${h}` : ""}
                </div>
              ))}
            </div>
            {days.map((label, d) => (
              <div key={d} className="flex items-center mb-1" style={{ gap: GAP }}>
                <span className="text-[11px] font-semibold w-10 text-right tabular-nums uppercase tracking-wider" style={{ color: C.textMuted }}>
                  {label}
                </span>
                <div className="flex" style={{ gap: GAP }}>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const v = active[d]?.[h] ?? 0;
                    const intensity = v / max;
                    const bg = intensity === 0
                      ? C.surface
                      : `color-mix(in srgb, ${gold} ${Math.round(22 + intensity * 73)}%, ${C.bg})`;
                    const peakCell = isTop(d, h);
                    return (
                      <div
                        key={h}
                        title={`${label} ${h}:00 — ${v} ${unitLabel}`}
                        style={{
                          width: CELL, height: CELL, borderRadius: 5,
                          backgroundColor: bg,
                          border: peakCell
                            ? `1.5px solid ${gold}`
                            : intensity === 0
                              ? `1px solid ${C.border}`
                              : `1px solid color-mix(in srgb, ${gold} ${Math.round(20 + intensity * 35)}%, transparent)`,
                          boxShadow: peakCell
                            ? `0 0 0 2px color-mix(in srgb, ${gold} 32%, transparent), 0 2px 8px color-mix(in srgb, ${gold} 22%, transparent)`
                            : intensity > 0.5
                              ? `0 1px 3px color-mix(in srgb, ${gold} 18%, transparent)`
                              : undefined,
                          cursor: v > 0 ? "pointer" : "default",
                          transition: "transform 120ms ease, box-shadow 120ms ease",
                        }}
                        className={v > 0 ? "hover:scale-110" : ""}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between mt-4 pl-12 text-[10.5px]" style={{ color: C.textMuted }}>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: gold, boxShadow: `0 0 0 2px color-mix(in srgb, ${gold} 28%, transparent)` }} />
                <span style={{ color: C.textDim }}>{peakLabel}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span>{legendMin}</span>
                <div className="flex gap-0.5">
                  {[0.05, 0.3, 0.55, 0.8, 1].map((p, i) => (
                    <div key={i} style={{
                      width: 18, height: 10, borderRadius: 3,
                      backgroundColor: p < 0.1 ? C.surface : `color-mix(in srgb, ${gold} ${Math.round(15 + p * 70)}%, ${C.bg})`,
                      border: `1px solid ${C.border}`,
                    }} />
                  ))}
                </div>
                <span>{legendMax}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Best window callout */}
        <div
          className="shrink-0 lg:w-[200px] rounded-xl border p-4 self-start"
          style={{
            background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 12%, ${C.card}) 0%, ${C.card} 100%)`,
            borderColor: `color-mix(in srgb, ${gold} 28%, ${C.border})`,
            boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 14%, transparent)`,
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: gold }}>
            {bestWindowLabel}
          </p>
          {peak && peak.v >= 2 ? (
            <>
              <p
                className="mt-2 text-[24px] font-bold tabular-nums leading-none tracking-[-0.02em]"
                style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
              >
                {days[peak.d]} · {String(peak.h).padStart(2, "0")}:00
              </p>
              <p className="text-[11px] mt-1.5" style={{ color: C.textBody }}>
                {peak.v} {unitLabel}
              </p>
              <p className="text-[10.5px] mt-2.5 leading-snug" style={{ color: C.textDim }}>
                {bestWindowSubtitle}
              </p>
            </>
          ) : (
            <p className="text-[11.5px] mt-2 leading-snug" style={{ color: C.textDim }}>
              {bestWindowEmpty}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
