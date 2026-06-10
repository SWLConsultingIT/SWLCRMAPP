"use client";

import { useState, useEffect } from "react";
import { X, CheckCircle2, Circle } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

export default function OnboardingChecklist() {
  const { t } = useLocale();
  const [shown, setShown] = useState(false);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Show only once per user (localStorage)
    if (typeof window === "undefined") return;
    try {
      const seen = localStorage.getItem("swl-onboarding-checklist-seen");
      if (!seen) {
        setShown(true);
        localStorage.setItem("swl-onboarding-checklist-seen", "1");
      }
    } catch { /* ignore */ }
  }, []);

  if (!shown) return null;

  const steps = [
    { id: 1, label: t("onboarding.step1"), desc: t("onboarding.step1Desc") },
    { id: 2, label: t("onboarding.step2"), desc: t("onboarding.step2Desc") },
    { id: 3, label: t("onboarding.step3"), desc: t("onboarding.step3Desc") },
  ];

  const allCompleted = completed.size === steps.length;

  return (
    <div className="fixed bottom-6 right-6 w-80 rounded-2xl border p-4 z-40 shadow-lg"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-bold text-sm" style={{ color: C.textPrimary }}>
            {t("onboarding.welcome")}
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
            {completed.size}/{steps.length} {t("onboarding.done")}
          </p>
        </div>
        <button
          onClick={() => setShown(false)}
          className="p-1 rounded hover:bg-gray-100"
          style={{ color: C.textMuted }}
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2.5">
        {steps.map((step) => (
          <button
            key={step.id}
            onClick={() => {
              setCompleted((prev) => {
                const next = new Set(prev);
                if (next.has(step.id)) next.delete(step.id);
                else next.add(step.id);
                return next;
              });
            }}
            className="w-full text-left p-2.5 rounded-lg border transition-colors"
            style={{
              backgroundColor: completed.has(step.id) ? `${C.green}14` : C.bg,
              borderColor: completed.has(step.id) ? C.green : C.border,
            }}
          >
            <div className="flex items-start gap-2.5">
              {completed.has(step.id) ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: C.green }} />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0" style={{ color: C.textDim }} />
              )}
              <div className="min-w-0">
                <p
                  className="text-xs font-semibold"
                  style={{ color: completed.has(step.id) ? C.green : C.textPrimary }}
                >
                  {step.label}
                </p>
                <p className="text-[10px] mt-0.5 leading-tight" style={{ color: C.textMuted }}>
                  {step.desc}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {allCompleted && (
        <div className="mt-3 p-2.5 rounded-lg text-center"
          style={{ backgroundColor: `${C.green}14` }}>
          <p className="text-[11px] font-semibold" style={{ color: C.green }}>
            ✓ {t("onboarding.done")}
          </p>
        </div>
      )}
    </div>
  );
}
