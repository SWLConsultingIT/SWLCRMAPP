"use client";

// Seller performance chart — compact dot+bezier-line chart.
// Design principles (Vercel/shadcn style):
//   • CatmullRom smooth curves — no jagged polylines
//   • Gradient fill fades to transparent (0.18 → 0)
//   • Dots only on data points, hidden when there's no data
//   • Horizontal-only grid, no axis lines
//   • All colors via CSS vars (theme-aware in both light + dark mode)
//   • Labels only at first + last point to avoid clutter

import { useState, useMemo, useId } from "react";
import { C } from "@/lib/design";

const OUTFIT = "var(--font-outfit), system-ui, sans-serif";
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
  { key: "made",        label: "Calls made"  },
  { key: "answerPct",   label: "Answer %"    },
  { key: "interested",  label: "Interested"  },
  { key: "badTiming",   label: "Bad timing"  },
  { key: "voicemail",   label: "Voicemail"   },
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

// CatmullRom → Bezier smooth path (handles null gaps with M jumps)
function smoothPath(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
  tension = 0.35,
): string {
  type Pt = { x: number; y: number; i: number };
  const pts: Pt[] = values
    .map((v, i) => (v !== null ? { x: xOf(i), y: yOf(v), i } : null))
    .filter((p): p is Pt => p !== null);

  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;

  // Split into contiguous segments (break on index gaps = null data)
  const segs: Pt[][] = [];
  let seg: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].i === pts[k - 1].i + 1) {
      seg.push(pts[k]);
    } else {
      segs.push(seg);
      seg = [pts[k]];
    }
  }
  segs.push(seg);

  let d = "";
  for (const s of segs) {
    d += `M ${s[0].x.toFixed(1)} ${s[0].y.toFixed(1)}`;
    for (let j = 0; j < s.length - 1; j++) {
      const p0 = s[Math.max(0, j - 1)];
      const p1 = s[j];
      const p2 = s[j + 1];
      const p3 = s[Math.min(s.length - 1, j + 2)];
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
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

  let d = "";
  const T = 0.35;
  for (const s of segs) {
    if (s.length < 2) continue;
    let curve = `M ${s[0].x.toFixed(1)} ${s[0].y.toFixed(1)}`;
    for (let j = 0; j < s.length - 1; j++) {
      const p0 = s[Math.max(0, j - 1)], p1 = s[j], p2 = s[j + 1], p3 = s[Math.min(s.length - 1, j + 2)];
      const cp1x = p1.x + (p2.x - p0.x) * T, cp1y = p1.y + (p2.y - p0.y) * T;
      const cp2x = p2.x - (p3.x - p1.x) * T, cp2y = p2.y - (p3.y - p1.y) * T;
      curve += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    curve += ` L ${s[s.length - 1].x.toFixed(1)},${yBottom.toFixed(1)} L ${s[0].x.toFixed(1)},${yBottom.toFixed(1)} Z`;
    d += curve;
  }
  return d;
}

// ── Layout ────────────────────────────────────────────────────────────────────
const VW  = 760;
const VH  = 210;
const PAD = { top: 24, right: 84, bottom: 40, left: 44 };
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
    id: r.sellerId, name: r.sellerName,
    color: PALETTE[idx % PALETTE.length],
    values: allDays.map(d => dayValue(r.byDay[d], metric)),
  }));

  const allNonNull = series.flatMap(s => s.values.filter((v): v is number => v !== null));
  const maxVal = Math.max(...allNonNull, metric === "answerPct" ? 20 : 3);
  const yMax   = metric === "answerPct"
    ? Math.min(100, Math.ceil(maxVal / 10) * 10 + 10)
    : Math.ceil(maxVal * 1.2 + 1);

  const isPct = metric === "answerPct";
  const solo  = allDays.length <= 1;

  const xOf = (i: number) =>
    PAD.left + (solo ? CW / 2 : (i / Math.max(allDays.length - 1, 1)) * CW);
  const yOf = (v: number) =>
    PAD.top + CH - Math.max(0, Math.min(1, v / yMax)) * CH;
  const yBottom = PAD.top + CH;

  // 4 Y-axis ticks
  const yTicks = [0, 1, 2, 3].map(i => Math.round(yMax * i / 3));

  // X-axis labels: at most 8 visible
  const xStep = allDays.length <= 8 ? 1 : Math.ceil(allDays.length / 8);

  if (rows.length === 0) return null;

  return (
    <div style={{ padding: "18px 20px 12px" }}>

      {/* ── Controls row: metric tabs + seller toggles ─────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
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
                fontFamily: OUTFIT, fontSize: 11.5, fontWeight: 700,
                padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                transition: "all .15s",
                background: active ? "#C9A83A" : "transparent",
                color:      active ? "#000" : C.textMuted,
                border:     "none",
                lineHeight: 1,
              }}>
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />

        {/* Seller toggles */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rows.map(r => {
            const isOn   = selected.includes(r.sellerId);
            const selIdx = selected.indexOf(r.sellerId);
            const color  = PALETTE[selIdx % PALETTE.length];
            return (
              <button key={r.sellerId} onClick={() => toggle(r.sellerId)} style={{
                fontFamily: OUTFIT, fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 13px", borderRadius: 7, cursor: "pointer",
                transition: "all .15s",
                background: isOn ? `${color}14` : "transparent",
                color:      isOn ? color : C.textMuted,
                border:     `1.5px solid ${isOn ? `${color}50` : C.border}`,
                opacity: r.active === false ? 0.5 : 1,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: isOn ? color : C.textDim,
                  boxShadow: isOn ? `0 0 5px ${color}70` : "none",
                  transition: "all .15s",
                }} />
                {r.sellerName}
              </button>
            );
          })}
          {selected.length >= 2 && (
            <span style={{ fontFamily: OUTFIT, fontSize: 10, color: C.textDim, alignSelf: "center" }}>
              máx. 2
            </span>
          )}
        </div>
      </div>

      {/* ── Chart ──────────────────────────────────────────────────────────── */}
      {allDays.length === 0 ? (
        <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontFamily: OUTFIT, fontSize: 13, color: C.textMuted }}>Sin datos en el período</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", minWidth: 380, height: "auto", display: "block" }}>
            <defs>
              {series.map(s => (
                <linearGradient key={s.id} id={`grad-${uid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={s.color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            {/* Y-axis grid lines + labels (horizontal only, no axis line) */}
            {yTicks.map(tick => (
              <g key={tick}>
                <line
                  x1={PAD.left} y1={yOf(tick)}
                  x2={PAD.left + CW} y2={yOf(tick)}
                  style={{ stroke: C.border }}
                  strokeWidth={0.8}
                  strokeDasharray={tick === 0 ? "0" : "4 4"}
                />
                <text
                  x={PAD.left - 9} y={yOf(tick) + 4}
                  textAnchor="end" fontSize={10.5} fontWeight={500}
                  style={{ fill: C.textMuted }}
                  fontFamily="system-ui, sans-serif"
                >
                  {tick}{isPct ? "%" : ""}
                </text>
              </g>
            ))}

            {/* X-axis labels */}
            {allDays.map((day, i) => {
              if (i % xStep !== 0 && i !== allDays.length - 1) return null;
              return (
                <text
                  key={day}
                  x={xOf(i)} y={VH - 6}
                  textAnchor="middle" fontSize={10.5} fontWeight={500}
                  style={{ fill: C.textMuted }}
                  fontFamily="system-ui, sans-serif"
                >
                  {fmtAxisDay(day)}
                </text>
              );
            })}

            {/* Area fills */}
            {series.map(s => {
              const aPath = smoothAreaPath(s.values, xOf, yOf, yBottom);
              if (!aPath) return null;
              return (
                <path key={`area-${s.id}`} d={aPath} fill={`url(#grad-${uid}-${s.id})`} />
              );
            })}

            {/* Lines */}
            {series.map(s => {
              const lPath = smoothPath(s.values, xOf, yOf);
              if (!lPath) return null;
              return (
                <path
                  key={`line-${s.id}`} d={lPath}
                  fill="none" stroke={s.color}
                  strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                />
              );
            })}

            {/* Dots — small on all points, prominent only on first/last */}
            {series.map(s => {
              const validIndices = s.values
                .map((v, i) => (v !== null ? i : -1))
                .filter(i => i !== -1);
              const firstIdx = validIndices[0] ?? -1;
              const lastIdx  = validIndices[validIndices.length - 1] ?? -1;

              return s.values.map((v, i) => {
                if (v === null) return null;
                const cx = xOf(i), cy = yOf(v);
                const isKey = i === firstIdx || i === lastIdx;
                return (
                  <g key={`dot-${s.id}-${i}`}>
                    {isKey && <circle cx={cx} cy={cy} r={8} fill={s.color} opacity={0.1} />}
                    <circle
                      cx={cx} cy={cy}
                      r={isKey ? 4.5 : 3}
                      fill={s.color}
                      style={{ stroke: C.bg }}
                      strokeWidth={isKey ? 2 : 1.5}
                    />
                  </g>
                );
              });
            })}

            {/* Value labels — only on first + last visible points */}
            {series.map(s => {
              const validIndices = s.values
                .map((v, i) => (v !== null ? i : -1))
                .filter(i => i !== -1);
              const firstIdx = validIndices[0] ?? -1;
              const lastIdx  = validIndices[validIndices.length - 1] ?? -1;

              return [firstIdx, lastIdx].filter(i => i !== -1).map(i => {
                const v = s.values[i];
                if (v === null) return null;
                const cx = xOf(i), cy = yOf(v);
                const labelY = cy - 10;
                return (
                  <text
                    key={`lbl-${s.id}-${i}`}
                    x={cx} y={labelY}
                    textAnchor="middle" fontSize={11} fontWeight={700}
                    fill={s.color}
                    fontFamily="system-ui, sans-serif"
                  >
                    {v}{isPct ? "%" : ""}
                  </text>
                );
              });
            })}

            {/* Seller name at last dot */}
            {series.map(s => {
              let lastIdx = -1;
              for (let i = s.values.length - 1; i >= 0; i--) {
                if (s.values[i] !== null) { lastIdx = i; break; }
              }
              if (lastIdx === -1) return null;
              const lastVal = s.values[lastIdx] as number;
              const cx = xOf(lastIdx);
              const cy = yOf(lastVal);
              const isRight = cx + 12 + s.name.length * 7 > VW;
              return (
                <text
                  key={`tag-${s.id}`}
                  x={isRight ? cx - 12 : cx + 12}
                  y={cy + 4}
                  textAnchor={isRight ? "end" : "start"}
                  fontSize={11.5} fontWeight={700}
                  fill={s.color}
                  fontFamily="system-ui, sans-serif"
                  opacity={0.9}
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
