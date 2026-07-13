"use client";

import { useState, useMemo, useId } from "react";
import { C } from "@/lib/design";

const PALETTE = ["#C9A83A", "#38BDF8"];

type DayCounts = {
  made: number; answered: number; interested: number;
  badTiming: number; voicemail: number; notInterested: number; wrongNumber: number;
};
type SellerStats = {
  sellerId: string; sellerName: string; active?: boolean;
  made: number; answered: number; interested: number;
  byDay: Record<string, DayCounts>;
};
type MetricKey = "made" | "answerPct" | "interested" | "badTiming" | "voicemail";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "made",      label: "Calls made"  },
  { key: "answerPct", label: "Answer %"    },
  { key: "interested",label: "Interested"  },
  { key: "badTiming", label: "Bad timing"  },
  { key: "voicemail", label: "Voicemail"   },
];

function dayValue(d: DayCounts | undefined, metric: MetricKey): number | null {
  if (d === undefined) return null;
  if (metric === "made")        return d.made;
  if (metric === "answerPct")   return d.made === 0 ? 0 : Math.round((d.answered / d.made) * 100);
  if (metric === "interested")  return d.interested;
  if (metric === "badTiming")   return d.badTiming;
  if (metric === "voicemail")   return d.voicemail;
  return 0;
}

function fmtAxisDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// CatmullRom → cubic Bezier smooth path, respects null gaps
function smoothPath(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
): string {
  type Pt = { x: number; y: number; i: number };
  const pts: Pt[] = values
    .map((v, i) => (v !== null ? { x: xOf(i), y: yOf(v), i } : null))
    .filter((p): p is Pt => p !== null);

  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;

  // split into contiguous segments (break on index gaps = null days)
  const segs: Pt[][] = [];
  let seg: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].i === pts[k - 1].i + 1) seg.push(pts[k]);
    else { segs.push(seg); seg = [pts[k]]; }
  }
  segs.push(seg);

  const T = 0.35;
  let d = "";
  for (const s of segs) {
    d += `M ${s[0].x.toFixed(1)} ${s[0].y.toFixed(1)}`;
    for (let j = 0; j < s.length - 1; j++) {
      const p0 = s[Math.max(0, j - 1)], p1 = s[j], p2 = s[j + 1], p3 = s[Math.min(s.length - 1, j + 2)];
      const cp1x = p1.x + (p2.x - p0.x) * T, cp1y = p1.y + (p2.y - p0.y) * T;
      const cp2x = p2.x - (p3.x - p1.x) * T, cp2y = p2.y - (p3.y - p1.y) * T;
      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
  }
  return d;
}

function smoothAreaPath(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
  yBottom: number,
): string {
  type Pt = { x: number; y: number; i: number };
  const pts: Pt[] = values
    .map((v, i) => (v !== null ? { x: xOf(i), y: yOf(v), i } : null))
    .filter((p): p is Pt => p !== null);
  if (pts.length < 2) return "";

  const segs: Pt[][] = [];
  let seg: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].i === pts[k - 1].i + 1) seg.push(pts[k]);
    else { segs.push(seg); seg = [pts[k]]; }
  }
  segs.push(seg);

  const T = 0.35;
  let d = "";
  for (const s of segs) {
    if (s.length < 2) continue;
    let curve = `M ${s[0].x.toFixed(1)} ${s[0].y.toFixed(1)}`;
    for (let j = 0; j < s.length - 1; j++) {
      const p0 = s[Math.max(0, j - 1)], p1 = s[j], p2 = s[j + 1], p3 = s[Math.min(s.length - 1, j + 2)];
      const cp1x = p1.x + (p2.x - p0.x) * T, cp1y = p1.y + (p2.y - p0.y) * T;
      const cp2x = p2.x - (p3.x - p1.x) * T, cp2y = p2.y - (p3.y - p1.y) * T;
      curve += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    curve += ` L ${s[s.length - 1].x.toFixed(1)},${yBottom} L ${s[0].x.toFixed(1)},${yBottom} Z`;
    d += curve;
  }
  return d;
}

// ── Layout constants ──────────────────────────────────────────────────────────
const VW  = 760;
const VH  = 230;
const PAD = { top: 32, right: 36, bottom: 44, left: 52 };
const CW  = VW - PAD.left - PAD.right;
const CH  = VH - PAD.top  - PAD.bottom;

