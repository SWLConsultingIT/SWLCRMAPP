// Conversion funnel — horizontal bars that taper from "Importados" to "Ganados"
// with the drop-off percentage between consecutive stages annotated on the
// right. The width is proportional to the stage's count (relative to the
// first stage), so the visual matches the math.

import { C } from "@/lib/design";

type Stage = { stage: string; count: number; color: string };

const colorMap: Record<string, string> = {
  neutral: "#9CA3AF",
  info:    "#0A66C2",
  warning: "#D97706",
  success: "#059669",
  brand:   "#c9a83a",
};

export default function Funnel({ stages }: { stages: Stage[] }) {
  const top = stages[0]?.count ?? 0;
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].count : null;
        const widthPct = top > 0 ? Math.max(8, Math.round((s.count / top) * 100)) : 8;
        const stepConversion = prev !== null && prev > 0 ? Math.round((s.count / prev) * 100) : null;
        const dropOff = prev !== null && prev > 0 ? prev - s.count : null;
        const color = colorMap[s.color] ?? colorMap.neutral;
        return (
          <div key={s.stage} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right">
              <p className="text-xs font-semibold" style={{ color: C.textBody }}>{s.stage}</p>
              {stepConversion !== null && (
                <p className="text-[10px]" style={{ color: C.textDim }}>{stepConversion}% del anterior</p>
              )}
            </div>
            <div className="flex-1 relative h-10 rounded-lg overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${color} 6%, ${C.surface})` }}>
              <div
                className="absolute inset-y-0 left-0 flex items-center px-3 rounded-lg transition-[width]"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 75%, white))`,
                  boxShadow: `0 1px 2px ${color}33`,
                  minWidth: 80,
                }}
              >
                <span className="text-sm font-bold tabular-nums" style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.2)" }}>
                  {s.count.toLocaleString("es-AR")}
                </span>
              </div>
            </div>
            <div className="w-16 shrink-0 text-right">
              {dropOff !== null && dropOff > 0 ? (
                <p className="text-[10px] font-medium" style={{ color: C.textDim }}>
                  −{dropOff.toLocaleString("es-AR")}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
