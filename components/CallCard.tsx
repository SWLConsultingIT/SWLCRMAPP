"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, Trash2, Sparkles, Loader2 } from "lucide-react";
import { C } from "@/lib/design";
import CallClassifier from "@/components/CallClassifier";
import CallCoachAnalysis from "@/components/CallCoachAnalysis";

export type CallRecord = {
  id: string;
  aircall_call_id?: string | null;
  direction: "inbound" | "outbound" | null;
  status: "answered" | "initiated" | "missed" | "voicemail" | null;
  duration: number | null;
  phone_number: string | null;
  recording_url: string | null;
  transcript: string | null;
  notes: string | null;
  started_at: string | null;
  ended_at?: string | null;
  classification: string | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  coach_analysis?: string | null;
  coach_score?: number | null;
  coach_generated_at?: string | null;
  coach_model?: string | null;
};

const statusColor: Record<string, string> = {
  answered:  C.green,
  initiated: C.orange,
  missed:    C.red,
  voicemail: C.textMuted,
};
const statusBg: Record<string, string> = {
  answered:  C.greenLight,
  initiated: C.orangeLight,
  missed:    C.redLight,
  voicemail: C.surface,
};

export default function CallCard({ call, compact = false }: { call: CallRecord; compact?: boolean }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mins = call.duration ? Math.floor(call.duration / 60) : null;
  const secs = call.duration ? call.duration % 60 : null;
  const durLabel = mins !== null ? `${mins}m ${secs}s` : null;
  const sc = call.status ?? "initiated";

  async function handleDelete() {
    if (deleting) return;
    if (!confirm("Delete this call from the lead history? This can't be undone (a fresh Aircall sync will repull if it still exists upstream).")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/calls/${call.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Couldn't delete: ${body.error ?? res.statusText}`);
        setDeleting(false);
        return;
      }
      router.refresh();
    } catch (e: any) {
      alert(`Couldn't delete: ${e?.message ?? "network error"}`);
      setDeleting(false);
    }
  }

  async function handleTranscribe() {
    if (transcribing) return;
    setTranscribing(true);
    try {
      const res = await fetch(`/api/aircall/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: call.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Couldn't transcribe: ${body.error ?? res.statusText}`);
        setTranscribing(false);
        return;
      }
      router.refresh();
    } catch (e: any) {
      alert(`Couldn't transcribe: ${e?.message ?? "network error"}`);
      setTranscribing(false);
    }
  }

  const canTranscribe = !!call.recording_url && !call.transcript && !!call.aircall_call_id;

  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
            <Phone size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>
              {call.phone_number ?? "—"}
            </p>
            <p className="text-xs" style={{ color: C.textMuted }}>
              {call.direction === "outbound" ? "Outbound" : "Inbound"} call
              {call.started_at && <> · {new Date(call.started_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {durLabel && (
            <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {durLabel}
            </span>
          )}
          <span className="text-xs font-bold px-2.5 py-0.5 rounded capitalize"
            style={{ backgroundColor: statusBg[sc] ?? C.surface, color: statusColor[sc] ?? C.textMuted }}>
            {sc}
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Delete call"
            title="Delete call"
            className="ml-1 p-1.5 rounded transition-colors disabled:opacity-50"
            style={{ color: C.textMuted, backgroundColor: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.red; e.currentTarget.style.backgroundColor = C.redLight; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.textMuted; e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {call.transcript && (
        <div className="rounded-lg p-3 mt-2" style={{ backgroundColor: C.bg }}>
          <p className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: C.textDim }}>Transcript</p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{call.transcript}</p>
        </div>
      )}
      {call.notes && (
        <div className="rounded-lg p-3 mt-2 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
          <p className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: C.textDim }}>Notes</p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{call.notes}</p>
        </div>
      )}
      {call.recording_url && (
        <div className="mt-3">
          <audio controls src={call.recording_url} className="w-full h-8" />
        </div>
      )}
      {canTranscribe && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleTranscribe}
            disabled={transcribing}
            className="text-xs font-medium px-3 py-1.5 rounded-md border inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
            style={{ color: C.textBody, borderColor: C.border, backgroundColor: C.surface }}
            title="Transcribe with Whisper (uses fresh recording URL from Aircall)"
          >
            {transcribing ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Transcribing…
              </>
            ) : (
              <>
                <Sparkles size={12} /> Transcribe
              </>
            )}
          </button>
        </div>
      )}
      {!compact && (
        <CallClassifier
          callId={call.id}
          current={(call.classification as "positive" | "negative" | "follow_up" | null) ?? null}
          aiConfidence={call.ai_confidence ?? null}
          aiSummary={call.ai_summary ?? null}
        />
      )}
      {!compact && (
        <CallCoachAnalysis
          callId={call.id}
          hasTranscript={!!call.transcript && call.transcript.trim().length >= 20}
          initial={{
            analysis: call.coach_analysis ?? null,
            score: call.coach_score ?? null,
            generatedAt: call.coach_generated_at ?? null,
            model: call.coach_model ?? null,
          }}
        />
      )}
    </div>
  );
}
