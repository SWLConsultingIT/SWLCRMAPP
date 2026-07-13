"use client";

// Seller performance chart — professional dot+line SVG chart with seller
// filter (up to 2) and metric tabs. Theme-aware: all colors via CSS variables
// so it works in both light and dark mode.

import { useState, useMemo } from "react";
import { C } from "@/lib/design";

const OUTFIT = "var(--font-outfit), system-ui, sans-serif";
const PALETTE = ["#C9A83A", "#38BDF8"];

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
  { key: "made",       label: "Calls made"  },
  { key: "answerPct",  label: "Answer %"    },
  { key: "interested", label: "Interested"  },
  { key: "badTiming",  label: "Bad timing"  },
  { key: "voicemail",  label: "Voicemail"   },
];

function dayValue(d: DayCounts | undefined, metric: MetricKey): number | null {
  if (d === undefined) return null; // no data this day → gap in line
  if (metric === "made")       return d.made;
  if (metric === "answerPct")  return d.made === 0 ? 0 : Math.round((d.answered / d.made) * 100);
  if (metric === "interested") return d.interested;
  if (metric === "badTiming")  return d.badTiming;
  if (metric === "voicemail")  return d.voicemail;
  return 0;
}

function fmtAxisDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Build an SVG path string that jumps to M on null segments (gap handling)
function buildLinePath(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
): string {
  let path = "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    const x = xOf(i).toFixed(1);
    const y = yOf(v).toFixed(1);
    if (path === "" || values[i - 1] === null) path += `M ${x} ${y}`;
    else path += ` L ${x} ${y}`;
  }
  return path;
}

// Build a filled area path (only segments with contiguous non-null values)
function buildAreaPath(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
  yBottom: number,
): string {
  let path = "";
  let segStart = -1;
  const flush = (end: number) => {
    if (segStart < 0) return;
    const top = values
      .slice(segStart, end + 1)
      .map((v, j) => `${xOf(segStart + j).toFixed(1)},${yOf(v as number).toFixed(1)}`)
      .join(" L ");
    const x0 = xOf(segStart).toFixed(1);
    const x1 = xOf(end).toFixed(1);
    path += ` M ${x0},${yBottom.toFixed(1)} L ${top} L ${x1},${yBottom.toFixed(1)} Z`;
    segStart = -1;
  };
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) {
      if (segStart < 0) segStart = i;
    } else {
      flush(i - 1);
    }
  }
  flush(values.length - 1);
  return path.trim();
}

// ── Chart layout constants ────────────────────────────────────────────────────
const VW  = 800;
const VH  = 290;
const PAD = { top: 28, right: 90, bottom: 52, left: 52 };
const CW  = VW - PAD.left - PAD.right;
const CH  = VH - PAD.top  - PAD.bottom;

