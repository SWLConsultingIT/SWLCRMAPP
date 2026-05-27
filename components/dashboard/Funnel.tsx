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

type Stage = { stage: string; count: number; color: string; prior?: number | null; definition?: string };

// Funnel palette — SWL-gold heat progression. Raw leads start cool (slate),
// then ride a gold intensity ramp (cream → mid gold → full SWL gold) as
// engagement deepens, with green claiming the OUTCOME stages (positives,
// meetings) and premium gold for the Won climax.
//
// The story the eye reads: "raw lead → progressively warmer until they
// engage with us → outcome lands in green → win in pure gold". Single
// hue family with two semantic accents, much cleaner than the prior
// gray / navy / amber / green chaos.
const colorMap: Record<string, string> = {
  neutral: "#94A3B8",   // imported  — slate (raw, no signal yet)
  info:    "#D4BA5C",   // contacted/accepted — mid gold (warm, in motion)
  warning: "#c9a83a",   // replied   — full SWL gold (engaged)
  success: "#10B981",   // positives/meeting — green (good outcome)
  brand:   "#c9a83a",   // won       — SWL gold premium gradient via bar style
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
              <p
                className="text-xs font-semibold inline-flex items-center justify-end gap-1"
                style={{ color: C.textBody, cursor: s.definition ? "help" : undefined }}
                title={s.definition}
              >
                {s.stage}
                {s.definition && (
                  <span aria-hidden className="text-[9px] font-bold rounded-full w-3 h-3 inline-flex items-center justify-center"
                    style={{ background: C.surface, color: C.textDim, border: `1px solid ${C.border}` }}>
                    ?
                  </span>
                )}
              </p>
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
                  background: s.color === "brand"
                    ? `linear-gradient(135deg, ${color} 0%, color-mix(in srgb, ${color} 82%, white) 100%)`
                    : `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 78%, white))`,
                  boxShadow: s.color === "brand"
                    ? `0 4px 12px color-mix(in srgb, ${color} 32%, transparent), inset 0 1px 0 color-mix(in srgb, ${color} 30%, white)`
                    : `0 2px 6px color-mix(in srgb, ${color} 22%, transparent)`,
                  minWidth: 80,
                }}
              >
                <span
                  className="text-sm font-bold tabular-nums"
                  style={{
                    color: s.color === "brand" ? "#1A1505" : "#fff",
                    textShadow: s.color === "brand" ? "none" : "0 1px 2px rgba(0,0,0,0.18)",
                  }}
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
