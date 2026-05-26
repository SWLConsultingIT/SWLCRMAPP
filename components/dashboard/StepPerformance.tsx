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

type Step = {
  step: number;
  sent: number;
  replied: number;
  replyRate: number | null;
};

const gold = "var(--brand, #c9a83a)";

export default function StepPerformance({ steps }: { steps: Step[] }) {
  if (steps.length === 0) {
    return (
      <div className="py-8 text-center text-[12px]" style={{ color: C.textMuted }}>
        Sin mensajes enviados en el período.
      </div>
    );
  }

  const labelFor = (n: number) => n === 0 ? "Paso 1 — Connection / Intro" : `Paso ${n + 1} — Follow-up`;
  const maxSent = Math.max(...steps.map(s => s.sent), 1);
  const maxRate = Math.max(...steps.map(s => s.replyRate ?? 0), 1);

  // Detect drop points: a step whose reply rate is <60% of the median of
  // earlier steps (with rate available). Skip step 0 (no prior to compare to).
  const dropFlags = new Set<number>();
  for (let i = 1; i < steps.length; i++) {
    const cur = steps[i].replyRate;
    if (cur === null) continue;
    const priorRates = steps.slice(0, i).map(s => s.replyRate).filter((r): r is number => r !== null);
    if (priorRates.length === 0) continue;
    const sorted = [...priorRates].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0 && cur < median * 0.6) dropFlags.add(steps[i].step);
  }

  return (
    <div className="space-y-2">
      {/* Column header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
        <span>Paso de la secuencia</span>
        <span className="text-right w-16">Enviados</span>
        <span className="text-right w-16">Resp.</span>
        <span className="text-right w-12">Rate</span>
      </div>
      {steps.map(s => {
        const sentPct = (s.sent / maxSent) * 100;
        const isDrop = dropFlags.has(s.step);
        const rateColor = s.replyRate === null ? C.textDim : isDrop ? C.red : s.replyRate >= maxRate * 0.7 ? gold : C.textBody;

        return (
          <div key={s.step} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-1 py-1.5 rounded-md transition-colors hover:bg-black/[0.02]">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-medium truncate" style={{ color: C.textPrimary }}>
                  {labelFor(s.step)}
                </span>
                {isDrop && (
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                    style={{ background: `color-mix(in srgb, ${C.red} 12%, transparent)`, color: C.red }}>
                    <AlertTriangle size={9} /> Drop
                  </span>
                )}
              </div>
              <div className="relative h-1.5 mt-1 rounded-full" style={{ background: C.surface }}>
                <div className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${sentPct}%`, background: `color-mix(in srgb, ${gold} 32%, transparent)` }} />
              </div>
            </div>
            <div className="text-right tabular-nums text-[12.5px] w-16" style={{ color: C.textPrimary }}>
              {s.sent.toLocaleString("es-AR")}
            </div>
            <div className="text-right tabular-nums text-[12.5px] w-16" style={{ color: s.replied > 0 ? C.green : C.textMuted, fontWeight: s.replied > 0 ? 600 : 400 }}>
              {s.replied.toLocaleString("es-AR")}
            </div>
            <div className="text-right tabular-nums text-[12.5px] font-semibold w-12" style={{ color: rateColor }}>
              {s.replyRate === null ? "—" : `${s.replyRate}%`}
            </div>
          </div>
        );
      })}
      <div className="px-1 pt-1 text-[10px]" style={{ color: C.textDim }}>
        Reply attribution: cada respuesta se asigna al último step enviado antes de su llegada. Pasos con &lt;5 envíos muestran "—".
      </div>
    </div>
  );
}
