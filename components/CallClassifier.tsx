"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { ThumbsUp, ThumbsDown, Clock, PhoneOff, Loader2, Sparkles, X, Voicemail } from "lucide-react";
import { C } from "@/lib/design";

// 2026-06-01: aligned with the 4 outcomes exposed by the post-call
// popup (components/CallButton.tsx submitOutcome). Wire-format values
// stay backwards-compatible — interested → 'positive', not_interested
// → 'negative', bad_timing → 'follow_up' — so we don't have to migrate
// the calls.classification column. Wrong number is a new fourth value
// that the popup also writes, with side-effects on the lead row.
type Classification = "positive" | "negative" | "follow_up" | "voicemail" | "wrong_number";

type Props = {
  callId: string;
  current: Classification | null;
  aiConfidence: number | null;
  aiSummary: string | null;
};

// Module scope: `labelKey`, resolved by the component.
const meta: Record<Classification, { labelKey: string; color: string; bg: string; border: string; icon: typeof ThumbsUp }> = {
  positive:     { labelKey: "clf.interested",    color: "#16A34A", bg: "color-mix(in srgb, #16A34A 16%, transparent)", border: "color-mix(in srgb, #16A34A 32%, transparent)", icon: ThumbsUp },
  negative:     { labelKey: "clf.notInterested", color: C.red,     bg: C.redLight, border: `${C.red}30`, icon: ThumbsDown },
  follow_up:    { labelKey: "clf.badTiming",     color: "#D97706", bg: "color-mix(in srgb, #D97706 16%, transparent)", border: "color-mix(in srgb, #D97706 30%, transparent)", icon: Clock },
  voicemail:    { labelKey: "clf.voicemail",     color: "#0EA5E9", bg: "color-mix(in srgb, #0284C7 14%, transparent)", border: "#BAE6FD", icon: Voicemail },
  wrong_number: { labelKey: "clf.wrongNumber",   color: C.textMuted, bg: C.surface, border: C.border, icon: PhoneOff },
};

export default function CallClassifier({ callId, current, aiConfidence, aiSummary }: Props) {
  const { t } = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState<Classification | "clear" | null>(null);
  const [state, setState] = useState(current);

  const isAI = aiConfidence !== null && aiConfidence < 1;

  async function classify(c: Classification | null) {
    setLoading(c === null ? "clear" : c);
    try {
      const res = await fetch(`/api/calls/${callId}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification: c }),
      });
      if (res.ok) {
        setState(c);
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  if (state) {
    const m = meta[state];
    const Icon = m.icon;
    return (
      <div
        className="flex items-center justify-between gap-3 mt-3 px-3 py-2.5 rounded-lg border"
        style={{ backgroundColor: m.bg, borderColor: m.border }}
      >
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color: m.color }} />
          <span className="text-xs font-bold" style={{ color: m.color }}>
            {isAI ? t("clf.aiClassified") : t("clf.markedAs")} {t(m.labelKey)}
          </span>
          {isAI && (
            <span className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: "rgba(255,255,255,0.7)", color: m.color }}>
              <Sparkles size={9} /> {t("clf.confident", { n: Math.round((aiConfidence ?? 0) * 100) })}
            </span>
          )}
          {aiSummary && (
            <span className="text-[11px] italic" style={{ color: C.textMuted }}>
              — {aiSummary}
            </span>
          )}
        </div>
        <button
          onClick={() => classify(null)}
          disabled={loading !== null}
          className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-colors hover:bg-white/50 disabled:opacity-50"
          style={{ color: m.color }}
          title={t("clf.undo")}
        >
          {loading === "clear" ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />} {t("clf.undoShort")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: C.border }}>
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textDim }}>
        Outcome:
      </span>
      {(Object.keys(meta) as Classification[]).map(c => {
        const m = meta[c];
        const Icon = m.icon;
        const busy = loading === c;
        return (
          <button
            key={c}
            onClick={() => classify(c)}
            disabled={loading !== null}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-[opacity,transform,box-shadow,background-color,border-color] hover:opacity-85 disabled:opacity-50"
            style={{
              backgroundColor: m.bg,
              color: m.color,
              borderColor: m.border,
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
            {t(m.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
