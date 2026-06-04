"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, ThumbsUp, ThumbsDown, Calendar, PhoneOff, Check } from "lucide-react";
import { C } from "@/lib/design";

// Post-call outcome prompt. Lifted OUT of CallButton and driven by
// AircallPhoneProvider so it ALWAYS appears when a call ends — regardless of
// which page the seller is on or whether the originating CallButton is still
// mounted. Boss flagged 2026-06-04 that the outcome options "sometimes don't
// appear"; the old per-button effect only fired on the one CallButton whose
// leadId matched currentCall, which broke whenever that row had scrolled off
// or the seller had navigated away. The provider is always mounted and always
// knows the call's leadId, so this is the reliable home for it.
//
// Four mutually-exclusive outcomes → /api/leads/[id]/call-outcome:
//   Interested (book) / Not interested (close) / Bad timing (follow-up,
//   campaign keeps running) / Wrong number (skip call channel).
export default function CallOutcomePrompt({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const router = useRouter();
  const [pendingOutcome, setPendingOutcome] = useState<"interested" | "not_interested" | null>(null);
  const [note, setNote] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(outcome: "interested" | "not_interested" | "bad_timing" | "wrong_number", n?: string) {
    if (classifying) return;
    setClassifying(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/call-outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, note: n?.trim() || undefined }),
      });
      if (!r.ok) {
        const { error } = await r.json().catch(() => ({ error: "Failed" }));
        setErr(error || "Couldn't log outcome — try again.");
        return;
      }
      setSaved(true);
      router.refresh();
      window.setTimeout(onClose, 900);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setClassifying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl border shadow-2xl p-5 relative"
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: C.card,
          borderColor: `color-mix(in srgb, ${C.gold} 35%, ${C.border})`,
          boxShadow: "0 24px 60px -16px rgba(0,0,0,0.4)",
          width: 340,
          maxWidth: "calc(100vw - 3rem)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Skip for now"
          className="absolute top-3 right-3 rounded p-1 hover:bg-black/[0.04] transition-colors"
          style={{ color: C.textDim }}
        >
          <X size={14} />
        </button>

        {saved ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)` }}>
              <Check size={22} style={{ color: C.green }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>Outcome logged</p>
          </div>
        ) : pendingOutcome ? (
          (() => {
            const isPos = pendingOutcome === "interested";
            const accent = isPos ? C.green : C.red;
            return (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: accent, letterSpacing: "0.18em" }}>
                  {isPos ? "Interested" : "Not interested"}
                </p>
                <p className="text-sm font-semibold mb-3 pr-6" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
                  Add a note (optional)
                </p>
                <textarea
                  autoFocus
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={isPos ? "e.g. Keen — wants a demo next Tuesday, send pricing first." : "e.g. Using a competitor, revisit in Q4."}
                  rows={4}
                  className="w-full rounded-lg border px-3 py-2 text-[12px] resize-none outline-none focus:ring-2"
                  style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }}
                />
                {err && <p className="text-[11px] mt-2" style={{ color: C.red }}>{err}</p>}
                <div className="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    disabled={classifying}
                    onClick={() => { setPendingOutcome(null); setNote(""); }}
                    className="px-3 py-2 rounded-lg border text-[12px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ borderColor: C.border, color: C.textMuted }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={classifying}
                    onClick={() => submit(pendingOutcome, note)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: accent }}
                  >
                    {classifying ? <Loader2 size={13} className="animate-spin" /> : null}
                    {isPos ? "Save — Interested" : "Save — Not interested"}
                  </button>
                </div>
              </>
            );
          })()
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.gold, letterSpacing: "0.18em" }}>
              How did it go?
            </p>
            <p className="text-sm font-semibold mb-3 pr-6" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
              Log the call outcome
            </p>
            <p className="text-[11px] mb-4" style={{ color: C.textMuted }}>
              Interested / Not interested let you add a note — each option moves the lead through its flow correctly.
            </p>
            {err && <p className="text-[11px] mb-2" style={{ color: C.red }}>{err}</p>}
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "interested" as const,     label: "Interested",     desc: "Book meeting",       icon: ThumbsUp,   color: C.green,     bg: `color-mix(in srgb, ${C.green} 12%, transparent)`,  note: true },
                { v: "not_interested" as const, label: "Not interested", desc: "Close",              icon: ThumbsDown, color: C.red,       bg: `color-mix(in srgb, ${C.red} 12%, transparent)`,    note: true },
                { v: "bad_timing" as const,     label: "Bad timing",     desc: "Keep campaign going", icon: Calendar,  color: "#D97706",   bg: "color-mix(in srgb, #D97706 12%, transparent)",     note: false },
                { v: "wrong_number" as const,   label: "Wrong number",   desc: "Skip call channel",  icon: PhoneOff,   color: C.textMuted, bg: C.surface,                                          note: false },
              ]).map(opt => {
                const OptIcon = opt.icon;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    disabled={classifying}
                    onClick={() => {
                      if (opt.note) setPendingOutcome(opt.v as "interested" | "not_interested");
                      else submit(opt.v);
                    }}
                    className="flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border text-left transition-opacity hover:opacity-85 disabled:opacity-50"
                    style={{
                      backgroundColor: opt.bg,
                      color: opt.color,
                      borderColor: `color-mix(in srgb, ${opt.color} 30%, transparent)`,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <OptIcon size={13} />
                      <span className="text-[12px] font-semibold">{opt.label}</span>
                    </div>
                    <span className="text-[10px] opacity-80">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
