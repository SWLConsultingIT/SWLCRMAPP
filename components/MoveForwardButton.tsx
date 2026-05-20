"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SkipForward, Send, AlertTriangle, X, Share2, Mail, Phone } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2" },
  email:    { icon: Mail,   color: "#7C3AED" },
  call:     { icon: Phone,  color: "#F97316" },
};

const channelNoun: Record<string, string> = {
  linkedin: "LinkedIn message",
  email:    "email",
  call:     "call",
};

const sendLabel: Record<string, string> = {
  linkedin: "Send LinkedIn message now",
  email:    "Send email now",
  call:     "Make the call now",
};

const skipLabel: Record<string, string> = {
  linkedin: "Skip LinkedIn message",
  email:    "Skip email",
  call:     "Skip call",
};

export default function MoveForwardButton({
  campaignId,
  currentStep,
  totalSteps,
  nextChannel = "linkedin",
  size = "md",
}: {
  campaignId: string;
  currentStep: number;
  totalSteps: number;
  nextChannel?: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Nothing to advance to
  if (currentStep >= totalSteps) return null;

  const nextStep = currentStep + 1;
  const ch = nextChannel in channelMeta ? nextChannel : "linkedin";
  const meta = channelMeta[ch];
  const ChIcon = meta.icon;
  const noun = channelNoun[ch];

  async function commit(action: "send" | "skip") {
    setBusy(true);
    try {
      const r = await fetch(`/api/campaigns/${campaignId}/step`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStep: nextStep, action }),
      });
      if (!r.ok) throw new Error("failed");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Advance to Step ${nextStep}`}
        className="flex items-center gap-1 rounded-md font-semibold hover:opacity-80 transition-opacity"
        style={{
          backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`,
          color: gold,
          border: `1px solid color-mix(in srgb, ${gold} 25%, transparent)`,
          padding: size === "sm" ? "2px 7px" : "6px 14px",
          fontSize: size === "sm" ? 11 : 12,
        }}
      >
        <SkipForward size={size === "sm" ? 10 : 13} />
        {size === "md" && <span>Move Forward</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => { if (!busy) setOpen(false); }}
        >
          <div
            className="rounded-2xl border w-full max-w-md overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between"
              style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${meta.color}15` }}>
                  <ChIcon size={15} style={{ color: meta.color }} />
                </div>
                <div>
                  <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>
                    Advance to Step {nextStep}
                  </h2>
                  <p className="text-xs" style={{ color: C.textMuted }}>
                    Decide what happens with the pending {noun}.
                  </p>
                </div>
              </div>
              <button onClick={() => { if (!busy) setOpen(false); }} className="p-1.5 rounded-lg hover:bg-black/5">
                <X size={14} style={{ color: C.textMuted }} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg border p-3" style={{ borderColor: "#FCD34D", backgroundColor: "#FFFBEB" }}>
                <div className="flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "#D97706" }} />
                  <p className="text-[11px] leading-relaxed" style={{ color: "#92400E" }}>
                    <strong>Send</strong> delivers the {noun} on the next orchestrator cycle (up to 1 h).
                    <br />
                    <strong>Skip</strong> advances without sending — the {noun} is never delivered.
                  </p>
                </div>
              </div>

              <button
                onClick={() => commit("send")}
                disabled={busy}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border hover:shadow-sm disabled:opacity-50 transition-shadow"
                style={{ borderColor: `${meta.color}50`, backgroundColor: `${meta.color}08`, color: meta.color }}
              >
                <span className="flex items-center gap-2.5">
                  <Send size={14} />
                  <span className="text-sm font-semibold">{sendLabel[ch]}</span>
                </span>
                <span className="text-[10px] font-medium opacity-70">Lead receives it</span>
              </button>

              <button
                onClick={() => commit("skip")}
                disabled={busy}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border hover:shadow-sm disabled:opacity-50 transition-shadow"
                style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textBody }}
              >
                <span className="flex items-center gap-2.5">
                  <SkipForward size={14} style={{ color: C.textMuted }} />
                  <span className="text-sm font-semibold">{skipLabel[ch]}</span>
                </span>
                <span className="text-[10px] font-medium" style={{ color: C.textDim }}>Lead gets nothing</span>
              </button>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t flex justify-end"
              style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <button
                onClick={() => { if (!busy) setOpen(false); }}
                disabled={busy}
                className="text-xs font-semibold px-3 py-1.5 rounded hover:opacity-80"
                style={{ color: C.textMuted }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