export default function SellerPerformanceChart({ rows }: { rows: SellerStats[] }) {
  const uid = useId().replace(/:/g, "");

  const [selected, setSelected] = useState<string[]>(() =>
    rows.filter(r => r.active !== false).slice(0, 2).map(r => r.sellerId),
  );
  const [metric, setMetric] = useState<MetricKey>("made");

  const toggle = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter(x => x !== id) : prev;
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const selectedRows = rows.filter(r => selected.includes(r.sellerId));

  const allDays: string[] = useMemo(() => {
    const s = new Set<string>();
    for (const r of selectedRows) Object.keys(r.byDay).forEach(d => s.add(d));
    return Array.from(s).sort();
  }, [selectedRows]);

  const series = selectedRows.map((r, idx) => ({
    id: r.sellerId,
    name: r.sellerName,
    color: PALETTE[idx % PALETTE.length],
    seriesIdx: idx,
    values: allDays.map(d => dayValue(r.byDay[d], metric)),
  }));

  const allNonNull = series.flatMap(s => s.values.filter((v): v is number => v !== null));
  const maxVal = Math.max(...allNonNull, metric === "answerPct" ? 20 : 3);
  const yMax   = metric === "answerPct"
    ? Math.min(100, Math.ceil(maxVal / 10) * 10 + 10)
    : Math.ceil(maxVal * 1.25 + 1);

  const isPct    = metric === "answerPct";
  const solo     = allDays.length <= 1;
  const xOf      = (i: number) => PAD.left + (solo ? CW / 2 : (i / Math.max(allDays.length - 1, 1)) * CW);
  const yOf      = (v: number) => PAD.top + CH - Math.max(0, Math.min(1, v / yMax)) * CH;
  const yBottom  = PAD.top + CH;

  // 5 evenly spaced Y ticks (0, 25%, 50%, 75%, 100%)
  const yTicks = [0, 1, 2, 3, 4].map(i => Math.round(yMax * i / 4));

  // X-axis: label at most every N days so they don't crowd
  const xLabelStep = Math.max(1, Math.ceil(allDays.length / 10));

  if (rows.length === 0) return null;

  return (
    <div style={{ padding: "18px 20px 14px" }}>

      {/* ── Controls: metric pills + seller toggles ─────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {/* Metric pill group */}
        <div style={{
          display: "flex", gap: 2, padding: "3px",
          borderRadius: 10, border: `1px solid ${C.border}`,
          background: "rgba(0,0,0,0.03)",
        }}>
          {METRICS.map(m => {
            const active = metric === m.key;
            return (
              <button key={m.key} onClick={() => setMetric(m.key)} style={{
                fontSize: 11.5, fontWeight: 700,
                padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                transition: "all .15s",
                background: active ? "#C9A83A" : "transparent",
                color:      active ? "#000" : C.textMuted,
                border:     "none", lineHeight: 1,
              }}>
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />

        {/* Seller toggles — these ARE the legend */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rows.map(r => {
            const isOn   = selected.includes(r.sellerId);
            const selIdx = selected.indexOf(r.sellerId);
            const color  = isOn ? PALETTE[selIdx % PALETTE.length] : C.textMuted;
            return (
              <button key={r.sellerId} onClick={() => toggle(r.sellerId)} style={{
                fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 13px 5px 10px", borderRadius: 20, cursor: "pointer",
                transition: "all .15s",
                background: isOn ? `${color}14` : "transparent",
                color: isOn ? color : C.textMuted,
                border: `1.5px solid ${isOn ? `${color}50` : C.border}`,
                opacity: r.active === false ? 0.5 : 1,
              }}>
                {/* color swatch */}
                <span style={{
                  width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                  background: isOn ? color : C.textDim,
                  boxShadow: isOn ? `0 0 6px ${color}80` : "none",
                  transition: "all .15s",
                }} />
                {r.sellerName}
              </button>
            );
          })}
          {selected.length >= 2 && (
            <span style={{ fontSize: 10, color: C.textDim, alignSelf: "center" }}>máx. 2</span>
          )}
        </div>
      </div>

      {/* ── SVG Chart ──────────────────────────────────────────────────────── */}
      {allDays.length === 0 ? (
        <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 13, color: C.textMuted }}>Sin datos en el período</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", minWidth: 360, height: "auto", display: "block" }}>
            <defs>
              {series.map(s => (
                <linearGradient key={s.id} id={`grad-${uid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={s.color} stopOpacity={0.20} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0}    />
                </linearGradient>
              ))}
            </defs>

            {/* ── Y-axis grid lines + ticks ──────────────────────────────── */}
            {yTicks.map((tick, ti) => {
              const y = yOf(tick);
              const isBase = tick === 0;
              return (
                <g key={tick}>
                  {/* horizontal grid line */}
                  <line
                    x1={PAD.left} y1={y} x2={PAD.left + CW} y2={y}
                    style={{ stroke: C.border }}
                    strokeWidth={isBase ? 1.2 : 0.75}
                    strokeDasharray={isBase ? "0" : "5 4"}
                    opacity={isBase ? 1 : 0.7}
                  />
                  {/* left axis tick mark */}
                  <line
                    x1={PAD.left - 5} y1={y} x2={PAD.left} y2={y}
                    style={{ stroke: C.textMuted }}
                    strokeWidth={isBase ? 1.2 : 0.8}
                  />
                  {/* Y-axis label */}
                  <text
                    x={PAD.left - 10} y={y + 4}
                    textAnchor="end" fontSize={11} fontWeight={ti === 0 ? 500 : 600}
                    style={{ fill: C.textMuted }}
                  >
                    {tick}{isPct ? "%" : ""}
                  </text>
                </g>
              );
            })}

            {/* ── Left Y-axis line ──────────────────────────────────────── */}
            <line
              x1={PAD.left} y1={PAD.top - 6} x2={PAD.left} y2={yBottom}
              style={{ stroke: C.border }} strokeWidth={1.2}
            />

            {/* ── X-axis labels + ticks ─────────────────────────────────── */}
            {allDays.map((day, i) => {
              if (i % xLabelStep !== 0 && i !== allDays.length - 1) return null;
              const x = xOf(i);
              return (
                <g key={day}>
                  <line
                    x1={x} y1={yBottom} x2={x} y2={yBottom + 5}
                    style={{ stroke: C.textMuted }} strokeWidth={0.8}
                  />
                  <text
                    x={x} y={VH - 6}
                    textAnchor="middle" fontSize={11} fontWeight={500}
                    style={{ fill: C.textMuted }}
                  >
                    {fmtAxisDay(day)}
                  </text>
                </g>
              );
            })}

            {/* ── Area fills ─────────────────────────────────────────────── */}
            {series.map(s => {
              const aPath = smoothAreaPath(s.values, xOf, yOf, yBottom);
              return aPath ? <path key={`area-${s.id}`} d={aPath} fill={`url(#grad-${uid}-${s.id})`} /> : null;
            })}

            {/* ── Lines ──────────────────────────────────────────────────── */}
            {series.map(s => {
              const lPath = smoothPath(s.values, xOf, yOf);
              return lPath ? (
                <path
                  key={`line-${s.id}`} d={lPath} fill="none"
                  stroke={s.color} strokeWidth={2.2}
                  strokeLinejoin="round" strokeLinecap="round"
                />
              ) : null;
            })}

            {/* ── Dots + value labels on every point ─────────────────────── */}
            {series.map(s => {
              // series 0 → labels above (dy = -13); series 1 → labels below (dy = +15)
              const labelDy = s.seriesIdx === 0 ? -13 : 15;
              return s.values.map((v, i) => {
                if (v === null) return null;
                const cx = xOf(i), cy = yOf(v);
                return (
                  <g key={`pt-${s.id}-${i}`}>
                    {/* outer glow ring */}
                    <circle cx={cx} cy={cy} r={7} fill={s.color} opacity={0.08} />
                    {/* dot */}
                    <circle
                      cx={cx} cy={cy} r={4}
                      fill={s.color}
                      style={{ stroke: C.bg }}
                      strokeWidth={2}
                    />
                    {/* value label */}
                    <text
                      x={cx} y={cy + labelDy}
                      textAnchor="middle"
                      fontSize={10.5} fontWeight={700}
                      fill={s.color}
                    >
                      {v}{isPct ? "%" : ""}
                    </text>
                  </g>
                );
              });
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
