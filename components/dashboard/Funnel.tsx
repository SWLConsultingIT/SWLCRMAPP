// Conversion funnel — horizontal bars that taper from "Importados" to
// "Ganados" with the drop-off percentage between consecutive stages on
// the right. Width is proportional to the stage's count relative to the
// first stage so the visual matches the math.
//
// When a `prior` count is supplied per stage we render a thin ghost bar
// behind the current one — the prior period's count — and an inline
// delta label so the period-over-period delta lives where it matters
// (next to the bar, not in a separate panel).

import { C } from "@/lib/design";

type Stage = { stage: string; count: number; color: string; prior?: number | null };

const colorMap: Record<string, string> = {
  neutral: "#9CA3AF",
  info:    "#0A66C2",
  warning: "#D97706",
  success: "#059669",
  brand:   "#c9a83a",
};

export default function Funnel({
  stages,
  fromPrevLabel = "of previous",
  priorLabel = "Prior period",
  vsPriorLabel = "vs prior",
}: {
  stages: Stage[];
  fromPrevLabel?: string;
  priorLabel?: string;
  vsPriorLabel?: string;
}) {
  const top = stages[0]?.count ?? 0;
  // Choose the visual scale from max(current, prior) so the ghost bar can
  // exceed the current bar when the previous period was bigger — common
  // when activity drops.
  const visMax = Math.max(top, ...stages.map(s => s.prior ?? 0), 1);

  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].count : null;
        const widthPct = visMax > 0 ? Math.max(8, Math.round((s.count / visMax) * 100)) : 8;
        const priorWidthPct = s.prior != null && visMax > 0 ? Math.max(0, Math.round((s.prior / visMax) * 100)) : 0;
        const stepConversion = prev !== null && prev > 0 ? Math.round((s.count / prev) * 100) : null;
        const dropOff = prev !== null && prev > 0 ? prev - s.count : null;
        const color = colorMap[s.color] ?? colorMap.neutral;

        const periodDelta = s.prior != null && s.prior > 0 ? Math.round(((s.count / s.prior) - 1) * 100) : null;
        const deltaColor = periodDelta === null ? C.textDim : periodDelta > 0 ? C.green : periodDelta < 0 ? C.red : C.textDim;

        return (
          <div key={s.stage} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right">
              <p className="text-xs font-semibold" style={{ color: C.textBody }}>{s.stage}</p>
              {stepConversion !== null && (
                <p className="text-[10px]" style={{ color: C.textDim }}>{stepConversion}% {fromPrevLabel}</p>
              )}
            </div>
            <div
              className="flex-1 relative h-10 rounded-lg overflow-hidden"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 5%, ${C.surface})` }}
            >
              {/* Ghost bar — prior period count, rendered behind the live bar */}
              {s.prior != null && priorWidthPct > 0 && (
                <div
                  className="absolute inset-y-0 left-0 rounded-lg pointer-events-none"
                  style={{
                    width: `${priorWidthPct}%`,
                    background: `repeating-linear-gradient(45deg, ${C.border} 0 4px, transparent 4px 8px)`,
                    opacity: 0.55,
                    border: `1px dashed color-mix(in srgb, ${color} 35%, transparent)`,
                  }}
                  aria-hidden
                  title={`Prior period: ${s.prior.toLocaleString("en-US")}`}
                />
              )}
              {/* Live bar */}
              <div
                className="absolute inset-y-0 left-0 flex items-center px-3 rounded-lg transition-[width]"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 75%, white))`,
                  boxShadow: `0 1px 2px ${color}33`,
                  minWidth: 80,
                }}
              >
                <span
                  className="text-sm font-bold tabular-nums"
                  style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.2)" }}
                >
                  {s.count.toLocaleString("en-US")}
                </span>
              </div>
            </div>
            <div className="w-20 shrink-0 text-right">
              {periodDelta !== null ? (
                <p className="text-[10.5px] font-semibold tabular-nums" style={{ color: deltaColor }}>
                  {periodDelta > 0 ? "+" : ""}{periodDelta}%
                  <span className="block text-[9px] font-medium" style={{ color: C.textDim }}>
                    {vsPriorLabel}
                  </span>
                </p>
              ) : dropOff !== null && dropOff > 0 ? (
                <p className="text-[10px] font-medium" style={{ color: C.textDim }}>
                  −{dropOff.toLocaleString("en-US")}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {stages.some(s => s.prior != null) && (
        <div className="flex items-center gap-2 pt-1 text-[10px]" style={{ color: C.textDim }}>
          <span className="inline-block w-4 h-2 rounded-sm" style={{
            background: `repeating-linear-gradient(45deg, ${C.border} 0 3px, transparent 3px 6px)`,
            border: `1px dashed ${C.border}`,
          }} />
          <span>{priorLabel}</span>
        </div>
      )}
    </div>
  );
}