export default function SellerPerformanceChart({ rows }: { rows: SellerStats[] }) {
  const allSellers = rows;

  const [selected, setSelected] = useState<string[]>(() =>
    allSellers
      .filter(r => r.active !== false)
      .slice(0, Math.min(2, allSellers.length))
      .map(r => r.sellerId),
  );
  const [metric, setMetric] = useState<MetricKey>("made");

  const toggle = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter(x => x !== id) : prev;
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const selectedRows = allSellers.filter(r => selected.includes(r.sellerId));

  const allDays: string[] = useMemo(() => {
    const s = new Set<string>();
    for (const r of selectedRows) Object.keys(r.byDay).forEach(d => s.add(d));
    return Array.from(s).sort();
  }, [selectedRows]);

  const series = selectedRows.map((r, idx) => ({
    id:     r.sellerId,
    name:   r.sellerName,
    color:  PALETTE[idx % PALETTE.length],
    values: allDays.map(d => dayValue(r.byDay[d], metric)),
  }));

  const allNonNull = series.flatMap(s => s.values.filter((v): v is number => v !== null));
  const maxVal = Math.max(...allNonNull, metric === "answerPct" ? 20 : 5);
  const yMax   = metric === "answerPct" ? Math.min(100, Math.ceil(maxVal / 10) * 10) : Math.ceil(maxVal * 1.15);

  const isPct  = metric === "answerPct";
  const isSolo = allDays.length <= 1;

  const xOf = (i: number) =>
    PAD.left + (isSolo ? CW / 2 : (i / (allDays.length - 1)) * CW);
  const yOf = (v: number) =>
    PAD.top + CH - Math.max(0, Math.min(1, v / yMax)) * CH;

  const yBottom = PAD.top + CH;

  // Y-axis: 5 ticks
  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round(yMax * i / 5));

  // X-axis: max ~9 labels
  const xStep = allDays.length <= 9 ? 1 : Math.ceil(allDays.length / 9);

  if (allSellers.length === 0) return null;

  return (
    <div style={{ padding: "20px 20px 4px" }}>

      {/* ── Metric tabs ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {METRICS.map(m => {
          const active = metric === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              style={{
                fontFamily: OUTFIT,
                fontSize: 12, fontWeight: 700,
                padding: "6px 14px", borderRadius: 8,
                cursor: "pointer", transition: "all .12s",
                background: active ? "rgba(201,168,58,0.12)" : "transparent",
                color:      active ? "#C9A83A" : C.textMuted,
                border:     active ? "1.5px solid rgba(201,168,58,0.35)" : `1.5px solid ${C.border}`,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* ── Seller toggles ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <span style={{ fontFamily: OUTFIT, fontSize: 11, fontWeight: 700, color: C.textMuted, alignSelf: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Sellers:
        </span>
        {allSellers.map(r => {
          const isOn   = selected.includes(r.sellerId);
          const selIdx = selected.indexOf(r.sellerId);
          const color  = isOn ? PALETTE[selIdx % PALETTE.length] : undefined;
          return (
            <button
              key={r.sellerId}
              onClick={() => toggle(r.sellerId)}
              style={{
                fontFamily: OUTFIT,
                display: "flex", alignItems: "center", gap: 7,
                fontSize: 13, fontWeight: 700,
                padding: "7px 16px", borderRadius: 8,
                cursor: "pointer", transition: "all .15s",
                background: isOn ? `${color}14` : "transparent",
                color:      isOn ? color : C.textBody,
                border:     `2px solid ${isOn ? `${color}55` : C.border}`,
                opacity: r.active === false ? 0.5 : 1,
                boxShadow: isOn ? `0 0 0 3px ${color}18` : "none",
              }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: "50%",
                background: isOn ? color : C.textDim,
                display: "inline-block", flexShrink: 0,
                boxShadow: isOn ? `0 0 6px ${color}80` : "none",
                transition: "all .15s",
              }} />
              {r.sellerName}
            </button>
          );
        })}
        {selected.length >= 2 && (
          <span style={{ fontFamily: OUTFIT, fontSize: 11, color: C.textDim, alignSelf: "center" }}>
            (máx. 2)
          </span>
        )}
      </div>

      {/* ── SVG chart ────────────────────────────────────────────────────── */}
      {allDays.length === 0 ? (
        <div style={{ padding: "32px 0 24px", textAlign: "center" }}>
          <p style={{ fontFamily: OUTFIT, fontSize: 13, color: C.textMuted }}>
            Sin datos para el período seleccionado
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            style={{ width: "100%", minWidth: 420, height: "auto", display: "block" }}
          >
            {/* ── Axis lines ─────────────────────────────────────────────── */}
            {/* Y axis */}
            <line
              x1={PAD.left} y1={PAD.top}
              x2={PAD.left} y2={yBottom}
              style={{ stroke: C.border }} strokeWidth={1.5}
            />
            {/* X axis */}
            <line
              x1={PAD.left} y1={yBottom}
              x2={PAD.left + CW} y2={yBottom}
              style={{ stroke: C.border }} strokeWidth={1.5}
            />

            {/* ── Y-axis grid + labels ────────────────────────────────────── */}
            {yTicks.map(tick => (
              <g key={tick}>
                {tick > 0 && (
                  <line
                    x1={PAD.left} y1={yOf(tick)}
                    x2={PAD.left + CW} y2={yOf(tick)}
                    style={{ stroke: C.border }}
                    strokeDasharray="5 5"
                    strokeWidth={0.75}
                  />
                )}
                <text
                  x={PAD.left - 10} y={yOf(tick) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={500}
                  style={{ fill: C.textMuted }}
                  fontFamily="system-ui, sans-serif"
                >
                  {tick}{isPct ? "%" : ""}
                </text>
              </g>
            ))}

            {/* ── X-axis labels ───────────────────────────────────────────── */}
            {allDays.map((day, i) => {
              if (i % xStep !== 0 && i !== allDays.length - 1) return null;
              return (
                <text
                  key={day}
                  x={xOf(i)} y={yBottom + 20}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  style={{ fill: C.textMuted }}
                  fontFamily="system-ui, sans-serif"
                >
                  {fmtAxisDay(day)}
                </text>
              );
            })}

            {/* ── Area fills (behind lines) ───────────────────────────────── */}
            {series.map(s => {
              const areaPath = buildAreaPath(s.values, xOf, yOf, yBottom);
              if (!areaPath) return null;
              return (
                <path
                  key={`area-${s.id}`}
                  d={areaPath}
                  fill={s.color}
                  opacity={0.09}
                />
              );
            })}

            {/* ── Lines ──────────────────────────────────────────────────── */}
            {series.map(s => {
              const linePath = buildLinePath(s.values, xOf, yOf);
              if (!linePath) return null;
              return (
                <path
                  key={`line-${s.id}`}
                  d={linePath}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={0.9}
                />
              );
            })}

            {/* ── Dots ───────────────────────────────────────────────────── */}
            {series.map(s =>
              allDays.map((_, i) => {
                const v = s.values[i];
                if (v === null) return null;
                const cx = xOf(i);
                const cy = yOf(v);
                return (
                  <g key={`dot-${s.id}-${i}`}>
                    {/* Outer glow ring */}
                    <circle cx={cx} cy={cy} r={7} fill={s.color} opacity={0.15} />
                    {/* Dot */}
                    <circle
                      cx={cx} cy={cy} r={4.5}
                      fill={s.color}
                      style={{ stroke: C.bg }}
                      strokeWidth={2}
                    />
                  </g>
                );
              })
            )}

            {/* ── Value labels above dots ─────────────────────────────────── */}
            {allDays.length <= 16 && series.map(s =>
              allDays.map((_, i) => {
                const v = s.values[i];
                if (v === null || v === 0) return null;
                return (
                  <text
                    key={`lbl-${s.id}-${i}`}
                    x={xOf(i)} y={yOf(v) - 12}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={s.color}
                    fontFamily="system-ui, sans-serif"
                  >
                    {v}{isPct ? "%" : ""}
                  </text>
                );
              })
            )}

            {/* ── Seller name tag at last visible dot ─────────────────────── */}
            {series.map(s => {
              let lastIdx = -1;
              for (let i = s.values.length - 1; i >= 0; i--) {
                if (s.values[i] !== null) { lastIdx = i; break; }
              }
              if (lastIdx === -1) return null;
              const lastVal = s.values[lastIdx] as number;
              const cx = xOf(lastIdx);
              const cy = yOf(lastVal);
              const rightEdge = cx + 8;
              const anchor = rightEdge + 70 > VW ? "end" : "start";
              const lx = anchor === "end" ? cx - 10 : cx + 10;
              return (
                <text
                  key={`tag-${s.id}`}
                  x={lx} y={cy + 4}
                  textAnchor={anchor}
                  fontSize={12}
                  fontWeight={700}
                  fill={s.color}
                  fontFamily="system-ui, sans-serif"
                >
                  {s.name}
                </text>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
