// Activity heatmap — 7 days of the week × 24 hours. Color intensity scales
// with the count for that bucket. Self-marks the top-3 hottest cells with a
// subtle gold ring so the eye finds the peaks instantly.
//
// Labels (days, unit, legend) come in via props so the parent controls the
// language and the tooltip wording (e.g. "replies" vs "sends" depending on
// where the heatmap is mounted).

import { C } from "@/lib/design";

const DEFAULT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const gold = "var(--brand, #c9a83a)";

export default function Heatmap({
  matrix,
  days = DEFAULT_DAYS,
  unitLabel = "events",
  legendMin = "Less",
  legendMax = "More",
}: {
  /** [7][24] — Sun..Sat × 0..23h */
  matrix: number[][];
  days?: string[];
  unitLabel?: string;
  legendMin?: string;
  legendMax?: string;
}) {
  const max = Math.max(1, ...matrix.flat());

  // Find top-3 hot cells by absolute count. Used to draw a gold ring around
  // them, so the peak hours/days are obvious at a glance.
  type Cell = { d: number; h: number; v: number };
  const cells: Cell[] = [];
  for (let d = 0; d < matrix.length; d++) {
    for (let h = 0; h < 24; h++) {
      const v = matrix[d]?.[h] ?? 0;
      if (v > 0) cells.push({ d, h, v });
    }
  }
  const top3 = cells.sort((a, b) => b.v - a.v).slice(0, 3);
  const isTop = (d: number, h: number) => top3.some(c => c.d === d && c.h === h);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Hour axis */}
        <div className="flex items-center gap-1 mb-2 pl-9">
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="text-[9px] text-center" style={{ width: 16, color: C.textDim }}>
              {h % 6 === 0 ? `${h}h` : ""}
            </div>
          ))}
        </div>
        {days.map((label, d) => (
          <div key={d} className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-medium w-8 text-right tabular-nums" style={{ color: C.textMuted }}>{label}</span>
            <div className="flex gap-1">
              {Array.from({ length: 24 }).map((_, h) => {
                const v = matrix[d]?.[h] ?? 0;
                const intensity = v / max; // 0..1
                const bg = intensity === 0
                  ? C.surface
                  : `color-mix(in srgb, ${gold} ${Math.round(15 + intensity * 70)}%, ${C.bg})`;
                const peak = isTop(d, h);
                return (
                  <div
                    key={h}
                    title={`${label} ${h}:00 — ${v} ${unitLabel}`}
                    style={{
                      width: 16, height: 16, borderRadius: 3,
                      backgroundColor: bg,
                      border: peak
                        ? `1.5px solid ${gold}`
                        : intensity === 0
                          ? `1px solid ${C.border}`
                          : `1px solid color-mix(in srgb, ${gold} ${Math.round(intensity * 40)}%, transparent)`,
                      boxShadow: peak ? `0 0 0 2px color-mix(in srgb, ${gold} 22%, transparent)` : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between mt-3 pl-9 text-[10px]" style={{ color: C.textMuted }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: gold, boxShadow: `0 0 0 1.5px color-mix(in srgb, ${gold} 22%, transparent)` }} />
            <span style={{ color: C.textDim }}>Peak (top 3)</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span>{legendMin}</span>
            <div className="flex gap-0.5">
              {[0.05, 0.3, 0.55, 0.8, 1].map((p, i) => (
                <div key={i} style={{
                  width: 16, height: 8, borderRadius: 2,
                  backgroundColor: p < 0.1 ? C.surface : `color-mix(in srgb, ${gold} ${Math.round(15 + p * 70)}%, ${C.bg})`,
                  border: `1px solid ${C.border}`,
                }} />
              ))}
            </div>
            <span>{legendMax}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
