"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThumbsUp, ThumbsDown, Clock, Loader2, Sparkles, X } from "lucide-react";
import { C } from "@/lib/design";

type Classification = "positive" | "negative" | "follow_up";

type Props = {
  callId: string;
  current: Classification | null;
  aiConfidence: number | null;
  aiSummary: string | null;
};

const meta: Record<Classification, { label: string; color: string; bg: string; border: string; icon: typeof ThumbsUp }> = {
  positive:  { label: "Positive",  color: "#16A34A", bg: "#DCFCE7", border: "#BBF7D0", icon: ThumbsUp },
  negative:  { label: "Negative",  color: C.red,    bg: C.redLight, border: `${C.red}30`, icon: ThumbsDown },
  follow_up: { label: "Follow-up", color: "#D97706", bg: "#FEF3C7", border: "#FDE68A", icon: Clock },
};

export default function CallClassifier({ callId, current, aiConfidence, aiSummary }: Props) {
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
            {isAI ? "AI classified as " : "Marked as "} {m.label}
          </span>
          {isAI && (
            <span className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: "rgba(255,255,255,0.7)", color: m.color }}>
              <Sparkles size={9} /> {Math.round((aiConfidence ?? 0) * 100)}% confident
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
          title="Undo classification"
        >
          {loading === "clear" ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />} Undo
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
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all hover:opacity-85 disabled:opacity-50"
            style={{
              backgroundColor: m.bg,
              color: m.color,
              borderColor: m.border,
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
