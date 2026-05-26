// Pure-SVG multi-line chart for the 30d trend. Three series (sent / replies /
// positive) with a soft fill under the dominant series and a hover legend.
// No chart library — keeps the bundle slim and renders inside RSC.

import { C } from "@/lib/design";

type Series = { name: string; color: string; data: number[] };

export default function MultiLineChart({
  series,
  height = 220,
}: {
  series: Series[];
  height?: number;
}) {
  const width = 720;
  const padding = { t: 16, r: 16, b: 28, l: 36 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const n = series[0]?.data.length ?? 30;
  const max = Math.max(1, ...series.flatMap(s => s.data));
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const yFor = (v: number) => padding.t + innerH - (v / max) * innerH;
  const xFor = (i: number) => padding.l + i * stepX;

  // 4 y-axis gridlines, evenly spaced.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(p => ({ v: Math.round(max * p), y: yFor(max * p) }));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 540, maxWidth: "100%" }}>
        {/* Gridlines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padding.l} x2={width - padding.r} y1={t.y} y2={t.y}
              stroke={C.border} strokeDasharray="3,3" opacity={i === 0 ? 1 : 0.6} />
            <text x={padding.l - 6} y={t.y + 3} textAnchor="end"
              fontSize={10} fill={C.textDim} fontFamily="system-ui">{t.v}</text>
          </g>
        ))}
        {/* X-axis: every ~5 days */}
        {Array.from({ length: n }).map((_, i) => i % 5 === 0 || i === n - 1 ? (
          <text key={i} x={xFor(i)} y={height - 8} textAnchor="middle"
            fontSize={10} fill={C.textDim} fontFamily="system-ui">
            {i === n - 1 ? "Hoy" : `${n - 1 - i}d`}
          </text>
        ) : null)}
        {/* Series lines */}
        {series.map((s, sIdx) => {
          const path = s.data.map((v, i) => (i === 0 ? "M" : "L") + xFor(i) + "," + yFor(v)).join(" ");
          const fillPath = `${path} L${xFor(s.data.length - 1)},${padding.t + innerH} L${padding.l},${padding.t + innerH} Z`;
          const gradId = `mlc-${sIdx}-${s.name.replace(/[^a-z0-9]/gi, "")}`;
          return (
            <g key={sIdx}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={sIdx === 0 ? 0.18 : 0.08} />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={fillPath} fill={`url(#${gradId})`} />
              <path d={path} fill="none" stroke={s.color} strokeWidth={sIdx === 0 ? 2 : 1.6}
                strokeLinecap="round" strokeLinejoin="round" />
              {/* End-of-series dot for emphasis */}
              <circle cx={xFor(s.data.length - 1)} cy={yFor(s.data[s.data.length - 1])} r={3.5}
                fill={s.color} stroke="#fff" strokeWidth={1.5} />
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
