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
  legendTitle,
}: {
  stages: Stage[];
  fromPrevLabel?: string;
  priorLabel?: string;
  vsPriorLabel?: string;
  /** When set, renders a permanent legend strip under the funnel with one
   * line per stage. Boss feedback 2026-05-28: "sigue sin entenderse qué
   * es cada métrica" — tooltips alone weren't enough, the definitions
   * need to be visible without hover. */
  legendTitle?: string;
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
        // Width is the TRUE proportion — no artificial floor — so a 0 count
        // renders an empty bar (boss 2026-06-08: the Won bar showed full at 0).
        const widthPct = visMax > 0 ? Math.round((s.count / visMax) * 100) : 0;
        const priorWidthPct = s.prior != null && visMax > 0 ? Math.max(0, Math.round((s.prior / visMax) * 100)) : 0;
        const stepConversion = prev !== null && prev > 0 ? Math.round((s.count / prev) * 100) : null;
        const color = colorMap[s.color] ?? colorMap.neutral;
        // Number sits inside the bar only when it's wide enough to hold it;
        // otherwise it renders just to the right so a small/zero bar stays
        // readable without faking a filled bar.
        const labelInside = widthPct >= 14;

        return (
          <div key={s.stage} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right">
              <p
                className="text-xs font-semibold inline-flex items-center justify-end gap-1"
                style={{ color: C.textBody }}
              >
                {s.stage}
                {s.definition && (
                  // Custom hover popover instead of native title="" so the
                  // full definition renders with proper width + wrapping +
                  // brand styling (boss 2026-05-28: native tooltip was tiny
                  // and truncated — "no tira info").
                  <span className="group/tip relative inline-flex">
                    <span
                      tabIndex={0}
                      role="img"
                      aria-label={s.definition}
                      className="text-[9px] font-bold rounded-full w-3.5 h-3.5 inline-flex items-center justify-center cursor-help transition-colors hover:bg-black/[0.06] focus:outline-none focus:ring-2 focus:ring-amber-300"
                      style={{ background: C.surface, color: C.textDim, border: `1px solid ${C.border}` }}
                    >
                      ?
                    </span>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 w-64 rounded-md border px-3 py-2 text-[11px] font-medium leading-snug shadow-lg opacity-0 transition-opacity duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
                      style={{
                        background: "#0B0F1A",
                        color: "#E5E7EB",
                        borderColor: `color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)`,
                        boxShadow: "0 10px 28px -10px rgba(0,0,0,0.4)",
                      }}
                    >
                      {s.definition}
                    </span>
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
                  boxShadow: widthPct === 0 ? "none" : s.color === "brand"
                    ? `0 4px 12px color-mix(in srgb, ${color} 32%, transparent), inset 0 1px 0 color-mix(in srgb, ${color} 30%, white)`
                    : `0 2px 6px color-mix(in srgb, ${color} 22%, transparent)`,
                  minWidth: s.count > 0 ? 4 : 0,
                }}
              >
                {labelInside && (
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{
                      color: s.color === "brand" ? "#1A1505" : "#fff",
                      textShadow: s.color === "brand" ? "none" : "0 1px 2px rgba(0,0,0,0.18)",
                    }}
                  >
                    {s.count.toLocaleString("en-US")}
                  </span>
                )}
              </div>
              {!labelInside && (
                <span
                  className="absolute inset-y-0 flex items-center text-sm font-bold tabular-nums pointer-events-none"
                  style={{ left: `calc(${widthPct}% + 8px)`, color: C.textBody }}
                >
                  {s.count.toLocaleString("en-US")}
                </span>
              )}
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
      {/* Permanent definitions strip — boss feedback 2026-05-28: tooltips
          alone weren't enough, every stage gets its definition visible. */}
      {legendTitle && stages.some(s => s.definition) && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: C.border }}>
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: C.textMuted }}>
            {legendTitle}
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
            {stages.filter(s => s.definition).map(s => {
              const color = colorMap[s.color] ?? colorMap.neutral;
              return (
                <li key={s.stage} className="flex items-start gap-2 text-[10.5px] leading-snug">
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: color }} />
                  <span style={{ color: C.textBody }}>
                    <span className="font-semibold">{s.stage}:</span>{" "}
                    <span style={{ color: C.textDim }}>{s.definition}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
