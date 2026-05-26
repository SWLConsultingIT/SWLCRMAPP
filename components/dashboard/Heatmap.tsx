// Activity heatmap — 7 days of the week × 24 hours. Color intensity scales
// with the reply count for that bucket. Answers "when do leads actually
// engage?" so the seller knows when to send.

import { C } from "@/lib/design";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default function Heatmap({ matrix }: { matrix: number[][] }) {
  // matrix is [7][24]: Sun..Sat × 0..23h
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex items-center gap-1 mb-2 pl-9">
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="text-[9px] text-center" style={{ width: 16, color: C.textDim }}>
              {h % 6 === 0 ? `${h}h` : ""}
            </div>
          ))}
        </div>
        {DAYS.map((label, d) => (
          <div key={d} className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-medium w-8 text-right tabular-nums" style={{ color: C.textMuted }}>{label}</span>
            <div className="flex gap-1">
              {Array.from({ length: 24 }).map((_, h) => {
                const v = matrix[d]?.[h] ?? 0;
                const intensity = v / max; // 0..1
                const bg = intensity === 0
                  ? C.surface
                  : `color-mix(in srgb, var(--brand, #c9a83a) ${Math.round(15 + intensity * 70)}%, ${C.bg})`;
                return (
                  <div
                    key={h}
                    title={`${label} ${h}:00 — ${v} respuesta${v === 1 ? "" : "s"}`}
                    style={{
                      width: 16, height: 16, borderRadius: 3,
                      backgroundColor: bg,
                      border: intensity === 0 ? `1px solid ${C.border}` : `1px solid color-mix(in srgb, var(--brand, #c9a83a) ${Math.round(intensity * 40)}%, transparent)`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2 pl-9 text-[10px]" style={{ color: C.textMuted }}>
          <span>Menos</span>
          <div className="flex gap-0.5">
            {[0.05, 0.3, 0.55, 0.8, 1].map((p, i) => (
              <div key={i} style={{
                width: 16, height: 8, borderRadius: 2,
                backgroundColor: p < 0.1 ? C.surface : `color-mix(in srgb, var(--brand, #c9a83a) ${Math.round(15 + p * 70)}%, ${C.bg})`,
                border: `1px solid ${C.border}`,
              }} />
            ))}
          </div>
          <span>Más</span>
        </div>
      </div>
    </div>
  );
}
