"use client";

// Seller performance chart — dot + line chart with seller filter.
// Shows daily values (calls made / answer % / interested) for up to 2 sellers
// selected via toggle buttons. Replaces the SellerTrendTable which was too
// abstract when the prior period had no data.

import { useState, useMemo } from "react";
import { C } from "@/lib/design";

const OUTFIT = "var(--font-outfit), system-ui, sans-serif";

// Two contrast colors: gold (brand) and sky blue. A third seller would get
// green — but we cap at 2 active at once for readability.
const PALETTE = ["#C9A83A", "#38BDF8", "#22C55E"];

type DayCounts = {
  made: number; answered: number; interested: number;
  badTiming: number; voicemail: number; notInterested: number; wrongNumber: number;
};
type SellerStats = {
  sellerId: string;
  sellerName: string;
  active?: boolean;
  made: number;
  answered: number;
  interested: number;
  byDay: Record<string, DayCounts>;
};

type MetricKey = "made" | "answerPct" | "interested" | "badTiming" | "voicemail";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "made",      label: "Calls" },
  { key: "answerPct", label: "Answer %" },
  { key: "interested",label: "Interested" },
  { key: "badTiming", label: "Bad timing" },
  { key: "voicemail", label: "Voicemail" },
];

function dayValue(d: DayCounts | undefined, metric: MetricKey): number {
  if (!d) return 0;
  if (metric === "made")      return d.made;
  if (metric === "answerPct") return d.made === 0 ? 0 : Math.round((d.answered / d.made) * 100);
  if (metric === "interested")return d.interested;
  if (metric === "badTiming") return d.badTiming;
  if (metric === "voicemail") return d.voicemail;
  return 0;
}

function fmtAxisDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Chart dimensions (viewBox units, not pixels)
const VW = 700;
const VH = 220;
const PAD = { top: 20, right: 16, bottom: 40, left: 38 };
const CW  = VW - PAD.left - PAD.right;
const CH  = VH - PAD.top  - PAD.bottom;

