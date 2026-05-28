"use client";

// Premium multi-line trend chart. Pure SVG, no chart lib.
//
// Round 5 boss feedback:
//   - Brush-zoom: drag horizontally on the chart to zoom into a range.
//     Click "Reset" pill (top-right) to clear. No mode toggle, no chips.
//   - Ghost line: optional `priorSeries` renders dashed, ~35% opacity
//     under the live series — same metric from the previous period for
//     instant period-over-period comparison.
//   - Legend toggle: click any legend chip to hide/show that series.
//   - Polish: smoother Catmull-Rom curves, refined grid, axis tick marks,
//     hover dot halo, glass-tooltip pinned top-left so it doesn't fight
//     the reset pill on the right.

import { useRef, useState } from "react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Series = { name: string; color: string; data: number[] };

export default function MultiLineChart({
  series,
  priorSeries,
  height = 110,
  todayLabel = "Today",
  recentLabel = "d",
  priorLabel = "Prior period",
  resetLabel = "Reset zoom",
  totalLabel = "total",
  locale = "en",
}: {
  series: Series[];
  /** Optional same-shape series for the previous period — renders as
   * dashed ghost lines under the live ones. */
  priorSeries?: Series[];
  height?: number;
  todayLabel?: string;
  recentLabel?: string;
  priorLabel?: string;
  resetLabel?: string;
  totalLabel?: string;
  /** Locale for the date axis formatter. Defaults to "en". */
  locale?: "en" | "es";
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ startPx: number; endPx: number } | null>(null);
  const [zoom, setZoom] = useState<{ a: number; b: number } | null>(null);

  // Date axis formatter — translates index → real calendar date. The chart
  // is trailing-N-days where index n-1 is "today" and index 0 is "today - (n-1)
  // days". Showing "12 May" instead of "29d ago" reads much faster for the
  // operator who's used to thinking in dates (boss feedback 2026-05-27).
  const dateLocStr = locale === "es" ? "es-AR" : "en-US";
  const dateAtIdx = (idx: number, totalN: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (totalN - 1 - idx));
    return d;
  };
  const fmtDate = (d: Date) => d.toLocaleDateString(dateLocStr, { day: "2-digit", month: "short" });

  const fullN = series[0]?.data.length ?? 0;
  const a = zoom ? Math.max(0, Math.min(zoom.a, fullN - 1)) : 0;
  const b = zoom ? Math.max(a + 1, Math.min(zoom.b + 1, fullN)) : fullN;
  const sliceRange = <T,>(arr: T[]) => arr.slice(a, b);
  const visible = series.map(s => ({ ...s, data: sliceRange(s.data) }));
  const priorVisible = (priorSeries ?? []).map(s => ({ ...s, data: sliceRange(s.data) }));

  const isShown = (name: string) => !hidden.has(name);

  const width = 760;
  // Tight padding for the compact (110px) chart variant. Y labels are
  // suppressed to just the max value floating top-left (see below) so
  // we don't need the wide left gutter anymore.
  const padding = { t: 14, r: 18, b: 28, l: 14 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const n = visible[0]?.data.length ?? 0;
  const valuesForMax = visible.filter(s => isShown(s.name)).flatMap(s => s.data);
  const priorMax = priorVisible.filter(s => isShown(s.name)).flatMap(s => s.data);
  const max = Math.max(1, ...valuesForMax, ...priorMax);
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const yFor = (v: number) => padding.t + innerH - (v / max) * innerH;
  const xFor = (i: number) => padding.l + i * stepX;
  const dataAtPx = (px: number): number =>
    Math.max(0, Math.min(n - 1, Math.round((px - padding.l) / Math.max(stepX, 0.0001))));
  const clientToViewport = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return padding.l;
    const rect = svg.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * width;
  };

  // 4–5 y-axis gridlines — integer ticks for small ranges, 25/50/75/100
  // stops otherwise. Both end up at clean tabular numbers.
  const yTicks = (() => {
    if (max <= 4) {
      return Array.from({ length: max + 1 }, (_, i) => ({ v: i, y: yFor(i) }));
    }
    return [0, 0.25, 0.5, 0.75, 1].map(p => ({ v: Math.round(max * p), y: yFor(max * p) }));
  })();

  /** Catmull-Rom → cubic-bezier path. Produces smooth lines without the
   * "spikes" you get from naive linear paths. tension=0.5 is the
   * classic chart curve. */
  function smoothPath(points: { x: number; y: number }[]): string {
    if (points.length < 2) return "";
    const t = 0.5;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) * t / 3;
      const c1y = p1.y + (p2.y - p0.y) * t / 3;
      const c2x = p2.x - (p3.x - p1.x) * t / 3;
      const c2y = p2.y - (p3.y - p1.y) * t / 3;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const px = clientToViewport(e.clientX);
    if (px < padding.l - 4 || px > width - padding.r + 4) return;
    setDrag({ startPx: px, endPx: px });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const px = clientToViewport(e.clientX);
    if (drag) {
      setDrag({ ...drag, endPx: px });
      // While dragging, suppress the per-day hover so the brush feels
      // like the dominant interaction.
      setHoverIdx(null);
      return;
    }
    if (px < padding.l - 4 || px > width - padding.r + 4) {
      setHoverIdx(null);
      return;
    }
    setHoverIdx(dataAtPx(px));
  }
  function onPointerUp() {
    if (!drag) return;
    const minPx = Math.min(drag.startPx, drag.endPx);
    const maxPx = Math.max(drag.startPx, drag.endPx);
    setDrag(null);
    // Treat <8px drag as a click — don't zoom.
    if (maxPx - minPx < 8) return;
    const ai = dataAtPx(minPx);
    const bi = dataAtPx(maxPx);
    if (bi - ai < 1) return;
    // Translate the visible-window indices back to the full data range.
    setZoom({ a: a + ai, b: a + bi });
    setHoverIdx(null);
  }

  // Brush rectangle (during drag)
  const brushRect = drag && Math.abs(drag.endPx - drag.startPx) >= 4 ? {
    x: Math.max(padding.l, Math.min(drag.startPx, drag.endPx)),
    width: Math.min(
      width - padding.r - Math.max(padding.l, Math.min(drag.startPx, drag.endPx)),
      Math.abs(drag.endPx - drag.startPx),
    ),
  } : null;

  return (
    <div className="w-full select-none">
      <div className="relative w-full overflow-x-auto">
        {/* Hover tooltip — pinned top-left so it doesn't collide with the
            Reset zoom pill on the right. */}
        {hoverIdx !== null && visible[0] && (
          <div
            className="absolute top-2 left-2 z-10 rounded-lg border px-3 py-2 text-[11px] tabular-nums pointer-events-none"
            style={{
              backgroundColor: "color-mix(in srgb, var(--c-card) 96%, transparent)",
              borderColor: C.border,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              boxShadow: "0 6px 20px rgba(0,0,0,0.1)",
              minWidth: 180,
            }}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-0.5 inline-flex items-center gap-1.5" style={{ color: C.textDim }}>
              {hoverIdx === n - 1 ? todayLabel : fmtDate(dateAtIdx(hoverIdx, n))}
              <span className="text-[9px] font-medium opacity-70">
                · {dateAtIdx(hoverIdx, n).toLocaleDateString(dateLocStr, { weekday: "short" })}
              </span>
            </p>
            <p className="text-[9px] mb-1.5" style={{ color: C.textDim }}>
              {hoverIdx === n - 1 ? "" : `${n - 1 - hoverIdx}${recentLabel} ago`}
            </p>
            <ul className="space-y-1">
              {visible.map((s) => {
                const v = s.data[hoverIdx] ?? 0;
                const pv = priorVisible.find(p => p.name === s.name)?.data[hoverIdx];
                // % delta vs prior period for this exact day-of-period.
                const deltaPct = pv != null && pv > 0 ? Math.round(((v - pv) / pv) * 100) : null;
                return (
                  <li key={s.name} className="flex items-center gap-2" style={{ opacity: isShown(s.name) ? 1 : 0.4 }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 truncate" style={{ color: C.textBody }}>{s.name}</span>
                    <span className="font-bold tabular-nums" style={{ color: s.color }}>{v}</span>
                    {deltaPct !== null && (
                      <span className="text-[9px] tabular-nums font-semibold"
                        style={{ color: deltaPct > 0 ? "#059669" : deltaPct < 0 ? "#DC2626" : C.textDim }}>
                        {deltaPct > 0 ? "+" : ""}{deltaPct}%
                      </span>
                    )}
                    {pv !== undefined && (
                      <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>· {pv}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {/* Footer — day's reply rate if both Sent and Replies are
                shown. Quick "this day's batch performance" without doing
                mental math (boss feedback 2026-05-28: hover needs more data). */}
            {(() => {
              const sentS = visible.find(s => s.data && /sent|envia/i.test(s.name));
              const replS = visible.find(s => s.data && /repl|resp/i.test(s.name));
              if (!sentS || !replS) return null;
              const sentV = sentS.data[hoverIdx] ?? 0;
              const replV = replS.data[hoverIdx] ?? 0;
              if (sentV === 0) return null;
              const pct = Math.round((replV / sentV) * 100);
              return (
                <div className="mt-2 pt-1.5 border-t flex items-center justify-between"
                  style={{ borderColor: C.border }}>
                  <span className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>Day reply rate</span>
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: pct >= 10 ? "#059669" : C.textBody }}>
                    {pct}%
                  </span>
                </div>
              );
            })()}
          </div>
        )}
        {/* Reset zoom pill — top right, only when zoomed */}
        {zoom && (
          <button
            type="button"
            onClick={() => { setZoom(null); setHoverIdx(null); }}
            className="absolute top-2 right-2 z-10 rounded-md border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] transition-colors hover:opacity-90"
            style={{
              color: gold,
              backgroundColor: `color-mix(in srgb, ${gold} 16%, transparent)`,
              borderColor: `color-mix(in srgb, ${gold} 40%, transparent)`,
            }}
          >
            ↺ {resetLabel}
          </button>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ minWidth: 540, maxWidth: "100%", cursor: drag ? "ew-resize" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { setHoverIdx(null); if (drag) setDrag(null); }}
        >
          {/* Minimal axes pass — boss 2026-05-28 wanted the chart to feel
              like a "sparkline grande". Drop internal gridlines + Y tick
              labels + interior X labels. Keep only:
              - baseline at Y=0 (so the eye anchors)
              - max-Y value as a small floating chip top-left
              - start date + "Today" as edge X labels */}
          <line x1={padding.l} x2={width - padding.r} y1={padding.t + innerH} y2={padding.t + innerH} stroke={C.border} strokeWidth={1} />
          {max > 0 && (
            <text x={padding.l} y={padding.t + 9} textAnchor="start" fontSize={11} fontWeight={700} fill={C.textDim}
              style={{ fontFeatureSettings: '"tnum"' }}>
              max {max}
            </text>
          )}
          {/* X axis — only the first day + "Today" */}
          {n > 1 && (
            <>
              <text x={xFor(0)} y={height - 8} textAnchor="start" fontSize={11.5} fontWeight={700} fill={C.textBody}
                style={{ fontFeatureSettings: '"tnum"' }}>
                {fmtDate(dateAtIdx(0, n))}
              </text>
              <text x={xFor(n - 1)} y={height - 8} textAnchor="end" fontSize={11.5} fontWeight={700} fill={C.textBody}
                style={{ fontFeatureSettings: '"tnum"' }}>
                {todayLabel}
              </text>
            </>
          )}

          {/* Ghost / prior-period series — dashed under the live ones */}
          {priorVisible.map((s) => {
            if (!isShown(s.name)) return null;
            const points = s.data.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
            return (
              <path
                key={`prior-${s.name}`}
                d={smoothPath(points)}
                fill="none"
                stroke={s.color}
                strokeWidth={1.4}
                strokeDasharray="4,4"
                opacity={0.42}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Live series — soft fill + smooth line */}
          {visible.map((s, sIdx) => {
            if (!isShown(s.name)) return null;
            const points = s.data.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
            const linePath = smoothPath(points);
            const fillPath = `${linePath} L${xFor(s.data.length - 1)},${padding.t + innerH} L${padding.l},${padding.t + innerH} Z`;
            const gradId = `mlc-${sIdx}-${s.name.replace(/[^a-z0-9]/gi, "")}`;
            return (
              <g key={`live-${s.name}`}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={sIdx === 0 ? 0.24 : 0.13} />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={fillPath} fill={`url(#${gradId})`} />
                <path d={linePath} fill="none" stroke={s.color} strokeWidth={sIdx === 0 ? 3 : 2.5}
                  strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}

          {/* Final-point dot per visible series — gold halo, brand bead */}
          {visible.map((s) => {
            if (!isShown(s.name)) return null;
            const lastIdx = s.data.length - 1;
            const lastValue = s.data[lastIdx] ?? 0;
            return (
              <g key={`last-${s.name}`}>
                <circle cx={xFor(lastIdx)} cy={yFor(lastValue)} r={10} fill={s.color} opacity={0.14} />
                <circle cx={xFor(lastIdx)} cy={yFor(lastValue)} r={4.4} fill={s.color} stroke="var(--c-card)" strokeWidth={2} />
              </g>
            );
          })}

          {/* Brush selection rectangle (during drag) */}
          {brushRect && (
            <rect
              x={brushRect.x}
              y={padding.t}
              width={brushRect.width}
              height={innerH}
              fill={gold}
              fillOpacity={0.12}
              stroke={gold}
              strokeOpacity={0.4}
              strokeDasharray="4,3"
              pointerEvents="none"
            />
          )}

          {/* Hover crosshair + snap dots */}
          {hoverIdx !== null && !drag && (
            <g pointerEvents="none">
              <line
                x1={xFor(hoverIdx)} x2={xFor(hoverIdx)}
                y1={padding.t} y2={padding.t + innerH}
                stroke={gold} strokeDasharray="3,3" opacity={0.65}
              />
              {visible.map((s) => {
                if (!isShown(s.name)) return null;
                return (
                  <g key={`hover-${s.name}`}>
                    <circle cx={xFor(hoverIdx)} cy={yFor(s.data[hoverIdx] ?? 0)} r={8} fill={s.color} opacity={0.15} />
                    <circle cx={xFor(hoverIdx)} cy={yFor(s.data[hoverIdx] ?? 0)} r={4.5} fill={s.color} stroke="var(--c-card)" strokeWidth={2} />
                  </g>
                );
              })}
            </g>
          )}
        </svg>
        {/* Subtle instruction line under the chart on first paint — fades
            once the user has interacted (zoom set or hidden series). */}
        {!zoom && hidden.size === 0 && fullN > 7 && (
          <p className="absolute bottom-1 right-3 text-[9.5px] font-medium" style={{ color: C.textDim }}>
            ↔ {todayLabel === "Today" ? "drag to zoom" : "arrastrá para zoom"}
          </p>
        )}
      </div>

      {/* Legend — click chip to hide/show that series. Hover state mirrors
          chart hover so the legend and chart feel like one surface. */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {visible.map((s) => {
          const total = s.data.reduce((acc, v) => acc + v, 0);
          const hovered = hoverIdx !== null ? s.data[hoverIdx] ?? 0 : null;
          const shown = isShown(s.name);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => {
                setHidden(prev => {
                  const next = new Set(prev);
                  if (next.has(s.name)) next.delete(s.name);
                  else next.add(s.name);
                  return next;
                });
              }}
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11.5px] transition-colors"
              style={{
                backgroundColor: shown ? `color-mix(in srgb, ${s.color} 8%, transparent)` : "transparent",
                borderColor: shown ? `color-mix(in srgb, ${s.color} 32%, transparent)` : C.border,
                opacity: shown ? 1 : 0.55,
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: shown ? s.color : "transparent", border: shown ? "none" : `1.5px solid ${s.color}` }}
              />
              <span className="font-semibold" style={{ color: C.textBody }}>{s.name}</span>
              {hovered !== null ? (
                <span className="tabular-nums font-bold" style={{ color: s.color }}>{hovered}</span>
              ) : (
                <span className="tabular-nums text-[10px]" style={{ color: C.textDim }}>{total} {totalLabel}</span>
              )}
            </button>
          );
        })}
        {priorSeries && priorSeries.length > 0 && (
          <span
            className="inline-flex items-center gap-1.5 ml-auto pl-2 text-[10.5px]"
            style={{ color: C.textDim }}
          >
            <span aria-hidden className="inline-block w-5 h-0" style={{ borderTop: `1.4px dashed ${C.textMuted}` }} />
            {priorLabel}
          </span>
        )}
      </div>
    </div>
  );
}
