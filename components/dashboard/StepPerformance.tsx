// Sequence step performance — clear card-flow design.
//
// Boss feedback round 3 2026-05-28: "sigo sin entender el grafico de
// performance by step, podes hacer algo mas claro?". Previous funnel-
// cascade with tapering bars was too abstract — bars getting smaller
// looked like "performance dropping" when it actually meant "fewer leads
// reached this step" (which is just the natural funnel shape, not a
// performance signal).
//
// New design: each step is a horizontal card with explicit metrics:
//   - Step number badge + step label (e.g. "Step 2 · Follow-up")
//   - 3 KPI tiles inline: Sent · Replies · Reply rate
//   - Drop-off chip showing leads lost vs previous step
//   - Best/Drop badges + hover glow (preserved from prior version)
//
// No funnel bar. The user reads 3 numbers per step and instantly compares
// step-to-step. Plus a small "→" arrow between cards so the sequence
// flow is still obvious.

import { AlertTriangle, ChevronRight, TrendingDown, TrendingUp, Minus, Send, MessageSquare } from "lucide-react";
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

  // Drop flag = step whose reply rate is <60% of the median of preceding
  // non-CR steps with data. Surfaces "this is where the funnel breaks".
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

  // Best non-CR step (gold ring).
  let bestStep: number | null = null;
  let bestRate = 0;
  for (const s of steps) {
    if (s.step === 0 || s.replyRate === null) continue;
    if (s.replyRate > bestRate) { bestRate = s.replyRate; bestStep = s.step; }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {steps.map((s, idx) => {
          const isCR = s.step === 0;
          const isDrop = dropFlags.has(s.step);
          const isBest = bestStep === s.step;
          const insufficient = s.replyRate === null;

          // Drop-off vs prev non-CR step (in absolute leads). Reads as
          // "we lost 23 leads here".
          let dropOffLeads: number | null = null;
          for (let j = idx - 1; j >= 0; j--) {
            const prev = steps[j];
            if (prev.step === 0) continue;
            dropOffLeads = prev.sent - s.sent;
            break;
          }
          // Delta in reply-rate points vs prev non-CR step.
          let deltaPp: number | null = null;
          if (!isCR && !insufficient) {
            for (let j = idx - 1; j >= 0; j--) {
              const prev = steps[j];
              if (prev.step === 0 || prev.replyRate === null) continue;
              deltaPp = Math.round((s.replyRate! - prev.replyRate!) * 10) / 10;
              break;
            }
          }

          const stepColor = isCR ? C.textMuted
            : isDrop ? C.red
            : isBest ? gold
            : "#7C3AED";

          const cardBg = isCR ? C.card
            : isDrop ? `color-mix(in srgb, ${C.red} 4%, ${C.card})`
            : isBest ? `color-mix(in srgb, ${gold} 5%, ${C.card})`
            : C.card;
          const cardBorder = isDrop ? `color-mix(in srgb, ${C.red} 25%, transparent)`
            : isBest ? `color-mix(in srgb, ${gold} 35%, transparent)`
            : C.border;

          return (
            <div key={s.step} className="flex items-stretch gap-2">
              <div
                className="flex-1 rounded-xl border px-4 py-3 transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[0_8px_24px_-10px_var(--step-glow)]"
                style={{
                  background: cardBg,
                  borderColor: cardBorder,
                  borderLeft: `4px solid ${stepColor}`,
                  ["--step-glow" as string]: `color-mix(in srgb, ${stepColor} 55%, transparent)`,
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Step badge */}
                  <span
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[13px] font-bold tabular-nums"
                    style={{
                      background: `color-mix(in srgb, ${stepColor} 14%, transparent)`,
                      color: stepColor,
                      border: `1px solid color-mix(in srgb, ${stepColor} 28%, transparent)`,
                    }}
                  >
                    {idx + 1}
                  </span>

                  {/* Step label + badges */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }} title={labelFor(s.step)}>
                      {labelFor(s.step)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {isCR && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0 rounded"
                          style={{ background: C.surface, color: C.textMuted }}
                          title={t("dashx.step.crNoteTooltip")}>
                          {t("dashx.step.crBadge")}
                        </span>
                      )}
                      {isDrop && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0 rounded"
                          style={{ background: `color-mix(in srgb, ${C.red} 14%, transparent)`, color: C.red }}>
                          <AlertTriangle size={9} /> {t("dashx.step.drop")}
                        </span>
                      )}
                      {isBest && !isDrop && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0 rounded"
                          style={{ background: `color-mix(in srgb, ${gold} 16%, transparent)`, color: gold }}>
                          {t("dashx.step.best")}
                        </span>
                      )}
                      {dropOffLeads !== null && dropOffLeads > 0 && (
                        <span className="text-[9.5px] tabular-nums" style={{ color: C.textDim }}>
                          {t("dashx.step.lostHere", { n: dropOffLeads })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 3 metric tiles inline — readable on first glance */}
                  <div className="flex items-stretch gap-2">
                    <Tile
                      icon={Send}
                      label={t("dashx.step.colSent")}
                      value={s.sent.toLocaleString("en-US")}
                      color={C.textBody}
                    />
                    <Tile
                      icon={MessageSquare}
                      label={t("dashx.step.colReplied")}
                      value={isCR ? "—" : s.replied.toLocaleString("en-US")}
                      color={s.replied > 0 && !isCR ? "#059669" : C.textBody}
                    />
                    <Tile
                      label={t("dashx.step.colRate")}
                      value={isCR ? "—" : insufficient ? "—" : `${s.replyRate}%`}
                      color={isCR ? C.textDim : insufficient ? C.textDim : isDrop ? C.red : isBest ? gold : C.textPrimary}
                      delta={deltaPp}
                      emphasis
                    />
                  </div>
                </div>
              </div>
              {/* Arrow connector to next step */}
              {idx < steps.length - 1 && (
                <div className="flex items-center shrink-0 w-4" aria-hidden>
                  <ChevronRight size={14} style={{ color: C.textDim }} />
                </div>
              )}
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
                <> · <span style={{ color: C.textDim }}>{t("dashx.step.crFootnote")}</span></>
              )}
            </span>
          </div>
        );
      })()}
    </div>
  );
}

function Tile({
  icon: Icon, label, value, color, delta, emphasis,
}: {
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  color: string;
  delta?: number | null;
  emphasis?: boolean;
}) {
  return (
    <div
      className="rounded-lg border px-3 py-1.5 min-w-[80px] flex flex-col items-end justify-center"
      style={{
        background: emphasis ? `color-mix(in srgb, ${color} 6%, ${C.surface})` : C.surface,
        borderColor: emphasis ? `color-mix(in srgb, ${color} 22%, transparent)` : C.border,
      }}
    >
      <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
        {Icon && <Icon size={9} />}
        {label}
      </span>
      <span className={`${emphasis ? "text-[18px]" : "text-[15px]"} font-bold tabular-nums leading-tight`} style={{ color }}>
        {value}
      </span>
      {delta !== null && delta !== undefined && (
        <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold tabular-nums mt-0.5"
          style={{ color: delta <= -2 ? C.red : delta >= 2 ? "#059669" : C.textMuted }}>
          {delta <= -0.5 ? <TrendingDown size={9} /> : delta >= 0.5 ? <TrendingUp size={9} /> : <Minus size={9} />}
          {delta > 0 ? "+" : ""}{delta}pp
        </span>
      )}
    </div>
  );
}