export default function SellerPerformanceChart({
  rows,
}: {
  rows: SellerStats[];
}) {
  const activeSellers = rows.filter(r => r.active !== false);
  const allSellers    = rows; // inactive ones still selectable

  const [selected, setSelected] = useState<string[]>(() =>
    activeSellers.slice(0, Math.min(2, activeSellers.length)).map(r => r.sellerId),
  );
  const [metric, setMetric] = useState<MetricKey>("made");

  const toggle = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) {
        // Always keep at least 1 selected
        return prev.length > 1 ? prev.filter(x => x !== id) : prev;
      }
      if (prev.length >= 2) {
        // Replace the oldest selection
        return [prev[1], id];
      }
      return [...prev, id];
    });
  };

  const selectedRows = allSellers.filter(r => selected.includes(r.sellerId));

  // Collect all days present in any selected seller's data, sorted ascending
  const allDays: string[] = useMemo(() => {
    const s = new Set<string>();
    for (const r of selectedRows) Object.keys(r.byDay).forEach(d => s.add(d));
    return Array.from(s).sort();
  }, [selectedRows]);

  // Build per-seller series
  const series = selectedRows.map((r, idx) => ({
    id:     r.sellerId,
    name:   r.sellerName,
    color:  PALETTE[idx % PALETTE.length],
    values: allDays.map(d => dayValue(r.byDay[d], metric)),
  }));

  const allValues  = series.flatMap(s => s.values);
  const maxVal     = Math.max(...allValues, 1);
  const isSingle   = allDays.length <= 1;
  const isPct      = metric === "answerPct";
  const yMax       = isPct ? Math.max(maxVal, 10) : Math.max(maxVal, 2);

  const xOf = (i: number) =>
    PAD.left + (isSingle ? CW / 2 : (i / (allDays.length - 1)) * CW);
  const yOf = (v: number) =>
    PAD.top + CH - (v / yMax) * CH;

  // Y-axis grid lines: 4 evenly spaced ticks
  const ticks = [0, 1, 2, 3].map(i => Math.round((yMax * i) / 3));

  // X-axis labels: max ~8 visible
  const xLabelStep = allDays.length <= 8 ? 1 : Math.ceil(allDays.length / 8);

  if (allSellers.length === 0) return null;

  return (
    <div>
      {/* Metric tabs */}
      <div className="flex items-center gap-1 px-4 pt-4 pb-3 flex-wrap">
        {METRICS.map(m => {
          const active = metric === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              style={{
                fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 6,
                background: active ? "rgba(201,168,58,0.14)" : "transparent",
                color:      active ? "#C9A83A" : "rgba(255,255,255,0.35)",
                border:     active ? "1px solid rgba(201,168,58,0.3)" : "1px solid transparent",
                cursor: "pointer", transition: "all .12s",
                fontFamily: OUTFIT,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Seller toggles */}
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {allSellers.map(r => {
          const isOn    = selected.includes(r.sellerId);
          const selIdx  = selected.indexOf(r.sellerId);
          const color   = isOn ? PALETTE[selIdx % PALETTE.length] : undefined;
          return (
            <button
              key={r.sellerId}
              onClick={() => toggle(r.sellerId)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 600, padding: "5px 13px", borderRadius: 8,
                background: isOn ? `${color}18` : "transparent",
                color:      isOn ? color : "rgba(255,255,255,0.35)",
                border:     `1px solid ${isOn ? `${color}45` : "rgba(255,255,255,0.1)"}`,
                cursor: "pointer", transition: "all .15s",
                fontFamily: OUTFIT,
                opacity: r.active === false ? 0.5 : 1,
              }}
            >
              <span style={{
                width: 9, height: 9, borderRadius: "50%",
                background: isOn ? color : "rgba(255,255,255,0.2)",
                display: "inline-block", flexShrink: 0,
                transition: "background .15s",
              }} />
              {r.sellerName}
              {r.active === false && (
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginLeft: 2 }}>left</span>
              )}
            </button>
          );
        })}
        {selected.length >= 2 && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", alignSelf: "center", fontFamily: OUTFIT }}>
            max 2
          </span>
        )}
      </div>

      {/* SVG chart */}
      {allDays.length === 0 ? (
        <div className="px-4 pb-6 text-center">
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontFamily: OUTFIT }}>No data for the selected period</p>
        </div>
      ) : (
        <div className="px-2 pb-4">
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            style={{ width: "100%", height: "auto", display: "block" }}
          >
            {/* Y-axis grid lines + labels */}
            {ticks.map(tick => (
              <g key={tick}>
                <line
                  x1={PAD.left} y1={yOf(tick)}
                  x2={PAD.left + CW} y2={yOf(tick)}
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth={0.5}
                  strokeDasharray="4 4"
                />
                <text
                  x={PAD.left - 7} y={yOf(tick) + 3.5}
                  textAnchor="end"
                  fontSize={10}
                  fill="rgba(255,255,255,0.3)"
                  fontFamily="system-ui, sans-serif"
                >
                  {tick}{isPct ? "%" : ""}
                </text>
              </g>
            ))}

            {/* X-axis baseline */}
            <line
              x1={PAD.left} y1={PAD.top + CH}
              x2={PAD.left + CW} y2={PAD.top + CH}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={0.5}
            />

            {/* X-axis day labels */}
            {allDays.map((day, i) => {
              if (i % xLabelStep !== 0 && i !== allDays.length - 1) return null;
              return (
                <text
                  key={day}
                  x={xOf(i)} y={VH - PAD.bottom + 15}
                  textAnchor="middle"
                  fontSize={9.5}
                  fill="rgba(255,255,255,0.3)"
                  fontFamily="system-ui, sans-serif"
                >
                  {fmtAxisDay(day)}
                </text>
              );
            })}

            {/* Series lines + dots */}
            {series.map(s => {
              const pts = allDays.map((_, i) => `${xOf(i).toFixed(1)},${yOf(s.values[i]).toFixed(1)}`);
              return (
                <g key={s.id}>
                  {/* Connecting line */}
                  {!isSingle && (
                    <polyline
                      points={pts.join(" ")}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={0.75}
                    />
                  )}

                  {/* Dots */}
                  {allDays.map((_, i) => {
                    const v = s.values[i];
                    const cx = xOf(i);
                    const cy = yOf(v);
                    return (
                      <g key={i}>
                        {/* Halo for readability */}
                        <circle cx={cx} cy={cy} r={5.5} fill={s.color} opacity={0.15} />
                        {/* Dot */}
                        <circle
                          cx={cx} cy={cy} r={v > 0 ? 4 : 2.5}
                          fill={v > 0 ? s.color : "rgba(255,255,255,0.15)"}
                          stroke={v > 0 ? "rgba(0,0,0,0.4)" : "none"}
                          strokeWidth={1}
                        />
                        {/* Value label above dot (only if > 0 and not too crowded) */}
                        {v > 0 && allDays.length <= 14 && (
                          <text
                            x={cx} y={cy - 8}
                            textAnchor="middle"
                            fontSize={10}
                            fontWeight="700"
                            fill={s.color}
                            fontFamily="system-ui, sans-serif"
                          >
                            {v}{isPct ? "%" : ""}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Legend label at the last dot */}
                  {(() => {
                    const lastIdx = allDays.length - 1;
                    const lx = xOf(lastIdx) + 7;
                    const ly = yOf(s.values[lastIdx]) + 3;
                    // Prevent label from going off right edge
                    const anchor = lx + 60 > VW ? "end" : "start";
                    const lxFinal = anchor === "end" ? xOf(lastIdx) - 7 : lx;
                    return (
                      <text
                        x={lxFinal} y={ly}
                        textAnchor={anchor}
                        fontSize={10.5}
                        fontWeight="700"
                        fill={s.color}
                        fontFamily="system-ui, sans-serif"
                        opacity={0.9}
                      >
                        {s.name}
                      </text>
                    );
                  })()}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
