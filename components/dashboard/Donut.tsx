// Reply classification donut. Centered layout: ring on top, legend chips
// below — clean, symmetric, no off-balance left-vs-right composition.
//
// Color palette is SWL-cohesive (gold for engagement-style replies, green
// for positive outcomes, red for negative, slate for auto/neutral). The
// upstream caller passes raw classification colors but the donut renders
// whatever it receives — palette is owned by app/page.tsx so a tenant can
// tweak it without changing this component.

import { C } from "@/lib/design";

type Slice = { label: string; value: number; color: string };

export default function Donut({
  data,
  size = 200,
  thickness = 28,
  centerLabel = "replies",
  emptyLabel = "No replies in the period",
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  emptyLabel?: string;
}) {
  const total = data.reduce((acc, s) => acc + s.value, 0);
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const displayTotal = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total.toLocaleString("en-US");

  return (
    <div className="w-full flex flex-col items-center justify-center gap-4 py-2">
      {/* Ring — wrapped in an explicit w-full flex-center so the SVG sits at
          the true horizontal middle of the panel regardless of legend width. */}
      <div className="w-full flex justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {total > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={thickness} opacity={0.45} />
        )}
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          {total === 0 ? (
            <circle r={r} fill="none" stroke={C.border} strokeWidth={thickness} strokeDasharray="2,4" opacity={0.6} />
          ) : data.map((s, i) => {
            if (s.value === 0) return null;
            const len = (s.value / total) * c;
            const dasharray = `${len} ${c - len}`;
            const dashoffset = -offset;
            offset += len;
            return (
              <circle key={i}
                r={r} fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
              />
            );
          })}
        </g>
        {/* Center label */}
        <g>
          <text
            x={size / 2} y={size / 2 - 2}
            textAnchor="middle"
            fontSize={34}
            fontWeight={700}
            fill={C.textPrimary}
            style={{
              fontFeatureSettings: '"tnum"',
              letterSpacing: "-0.02em",
            }}
          >
            {displayTotal}
          </text>
          <text
            x={size / 2} y={size / 2 + 18}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill={C.textMuted}
            letterSpacing="0.18em"
            style={{ textTransform: "uppercase" }}
          >
            {centerLabel}
          </text>
        </g>
      </svg>
      </div>

      {/* Legend chips below — symmetric, centered, wrap freely. */}
      <div className="w-full max-w-md">
        {data.length === 0 ? (
          <p className="text-[12px] text-center" style={{ color: C.textDim }}>{emptyLabel}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center text-[12px]">
            {data.map(s => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              return (
                <div key={s.label} className="inline-flex items-center gap-2 tabular-nums">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span style={{ color: C.textBody }}>{s.label}</span>
                  <span className="font-semibold" style={{ color: C.textPrimary }}>{s.value}</span>
                  <span className="text-[10.5px]" style={{ color: C.textDim }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
