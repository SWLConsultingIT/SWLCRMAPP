// Sequence step performance — horizontal flow visualization. Each step is a
// card connected by an arrow to the next, with sent count + reply rate
// inline. Reads naturally as "first this happens, then this, then this".
// Replaces the dense table view which lost the sequence's temporal shape.
//
// Drop flag (red ring) appears when a step's reply rate is <60% of the
// median rate of preceding non-CR steps with data. Step 0 (CR) is always
// rendered with a quieter style + footnote because CRs in SWL's data don't
// generate text replies (their outcome is acceptance, tracked separately).

import { AlertTriangle, ChevronRight } from "lucide-react";
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
  const maxRate = Math.max(...steps.map(s => s.replyRate ?? 0), 1);

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

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex items-stretch gap-2 min-w-fit">
          {steps.map((s, idx) => {
            const isCR = s.step === 0;
            const isDrop = dropFlags.has(s.step);
            const insufficient = s.replyRate === null;

            // Tile background tone: CR = neutral, drop = red wash, healthy
            // top performer = gold wash, otherwise card surface. Reading is
            // immediate: red = problem, gold = best step.
            const tileBg = isCR ? C.surface :
              isDrop ? `color-mix(in srgb, ${C.red} 7%, ${C.card})` :
              !insufficient && s.replyRate! >= maxRate * 0.85
                ? `color-mix(in srgb, ${gold} 9%, ${C.card})`
                : C.card;
            const tileBorder = isDrop ? C.red :
              !insufficient && s.replyRate! >= maxRate * 0.85 ? `color-mix(in srgb, ${gold} 45%, transparent)` :
              C.border;

            const rateColor = insufficient ? C.textDim :
              isCR ? C.textMuted :
              isDrop ? C.red :
              s.replyRate! >= maxRate * 0.7 ? gold : C.textBody;

            return (
              <div key={s.step} className="contents">
                <div
                  className="rounded-xl border px-4 py-3 min-w-[180px] flex flex-col"
                  style={{ background: tileBg, borderColor: tileBorder }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
                      {t("dashx.detail.campaign.seq.step", { n: idx + 1 })}
                    </span>
                    {isCR && (
                      <span className="text-[9px] font-medium uppercase tracking-wider px-1 py-px rounded-sm"
                        style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: C.textMuted }}
                        title={t("dashx.step.crNoteTooltip")}>
                        {t("dashx.step.crBadge")}
                      </span>
                    )}
                    {isDrop && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded-sm"
                        style={{ background: `color-mix(in srgb, ${C.red} 14%, transparent)`, color: C.red }}>
                        <AlertTriangle size={8} /> {t("dashx.step.drop")}
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] font-medium leading-tight truncate" style={{ color: C.textPrimary }} title={labelFor(s.step)}>
                    {labelFor(s.step)}
                  </p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-[20px] font-semibold tabular-nums leading-none" style={{ color: rateColor }}>
                      {insufficient ? "—" : isCR ? "—" : `${s.replyRate}%`}
                    </span>
                    <span className="text-[10px]" style={{ color: C.textDim }}>{t("dashx.step.colRate")}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10.5px] tabular-nums" style={{ color: C.textMuted }}>
                    <span>{s.sent.toLocaleString("en-US")} {t("dashx.step.colSent").toLowerCase()}</span>
                    <span style={{ color: s.replied > 0 ? C.green : C.textDim, fontWeight: s.replied > 0 ? 600 : 400 }}>
                      {s.replied} {t("dashx.step.colReplied").toLowerCase()}
                    </span>
                  </div>
                </div>
                {idx < steps.length - 1 && (
                  <div className="flex items-center justify-center w-6 shrink-0" aria-hidden>
                    <ChevronRight size={14} style={{ color: C.textDim }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="px-1 pt-1 text-[10px] leading-relaxed" style={{ color: C.textDim }}>
        {t("dashx.step.note")}
        {steps.some(s => s.step === 0) && (
          <>
            <br />
            {t("dashx.step.crFootnote")}
          </>
        )}
      </p>
    </div>
  );
}
