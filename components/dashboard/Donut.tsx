// Reply classification donut. Pure SVG — no chart lib. Renders each slice
// with the seed color from the classification map + a legend below.

import { C } from "@/lib/design";

type Slice = { label: string; value: number; color: string };

export default function Donut({
  data,
  size = 180,
  thickness = 22,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
}) {
  const total = data.reduce((acc, s) => acc + s.value, 0);
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          {total === 0 ? (
            <circle r={r} fill="none" stroke={C.border} strokeWidth={thickness} />
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
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
              />
            );
          })}
        </g>
        {/* Center label */}
        <g>
          <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fontSize={28} fontWeight={800} fill={C.textPrimary}
            style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
            {total}
          </text>
          <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={10} fill={C.textMuted}
            textTransform="uppercase" letterSpacing="0.08em">respuestas</text>
        </g>
      </svg>
      <div className="flex-1 space-y-1.5">
        {data.length === 0 ? (
          <p className="text-xs" style={{ color: C.textDim }}>Sin respuestas en el período</p>
        ) : data.map(s => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.label} className="flex items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate" style={{ color: C.textBody }}>{s.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 tabular-nums" style={{ color: C.textMuted }}>
                <span className="font-semibold" style={{ color: C.textPrimary }}>{s.value}</span>
                <span className="text-[10px]" style={{ color: C.textDim }}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
