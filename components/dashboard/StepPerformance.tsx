// Sequence step performance — vertical funnel cascade. Each step is a
// horizontal row that tapers as the sent count drops, with the reply rate
// and the drop-off vs the previous step shown to the right. Reads top-to-
// bottom as "and then we lost X% here, and Y% here" — the question the
// boss actually asks when looking at this view.
//
// Step 0 (Connection Request) is rendered without a reply rate because
// CRs in SWL's data are acceptance-tracked, not reply-tracked.
//
// Drop flag (red ring + delta tinted red) appears when a step's reply
// rate is <60% of the median rate of preceding non-CR steps with data.

import { AlertTriangle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { C } from "@/lib/design";
import { t as tFn, type Locale } from "@/lib/i18n-server";

type Step = {
  step: number;
  sent: number;
  replied: number;
  replyRate: number | null;
};

const gold = "var(--brand, #c9a83a)";

export default function StepPerformance({ steps, locale }: { steps: Step[]; locale: Locale }) {
  const t = (k: string, vars?: Record<string, string | number>) => tFn(locale, k, vars);

  if (steps.length === 0) {
    return (
      <div className="py-8 text-center text-[12px]" style={{ color: C.textMuted }}>
        {t("dashx.step.empty")}
      </div>
    );
  }

  const labelFor = (n: number) => n === 0 ? t("dashx.step.cr") : t("dashx.step.followup", { n: n + 1 });
  const maxSent = Math.max(...steps.map(s => s.sent), 1);
  const maxReplyRate = Math.max(...steps.filter(s => s.step > 0).map(s => s.replyRate ?? 0), 1);

  // Identify the leakage point: the non-CR step with the worst reply rate
  // relative to the median of preceding non-CR steps.
  const dropFlags = new Set<number>();
  for (let i = 1; i < steps.length; i++) {
    const cur = steps[i].replyRate;
    if (cur === null) continue;
    const priorRates = steps.slice(0, i)
      .filter(s => s.step > 0)
      .map(s => s.replyRate)
      .filter((r): r is number => r !== null && r > 0);
    if (priorRates.length === 0) continue;
    const sorted = [...priorRates].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0 && cur < median * 0.6) dropFlags.add(steps[i].step);
  }

  // Find the best non-CR step (highest reply rate) so we can crown it gold.
  let bestStep: number | null = null;
  let bestRate = 0;
  for (const s of steps) {
    if (s.step === 0 || s.replyRate === null) continue;
    if (s.replyRate > bestRate) { bestRate = s.replyRate; bestStep = s.step; }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {steps.map((s, idx) => {
          const isCR = s.step === 0;
          const isDrop = dropFlags.has(s.step);
          const isBest = bestStep === s.step;
          const insufficient = s.replyRate === null;

          const sentPct = Math.max(8, Math.round((s.sent / maxSent) * 100));
          const ratePct = !insufficient && !isCR ? Math.round((s.replyRate! / maxReplyRate) * 100) : 0;

          // Delta vs the previous non-CR step with a valid rate.
          let deltaPp: number | null = null;
          if (!isCR && !insufficient) {
            for (let j = idx - 1; j >= 0; j--) {
              const prev = steps[j];
              if (prev.step === 0 || prev.replyRate === null) continue;
              deltaPp = Math.round((s.replyRate! - prev.replyRate!) * 10) / 10;
              break;
            }
          }

          // Bar color: CR neutral, drop red, best gold, default body.
          const barColor = isCR ? C.textMuted
            : isDrop ? C.red
            : isBest ? gold
            : "#7C3AED";
          const rowAccent = isDrop ? "color-mix(in srgb, " + C.red + " 30%, transparent)"
            : isBest ? "color-mix(in srgb, " + gold + " 35%, transparent)"
            : "transparent";

          // Total share of original volume — for the hover reveal so the
          // operator sees "this step still touches 78% of the seed pool".
          const firstStepSent = steps[0]?.sent ?? 0;
          const sharePct = firstStepSent > 0 ? Math.round((s.sent / firstStepSent) * 100) : 0;
          // Drop-off vs prev non-CR step in absolute leads — visible on hover
          // because "we lost 23 leads at this step" reads stronger than -pp.
          let dropOffLeads: number | null = null;
          for (let j = idx - 1; j >= 0; j--) {
            const prev = steps[j];
            if (prev.step === 0) continue;
            dropOffLeads = prev.sent - s.sent;
            break;
          }
          // Glow color matches the row's tone (red drop / gold best / purple default).
          const glowColor = isCR ? C.textMuted : isDrop ? C.red : isBest ? gold : "#7C3AED";

          return (
            <div
              key={s.step}
              // Glow + lift on hover via a custom CSS variable + Tailwind
              // hover utility. CSS-only so the component stays server-side
              // (no useState needed for visual hover).
              className="group rounded-lg border px-3 py-2.5 transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[0_0_0_1.5px_var(--step-glow),0_10px_26px_-10px_var(--step-glow-soft)]"
              style={{
                borderColor: isDrop || isBest ? rowAccent : C.border,
                background: isDrop ? `color-mix(in srgb, ${C.red} 5%, ${C.card})`
                  : isBest ? `color-mix(in srgb, ${gold} 6%, ${C.card})`
                  : C.card,
                ["--step-glow" as string]: `color-mix(in srgb, ${glowColor} 45%, transparent)`,
                ["--step-glow-soft" as string]: `color-mix(in srgb, ${glowColor} 35%, transparent)`,
              }}
            >
            <div className="grid grid-cols-12 items-center gap-3">
              {/* Left: step label + flag */}
              <div className="col-span-3 min-w-0 flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-[10.5px] font-bold tabular-nums"
                  style={{
                    background: isCR ? C.surface
                      : isDrop ? `color-mix(in srgb, ${C.red} 18%, transparent)`
                      : isBest ? `color-mix(in srgb, ${gold} 22%, transparent)`
                      : `color-mix(in srgb, #7C3AED 14%, transparent)`,
                    color: isCR ? C.textMuted : isDrop ? C.red : isBest ? gold : "#7C3AED",
                  }}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold leading-tight truncate" style={{ color: C.textPrimary }} title={labelFor(s.step)}>
                    {labelFor(s.step)}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {isCR && (
                      <span className="text-[9px] font-medium uppercase tracking-wider"
                        style={{ color: C.textDim }}
                        title={t("dashx.step.crNoteTooltip")}>
                        {t("dashx.step.crBadge")}
                      </span>
                    )}
                    {isDrop && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider"
                        style={{ color: C.red }}>
                        <AlertTriangle size={8} /> {t("dashx.step.drop")}
                      </span>
                    )}
                    {isBest && !isDrop && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: gold }}>
                        {t("dashx.step.best")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Middle: tapering sent bar (funnel-cascade shape) */}
              <div className="col-span-5">
                <div className="relative h-7 rounded-md overflow-hidden" style={{ background: C.surface }}>
                  <div
                    className="absolute inset-y-0 left-0 transition-[width]"
                    style={{
                      width: `${sentPct}%`,
                      background: isCR
                        ? `linear-gradient(90deg, color-mix(in srgb, ${C.textMuted} 30%, transparent), color-mix(in srgb, ${C.textMuted} 14%, transparent))`
                        : `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 55%, transparent))`,
                    }}
                  />
                  {/* Inner reply-rate ribbon — width proportional to rate within
                      the sent bar. Visible inside the bar so the eye can directly
                      compare "how much of what we sent actually got replies". */}
                  {!isCR && !insufficient && (
                    <div
                      className="absolute top-1/2 left-1.5 -translate-y-1/2 h-3 rounded-sm"
                      style={{
                        width: `${Math.max(4, Math.round(sentPct * (ratePct / 100)))}%`,
                        background: "rgba(255,255,255,0.65)",
                        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
                      }}
                      title={t("dashx.step.replyShareTooltip")}
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-between px-2.5 text-[10.5px] tabular-nums">
                    <span style={{ color: sentPct > 40 ? "#fff" : C.textBody, fontWeight: 600, textShadow: sentPct > 40 ? "0 1px 2px rgba(0,0,0,0.25)" : undefined }}>
                      {s.sent.toLocaleString("en-US")} {t("dashx.step.colSent").toLowerCase()}
                    </span>
                    <span style={{ color: s.replied > 0 ? "#fff" : C.textDim, fontWeight: s.replied > 0 ? 600 : 400, textShadow: s.replied > 0 && sentPct > 40 ? "0 1px 2px rgba(0,0,0,0.25)" : undefined }}>
                      {s.replied} {t("dashx.step.colReplied").toLowerCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: rate + delta vs previous step */}
              <div className="col-span-4 flex items-baseline justify-end gap-2">
                <span className="text-[18px] font-bold tabular-nums leading-none"
                  style={{
                    color: isCR ? C.textDim
                      : insufficient ? C.textDim
                      : isDrop ? C.red
                      : isBest ? gold
                      : C.textPrimary,
                  }}>
                  {isCR ? "—" : insufficient ? "—" : `${s.replyRate}%`}
                </span>
                <span className="text-[10px]" style={{ color: C.textDim }}>{t("dashx.step.colRate")}</span>
                {deltaPp !== null && (
                  <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold tabular-nums ml-1"
                    style={{
                      color: deltaPp <= -2 ? C.red : deltaPp >= 2 ? C.green : C.textMuted,
                    }}
                    title={t("dashx.step.deltaTooltip")}>
                    {deltaPp <= -0.5 ? <TrendingDown size={11} /> : deltaPp >= 0.5 ? <TrendingUp size={11} /> : <Minus size={11} />}
                    {deltaPp > 0 ? "+" : ""}{deltaPp}pp
                  </span>
                )}
              </div>
            </div>

            {/* Hover-reveal extra info strip — hidden by default, slides
                open on hover. CSS-only (group-hover) so no client state. */}
            <div className="grid grid-cols-3 gap-3 mt-0 pt-0 border-t border-transparent overflow-hidden text-[10.5px] tabular-nums max-h-0 opacity-0 transition-[max-height,opacity,margin,padding] duration-200 group-hover:max-h-16 group-hover:opacity-100 group-hover:mt-2 group-hover:pt-2"
              style={{ borderColor: C.border }}>
              <div>
                <span className="block text-[9.5px] uppercase tracking-wider" style={{ color: C.textDim }}>
                  {t("dashx.step.hoverShare")}
                </span>
                <span className="font-semibold" style={{ color: C.textBody }}>
                  {sharePct}% {t("dashx.step.hoverShareOf")}
                </span>
              </div>
              <div>
                <span className="block text-[9.5px] uppercase tracking-wider" style={{ color: C.textDim }}>
                  {t("dashx.step.hoverDropOff")}
                </span>
                <span className="font-semibold"
                  style={{ color: dropOffLeads !== null && dropOffLeads > 0 ? C.red : C.textBody }}>
                  {dropOffLeads === null ? "—" : dropOffLeads > 0 ? `−${dropOffLeads}` : "0"} {t("dashx.step.hoverLeads")}
                </span>
              </div>
              <div>
                <span className="block text-[9.5px] uppercase tracking-wider" style={{ color: C.textDim }}>
                  {t("dashx.step.hoverYield")}
                </span>
                <span className="font-semibold"
                  style={{ color: !insufficient && !isCR && s.replied > 0 ? "#059669" : C.textBody }}>
                  {isCR ? "—" : insufficient ? "—" : `${s.replied} ${t("dashx.step.hoverYieldOf")} ${s.sent}`}
                </span>
              </div>
            </div>
            </div>
          );
        })}
      </div>

      {/* Headline insight under the rows */}
      {(() => {
        const eligible = steps.filter(s => s.step > 0 && s.replyRate !== null) as Array<Step & { replyRate: number }>;
        if (eligible.length === 0) return null;
        const worst = [...eligible].sort((a, b) => a.replyRate - b.replyRate)[0];
        const isWorstFlagged = dropFlags.has(worst.step);
        return (
          <div className="px-1 pt-1 text-[10.5px] leading-relaxed flex items-start gap-2" style={{ color: C.textDim }}>
            <span style={{ color: isWorstFlagged ? C.red : C.textMuted }}>
              {isWorstFlagged ? <AlertTriangle size={11} className="mt-0.5" /> : <Minus size={11} className="mt-0.5" />}
            </span>
            <span>
              {t("dashx.step.summary", { step: worst.step + 1, rate: worst.replyRate })}
              {steps.some(s => s.step === 0) && (
                <>
                  {" "}
                  <span style={{ color: C.textDim }}>· {t("dashx.step.crFootnote")}</span>
                </>
              )}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
