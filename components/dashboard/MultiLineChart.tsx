"use client";

// Interactive multi-line trend chart. Pure SVG (no chart lib) with:
//   ─ Soft fills under each series + crisp top line
//   ─ Final-point halo dot + peak ring per series
//   ─ Hover crosshair that snaps to the closest day
//
// Period control lives at the dashboard level — this chart used to own a
// 7d/14d/30d chip set but boss feedback (2026-05-27) made the call: charts
// must adapt to the parent filter only. So the chart now renders whatever
// length of data it receives; the parent picks the window.

import { useState, useRef } from "react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Series = { name: string; color: string; data: number[] };

export default function MultiLineChart({
  series,
  height = 240,
  todayLabel = "Today",
  recentLabel = "d",
}: {
  series: Series[];
  height?: number;
  todayLabel?: string;
  recentLabel?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Render whatever the parent passes — no slicing, no in-chart window
  // selector. Period is decided upstream by FiltersBar.
  const sliced = series;

  const width = 720;
  const padding = { t: 18, r: 18, b: 32, l: 40 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const n = sliced[0]?.data.length ?? 0;
  const max = Math.max(1, ...sliced.flatMap(s => s.data));
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const yFor = (v: number) => padding.t + innerH - (v / max) * innerH;
  const xFor = (i: number) => padding.l + i * stepX;

  // 4 y-axis gridlines — integer ticks for small values, percent stops otherwise.
  const yTicks = (() => {
    if (max <= 4) {
      return Array.from({ length: max + 1 }, (_, i) => ({ v: i, y: yFor(i) }));
    }
    return [0, 0.25, 0.5, 0.75, 1].map(p => ({ v: Math.round(max * p), y: yFor(max * p) }));
  })();

  // Peak per series — used to draw the outlined ring + count label.
  const peaks = sliced.map(s => {
    const peakIdx = s.data.reduce((best, v, i) => v > s.data[best] ? i : best, 0);
    return { idx: peakIdx, value: s.data[peakIdx] };
  });

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // SVG viewBox is `0 0 ${width} ${height}`. Convert client X to viewBox X.
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < padding.l - 4 || px > width - padding.r + 4) {
      setHoverIdx(null);
      return;
    }
    const idx = Math.max(0, Math.min(n - 1, Math.round((px - padding.l) / Math.max(stepX, 0.0001))));
    setHoverIdx(idx);
  }

  return (
    <div className="w-full">
      <div className="relative w-full overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full select-none"
          style={{ minWidth: 540, maxWidth: "100%" }}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverIdx(null)}
        >
          {/* Gridlines */}
          {yTicks.map((tk, i) => (
            <g key={i}>
              <line
                x1={padding.l} x2={width - padding.r}
                y1={tk.y} y2={tk.y}
                stroke={C.border}
                strokeDasharray={i === 0 ? "0" : "3,4"}
                opacity={i === 0 ? 1 : 0.5}
              />
              <text
                x={padding.l - 8} y={tk.y + 3}
                textAnchor="end"
                fontSize={10}
                fill={C.textDim}
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {tk.v}
              </text>
            </g>
          ))}

          {/* X-axis ticks — about 5 across the visible window */}
          {(() => {
            const step = Math.max(1, Math.floor(n / 5));
            const ticks: number[] = [];
            for (let i = 0; i < n; i += step) ticks.push(i);
            if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);
            return ticks.map(i => (
              <text
                key={i}
                x={xFor(i)} y={height - 10}
                textAnchor="middle"
                fontSize={10}
                fill={C.textDim}
              >
                {i === n - 1 ? todayLabel : `${n - 1 - i}${recentLabel}`}
              </text>
            ));
          })()}

          {/* Series fills + lines */}
          {sliced.map((s, sIdx) => {
            const path = s.data.map((v, i) => (i === 0 ? "M" : "L") + xFor(i) + "," + yFor(v)).join(" ");
            const fillPath = `${path} L${xFor(s.data.length - 1)},${padding.t + innerH} L${padding.l},${padding.t + innerH} Z`;
            const gradId = `mlc-${sIdx}-${s.name.replace(/[^a-z0-9]/gi, "")}`;
            return (
              <g key={`fill-${sIdx}`}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={sIdx === 0 ? 0.22 : 0.1} />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={fillPath} fill={`url(#${gradId})`} />
                <path
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={sIdx === 0 ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {/* Peak markers + final-point dots */}
          {sliced.map((s, sIdx) => {
            const peak = peaks[sIdx];
            const lastIdx = s.data.length - 1;
            const lastValue = s.data[lastIdx];
            return (
              <g key={`deco-${sIdx}`}>
                <circle cx={xFor(lastIdx)} cy={yFor(lastValue)} r={9} fill={s.color} opacity={0.12} />
                <circle cx={xFor(lastIdx)} cy={yFor(lastValue)} r={4.2} fill={s.color} stroke="var(--c-card)" strokeWidth={1.8} />
                {peak.value > 0 && peak.idx !== lastIdx && (
                  <g>
                    <circle cx={xFor(peak.idx)} cy={yFor(peak.value)} r={6} fill="var(--c-card)" stroke={s.color} strokeWidth={1.8} />
                    <text x={xFor(peak.idx)} y={yFor(peak.value) - 11} textAnchor="middle" fontSize={10} fontWeight={700} fill={s.color} style={{ fontFeatureSettings: '"tnum"' }}>
                      {peak.value}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Hover crosshair + per-series snap dots */}
          {hoverIdx !== null && (
            <g pointerEvents="none">
              <line
                x1={xFor(hoverIdx)} x2={xFor(hoverIdx)}
                y1={padding.t} y2={padding.t + innerH}
                stroke={gold}
                strokeDasharray="3,3"
                opacity={0.7}
              />
              {sliced.map((s, sIdx) => (
                <circle
                  key={`hover-${sIdx}`}
                  cx={xFor(hoverIdx)} cy={yFor(s.data[hoverIdx] ?? 0)}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--c-card)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>
      </div>

      {/* Legend — flips between aggregate totals and per-series hover values */}
      <div className="flex items-center gap-4 mt-2 text-xs flex-wrap" style={{ color: C.textMuted }}>
        {sliced.map((s, sIdx) => {
          const total = s.data.reduce((a, b) => a + b, 0);
          const hovered = hoverIdx !== null ? s.data[hoverIdx] ?? 0 : null;
          return (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="font-medium">{s.name}</span>
              {hovered !== null ? (
                <span className="tabular-nums font-semibold" style={{ color: s.color }}>
                  {hovered}
                </span>
              ) : (
                <span className="tabular-nums" style={{ color: C.textDim }}>
                  {total} total
                </span>
              )}
              {/* Suppress unused-warning for sIdx in some bundlers */}
              <span hidden>{sIdx}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
