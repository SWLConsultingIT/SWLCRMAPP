// Reply classification donut. Pure SVG — no chart lib. Renders each slice
// with the seed color from the classification map + a legend below. The
// center value is the total, formatted as 1.2k when ≥1000 so the layout
// doesn't break with high-volume tenants.
//
// Labels (center caption, "no data" copy) come in via props so the parent
// controls the language and the wording.

import { C } from "@/lib/design";

type Slice = { label: string; value: number; color: string };

export default function Donut({
  data,
  size = 180,
  thickness = 26,
  centerLabel = "replies",
  emptyLabel = "No replies in the period",
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  /** Caption under the big number in the center (e.g. "replies", "respuestas"). */
  centerLabel?: string;
  /** Shown in the legend when total = 0. */
  emptyLabel?: string;
}) {
  const total = data.reduce((acc, s) => acc + s.value, 0);
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const displayTotal = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total.toLocaleString("en-US");

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track ring — visible only when there's data, so the empty state is empty by design */}
        {total > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={thickness} opacity={0.5} />
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
            fontSize={30}
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
            x={size / 2} y={size / 2 + 16}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={600}
            fill={C.textMuted}
            letterSpacing="0.16em"
            style={{ textTransform: "uppercase" }}
          >
            {centerLabel}
          </text>
        </g>
      </svg>

      <div className="flex-1 space-y-1.5 min-w-0">
        {data.length === 0 ? (
          <p className="text-[11.5px]" style={{ color: C.textDim }}>{emptyLabel}</p>
        ) : data.map(s => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.label} className="flex items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate text-[12px]" style={{ color: C.textBody }}>{s.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 tabular-nums" style={{ color: C.textMuted }}>
                <span className="font-semibold text-[12px]" style={{ color: C.textPrimary }}>{s.value}</span>
                <span className="text-[10.5px] w-9 text-right" style={{ color: C.textDim }}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
