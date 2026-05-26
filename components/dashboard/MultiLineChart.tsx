// Pure-SVG multi-line chart for the 30d trend. N series with a soft fill
// under the dominant series, end-of-series dots, and peak indicators per
// series. No chart library — keeps the bundle slim and renders inside RSC.
//
// Axis labels and the "today" anchor come from props so the parent
// controls the language (es-AR vs en-US, "Hoy" vs "Today").

import { C } from "@/lib/design";

type Series = { name: string; color: string; data: number[] };

export default function MultiLineChart({
  series,
  height = 240,
  todayLabel = "Today",
  /** Optional day-of-week labels (length 7, Sun..Sat) for sparse x-axis ticks.
   * When omitted we fall back to numeric "Nd" markers. */
  recentLabel = "d",
}: {
  series: Series[];
  height?: number;
  todayLabel?: string;
  recentLabel?: string;
}) {
  const width = 720;
  const padding = { t: 16, r: 16, b: 30, l: 38 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const n = series[0]?.data.length ?? 30;
  const max = Math.max(1, ...series.flatMap(s => s.data));
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const yFor = (v: number) => padding.t + innerH - (v / max) * innerH;
  const xFor = (i: number) => padding.l + i * stepX;

  // 4 y-axis gridlines, evenly spaced — denser ticks at ints below 10
  const yTicks = (() => {
    const stops = max <= 4 ? [0, 1, 0.5, 0.75, 1].slice(0, max + 1).map((_, i) => i / max) : [0, 0.25, 0.5, 0.75, 1];
    const unique = Array.from(new Set(stops.map(p => Math.round(max * p))));
    return unique.map(v => ({ v, y: yFor(v) }));
  })();

  // Identify peak per series (largest single bucket). Skip flat-zero series.
  const peaks = series.map(s => {
    const peakIdx = s.data.reduce((best, v, i) => v > s.data[best] ? i : best, 0);
    return { idx: peakIdx, value: s.data[peakIdx] };
  });

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 540, maxWidth: "100%" }}>
        {/* Gridlines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padding.l} x2={width - padding.r}
              y1={t.y} y2={t.y}
              stroke={C.border}
              strokeDasharray={i === 0 ? "0" : "3,4"}
              opacity={i === 0 ? 1 : 0.5}
            />
            <text
              x={padding.l - 8} y={t.y + 3}
              textAnchor="end"
              fontSize={10}
              fill={C.textDim}
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {t.v}
            </text>
          </g>
        ))}

        {/* X-axis: every ~5 days, with "today" anchored */}
        {Array.from({ length: n }).map((_, i) => {
          if (i % 5 !== 0 && i !== n - 1) return null;
          const label = i === n - 1 ? todayLabel : `${n - 1 - i}${recentLabel}`;
          return (
            <text
              key={i}
              x={xFor(i)} y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill={C.textDim}
            >
              {label}
            </text>
          );
        })}

        {/* Series lines + fills */}
        {series.map((s, sIdx) => {
          const path = s.data.map((v, i) => (i === 0 ? "M" : "L") + xFor(i) + "," + yFor(v)).join(" ");
          const fillPath = `${path} L${xFor(s.data.length - 1)},${padding.t + innerH} L${padding.l},${padding.t + innerH} Z`;
          const gradId = `mlc-${sIdx}-${s.name.replace(/[^a-z0-9]/gi, "")}`;
          const peak = peaks[sIdx];

          return (
            <g key={sIdx}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={sIdx === 0 ? 0.18 : 0.08} />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={fillPath} fill={`url(#${gradId})`} />
              <path
                d={path}
                fill="none"
                stroke={s.color}
                strokeWidth={sIdx === 0 ? 2 : 1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* End-of-series emphasis dot */}
              <circle
                cx={xFor(s.data.length - 1)}
                cy={yFor(s.data[s.data.length - 1])}
                r={3.8}
                fill={s.color}
                stroke="var(--c-card)"
                strokeWidth={1.5}
              />

              {/* Peak marker — outlined ring so it doesn't read as a regular dot */}
              {peak.value > 0 && peak.idx !== s.data.length - 1 && (
                <g>
                  <circle
                    cx={xFor(peak.idx)}
                    cy={yFor(peak.value)}
                    r={5.5}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.6}
                    opacity={0.85}
                  />
                  <text
                    x={xFor(peak.idx)}
                    y={yFor(peak.value) - 9}
                    textAnchor="middle"
                    fontSize={9.5}
                    fontWeight={600}
                    fill={s.color}
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {peak.value}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs flex-wrap" style={{ color: C.textMuted }}>
        {series.map(s => (
          <div key={s.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="font-medium">{s.name}</span>
            <span className="tabular-nums" style={{ color: C.textDim }}>
              {s.data.reduce((a, b) => a + b, 0)} total
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
