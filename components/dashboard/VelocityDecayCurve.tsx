// Reply velocity decay curve — cumulative probability of a reply by day N
// since the lead's first sent message. The curve always rises monotonically;
// the day where it plateaus is your operational "stop chasing" line.
//
// When the cutoff day is known (95% of the final value reached), we draw a
// vertical reference line + a labeled callout so the actionable threshold
// is readable at a glance.

import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export default function VelocityDecayCurve({
  curve,
  totalMessaged,
  cutoffDay,
  finalPct,
  emptyLabel = "Not enough data yet — need ≥30 messaged leads.",
  cutoffLabel = "By day {n}, you've captured 95% of replies that will ever come.",
  cutoffPendingLabel = "Curve still rising — keep watching.",
  yAxisLabel = "% replied",
  xAxisLabel = "Days since first message",
}: {
  curve: number[];           // length 31, percentages 0..100
  totalMessaged: number;
  cutoffDay: number | null;
  finalPct: number;
  emptyLabel?: string;
  cutoffLabel?: string;      // supports {n}
  cutoffPendingLabel?: string;
  yAxisLabel?: string;
  xAxisLabel?: string;
}) {
  if (totalMessaged < 30 || finalPct === 0) {
    return (
      <div className="py-10 text-center text-[12px]" style={{ color: C.textMuted }}>
        {emptyLabel}
      </div>
    );
  }

  const width = 720;
  const height = 220;
  const padding = { t: 16, r: 24, b: 32, l: 38 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const n = curve.length;                            // 31
  const maxY = Math.max(...curve, 1);                // top of plotted range (the final %)
  // Round axis ceiling up to a nice number (5, 10, 20, 50).
  const niceMax = maxY <= 5 ? 5 : maxY <= 10 ? 10 : maxY <= 20 ? 20 : maxY <= 50 ? 50 : 100;

  const xFor = (i: number) => padding.l + (i / (n - 1)) * innerW;
  const yFor = (v: number) => padding.t + innerH - (v / niceMax) * innerH;

  const path = curve.map((v, i) => (i === 0 ? "M" : "L") + xFor(i) + "," + yFor(v)).join(" ");
  const fillPath = `${path} L${xFor(n - 1)},${padding.t + innerH} L${padding.l},${padding.t + innerH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(p => ({ v: Math.round(niceMax * p), y: yFor(niceMax * p) }));

  return (
    <div className="space-y-3">
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 540, maxWidth: "100%" }}>
          {/* Gridlines */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padding.l} x2={width - padding.r}
                y1={tick.y} y2={tick.y}
                stroke={C.border}
                strokeDasharray={i === 0 ? "0" : "3,4"}
                opacity={i === 0 ? 1 : 0.5}
              />
              <text
                x={padding.l - 8} y={tick.y + 3}
                textAnchor="end" fontSize={10} fill={C.textDim}
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {tick.v}%
              </text>
            </g>
          ))}

          {/* X-axis ticks: 0, 5, 10, 15, 20, 25, 30 */}
          {[0, 5, 10, 15, 20, 25, 30].map(d => (
            <text key={d} x={xFor(d)} y={height - 12} textAnchor="middle" fontSize={10} fill={C.textDim}>
              {d}d
            </text>
          ))}
          {/* X-axis label */}
          <text x={width / 2} y={height - 0} textAnchor="middle" fontSize={10} fill={C.textMuted}>
            {xAxisLabel}
          </text>

          {/* Cutoff reference line */}
          {cutoffDay !== null && (
            <g>
              <line
                x1={xFor(cutoffDay)} x2={xFor(cutoffDay)}
                y1={padding.t} y2={padding.t + innerH}
                stroke={gold}
                strokeWidth={1.4}
                strokeDasharray="4,4"
                opacity={0.85}
              />
              <text
                x={xFor(cutoffDay) + 6}
                y={padding.t + 12}
                fontSize={10}
                fontWeight={700}
                fill={gold}
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                day {cutoffDay}
              </text>
            </g>
          )}

          {/* Curve */}
          <defs>
            <linearGradient id="vdc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gold} stopOpacity={0.22} />
              <stop offset="100%" stopColor={gold} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={fillPath} fill="url(#vdc-fill)" />
          <path d={path} fill="none" stroke={gold} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />

          {/* Final-value dot */}
          <circle cx={xFor(n - 1)} cy={yFor(curve[n - 1])} r={4} fill={gold} stroke="var(--c-card)" strokeWidth={1.5} />
          <text
            x={xFor(n - 1) - 6}
            y={yFor(curve[n - 1]) - 8}
            textAnchor="end"
            fontSize={11}
            fontWeight={700}
            fill={C.textPrimary}
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {curve[n - 1]}%
          </text>

          {/* Y-axis title rotated */}
          <text
            x={14} y={height / 2}
            transform={`rotate(-90 14 ${height / 2})`}
            textAnchor="middle"
            fontSize={10}
            fill={C.textMuted}
          >
            {yAxisLabel}
          </text>
        </svg>
      </div>

      {/* Cutoff callout — actionable line under the chart */}
      <div className="rounded-lg px-3 py-2 text-[11.5px] leading-snug"
        style={{
          background: cutoffDay !== null ? `color-mix(in srgb, ${gold} 9%, transparent)` : `color-mix(in srgb, ${C.textMuted} 7%, transparent)`,
          borderLeft: `2px solid ${cutoffDay !== null ? gold : C.textMuted}`,
          color: C.textBody,
        }}>
        {cutoffDay !== null
          ? cutoffLabel.replace("{n}", String(cutoffDay))
          : cutoffPendingLabel}
      </div>
    </div>
  );
}
