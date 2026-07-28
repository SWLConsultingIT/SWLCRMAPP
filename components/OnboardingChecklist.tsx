"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X, CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

// First-run guide. Each step reflects REAL tenant state (fetched from
// /api/onboarding/checklist) and links to where the task is actually done —
// no more cosmetic checkboxes that pretend progress. Auto-hides once all three
// are genuinely complete; dismissable meanwhile.
//
// Legacy note: the old widget set "swl-onboarding-checklist-seen" on first
// view for everyone. We treat that (and the new "…-dismissed" key) as
// "don't show again" so existing users aren't re-nagged — only fresh users get
// the guided experience.
const DISMISS_KEY = "swl-onboarding-checklist-dismissed";
const LEGACY_KEY = "swl-onboarding-checklist-seen";

type State = { linkedin: boolean; campaign: boolean; call: boolean };

export default function OnboardingChecklist() {
  const { t } = useLocale();
  const [shown, setShown] = useState(false);
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    try {
      if (localStorage.getItem(DISMISS_KEY) || localStorage.getItem(LEGACY_KEY)) return;
    } catch { /* ignore */ }

    (async () => {
      try {
        const res = await fetch("/api/onboarding/checklist", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as State;
        if (cancelled) return;
        // Already fully onboarded → nothing to guide; remember so it never
        // pops up again.
        if (data.linkedin && data.campaign && data.call) {
          try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
          return;
        }
        setState(data);
        setShown(true);
      } catch {
        // Silent — a first-run nudge isn't worth surfacing an error for.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    setShown(false);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  }

  if (!shown || !state) return null;

  const steps: Array<{ id: number; href: string; label: string; desc: string; done: boolean }> = [
    { id: 1, href: "/accounts",        label: t("onboarding.step1"), desc: t("onboarding.step1Desc"), done: state.linkedin },
    { id: 2, href: "/icp",             label: t("onboarding.step2"), desc: t("onboarding.step2Desc"), done: state.campaign },
    { id: 3, href: "/queue?tab=calls", label: t("onboarding.step3"), desc: t("onboarding.step3Desc"), done: state.call },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="fixed bottom-6 right-6 w-80 rounded-2xl border p-4 z-40 shadow-lg"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-bold text-sm" style={{ color: C.textPrimary }}>
            {t("onboarding.welcome")}
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
            {doneCount}/{steps.length} {t("onboarding.done")}
          </p>
        </div>
        <button
          onClick={dismiss}
          className="p-1 rounded hover:bg-gray-100"
          style={{ color: C.textMuted }}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2.5">
        {steps.map((step) => {
          const inner = (
            <div className="flex items-start gap-2.5">
              {step.done ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: C.green }} />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0" style={{ color: C.textDim }} />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className="text-xs font-semibold"
                  style={{ color: step.done ? C.green : C.textPrimary }}
                >
                  {step.label}
                </p>
                <p className="text-[10px] mt-0.5 leading-tight" style={{ color: C.textMuted }}>
                  {step.desc}
                </p>
              </div>
              {!step.done && (
                <ArrowRight size={13} className="mt-0.5 shrink-0" style={{ color: C.textDim }} />
              )}
            </div>
          );

          // Done steps are static (nothing left to do); pending steps link to
          // where the task gets done, turning the card into a real guide.
          return step.done ? (
            <div
              key={step.id}
              className="w-full p-2.5 rounded-lg border"
              style={{ backgroundColor: `${C.green}14`, borderColor: C.green }}
            >
              {inner}
            </div>
          ) : (
            <Link
              key={step.id}
              href={step.href}
              onClick={() => setShown(false)}
              className="block w-full p-2.5 rounded-lg border transition-colors hover:brightness-105"
              style={{ backgroundColor: C.bg, borderColor: C.border }}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
