// Sequence step performance — answers "which step of the sequence is killing
// my funnel?". Today the dashboard reports aggregate reply rates per campaign
// or channel; this surfaces the per-step view so you know which specific
// message to rewrite.
//
// Reply attribution: each reply is bucketed to the step of the LAST sent
// message before the reply timestamp. See lib/dashboard-data.ts for the math.
//
// Flags a step as a "drop point" when its reply rate is materially below the
// running average of preceding steps (>40% relative deterioration) — that's
// where the lead engagement dies.

import { AlertTriangle } from "lucide-react";
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
  // Bar visualizes REPLY RATE (not sent volume) — that's the column the user is
  // comparing. Sent count already lives in its own column. Using rate also
  // means Step 1 (CR) with 0% renders as an empty bar, which matches the math
  // and stops being visually misleading.
  const maxRate = Math.max(...steps.map(s => s.replyRate ?? 0), 1);

  // Detect drop points: a step whose reply rate is <60% of the median of
  // earlier steps WITH POSITIVE RATES. We deliberately skip CR (step 0) when
  // computing the prior median because CRs in SWL's data don't generate text
  // replies (the "acceptance" is the real CR outcome, tracked elsewhere).
  // Including a 0% CR would falsely pull the median down and mask real drops.
  const dropFlags = new Set<number>();
  for (let i = 1; i < steps.length; i++) {
    const cur = steps[i].replyRate;
    if (cur === null) continue;
    const priorRates = steps.slice(0, i)
      .filter(s => s.step > 0)  // exclude CR from baseline
      .map(s => s.replyRate)
      .filter((r): r is number => r !== null && r > 0);
    if (priorRates.length === 0) continue;
    const sorted = [...priorRates].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0 && cur < median * 0.6) dropFlags.add(steps[i].step);
  }

  return (
    <div className="space-y-2">
      {/* Column header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
        <span>{t("dashx.step.colStep")}</span>
        <span className="text-right w-16">{t("dashx.step.colSent")}</span>
        <span className="text-right w-16">{t("dashx.step.colReplied")}</span>
        <span className="text-right w-12">{t("dashx.step.colRate")}</span>
      </div>
      {steps.map(s => {
        const isCR = s.step === 0;
        const ratePct = ((s.replyRate ?? 0) / maxRate) * 100;
        const isDrop = dropFlags.has(s.step);
        const rateColor = s.replyRate === null ? C.textDim :
                          isCR ? C.textMuted :
                          isDrop ? C.red :
                          s.replyRate >= maxRate * 0.7 ? gold : C.textBody;
        // Bar color: warning red on drop, gold otherwise, dimmed gray for CR
        // (since the rate doesn't carry the same meaning).
        const barColor = isCR ? `color-mix(in srgb, ${C.textMuted} 18%, transparent)` :
                         isDrop ? `color-mix(in srgb, ${C.red} 30%, transparent)` :
                         `color-mix(in srgb, ${gold} 38%, transparent)`;

        return (
          <div key={s.step} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-1 py-1.5 rounded-md transition-colors hover:bg-black/[0.02]">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12.5px] font-medium truncate" style={{ color: C.textPrimary }}>
                  {labelFor(s.step)}
                </span>
                {isCR && (
                  <span className="text-[9.5px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                    style={{ background: `color-mix(in srgb, ${gold} 10%, transparent)`, color: C.textMuted }}
                    title={t("dashx.step.crNoteTooltip")}>
                    {t("dashx.step.crBadge")}
                  </span>
                )}
                {isDrop && !isCR && (
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                    style={{ background: `color-mix(in srgb, ${C.red} 12%, transparent)`, color: C.red }}>
                    <AlertTriangle size={9} /> {t("dashx.step.drop")}
                  </span>
                )}
              </div>
              <div className="relative h-1.5 mt-1 rounded-full" style={{ background: C.surface }}>
                <div className="absolute inset-y-0 left-0 rounded-full transition-[width]"
                  style={{ width: `${ratePct}%`, background: barColor, minWidth: s.replyRate ? 4 : 0 }} />
              </div>
            </div>
            <div className="text-right tabular-nums text-[12.5px] w-16" style={{ color: C.textPrimary }}>
              {s.sent.toLocaleString("es-AR")}
            </div>
            <div className="text-right tabular-nums text-[12.5px] w-16" style={{ color: s.replied > 0 ? C.green : C.textMuted, fontWeight: s.replied > 0 ? 600 : 400 }}>
              {s.replied.toLocaleString("es-AR")}
            </div>
            <div className="text-right tabular-nums text-[12.5px] font-semibold w-12" style={{ color: rateColor }}>
              {s.replyRate === null ? "—" : isCR ? "—" : `${s.replyRate}%`}
            </div>
          </div>
        );
      })}
      <div className="px-1 pt-1 text-[10px] leading-relaxed" style={{ color: C.textDim }}>
        {t("dashx.step.note")}
        {steps.some(s => s.step === 0) && (
          <>
            <br />
            {t("dashx.step.crFootnote")}
          </>
        )}
      </div>
    </div>
  );
}
