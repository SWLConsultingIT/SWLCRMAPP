"use client";

import { useState } from "react";
import { CheckCircle, Calendar, FileText, ChevronRight, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

const STAGES = [
  { id: "response_received", label: "Response Received", color: "#2563EB" },
  { id: "meeting_scheduled", label: "Meeting Scheduled", color: "#7C3AED" },
  { id: "proposal_sent",     label: "Proposal Sent",     color: "#D97706" },
  { id: "negotiating",       label: "Negotiating",       color: "#EA580C" },
  { id: "won",               label: "Won",               color: "#059669" },
];

type Props = {
  leadId: string;
  initialStage?: string | null;
  initialNotes?: string | null;
  initialNextAction?: string | null;
};

export default function OpportunityStagePanel({ leadId, initialStage, initialNotes, initialNextAction }: Props) {
  const [stage, setStage]           = useState(initialStage ?? "response_received");
  const [notes, setNotes]           = useState(initialNotes ?? "");
  const [nextAction, setNextAction] = useState(initialNextAction ?? "");
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState("");

  async function save(patch: Record<string, string>) {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error?.includes("column") ? "Run DB migration first (see console)" : "Failed to save");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  const currentStage = STAGES.find(s => s.id === stage) ?? STAGES[0];

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2">
          <CheckCircle size={13} style={{ color: C.green }} />
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Pipeline Stage</h3>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 size={12} className="animate-spin" style={{ color: C.textDim }} />}
          {saved && <span className="text-[10px] font-medium" style={{ color: C.green }}>Saved</span>}
          {error && <span className="text-[10px] font-medium" style={{ color: C.red }}>{error}</span>}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Stage selector */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: C.textDim }}>Stage</p>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s, i) => {
              const isActive = stage === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => { setStage(s.id); save({ opportunity_stage: s.id }); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                  style={{
                    backgroundColor: isActive ? `${s.color}15` : "#F3F4F6",
                    color:           isActive ? s.color : C.textMuted,
                    border:          `1px solid ${isActive ? s.color + "40" : "transparent"}`,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isActive ? s.color : C.textDim }} />
                  {i + 1}. {s.label}
                </button>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#E5E7EB" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${((STAGES.findIndex(s => s.id === stage) + 1) / STAGES.length) * 100}%`,
                backgroundColor: currentStage.color,
              }}
            />
          </div>
          <p className="text-[10px] mt-1.5 text-right" style={{ color: C.textDim }}>
            Step {STAGES.findIndex(s => s.id === stage) + 1} of {STAGES.length}
          </p>
        </div>

        {/* Next action */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: C.textDim }}>
            <Calendar size={10} /> Next Action
          </label>
          <input
            value={nextAction}
            onChange={e => setNextAction(e.target.value)}
            onBlur={() => save({ opportunity_next_action: nextAction })}
            placeholder="e.g. Send proposal by Friday, Follow up next week…"
            className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-all"
            style={{
              backgroundColor: C.cardHov,
              borderColor: C.border,
              color: C.textBody,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = currentStage.color + "60"; }}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: C.textDim }}>
            <FileText size={10} /> Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => save({ opportunity_notes: notes })}
            placeholder="Add notes about this opportunity…"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-all resize-none"
            style={{
              backgroundColor: C.cardHov,
              borderColor: C.border,
              color: C.textBody,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = currentStage.color + "60"; }}
          />
        </div>
      </div>
    </div>
  );
}
