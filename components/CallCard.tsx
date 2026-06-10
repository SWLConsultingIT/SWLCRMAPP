"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, Trash2, Sparkles, Loader2, RotateCw, AlertCircle, X } from "lucide-react";
import { C } from "@/lib/design";
import CallClassifier from "@/components/CallClassifier";
import CallCoachAnalysis from "@/components/CallCoachAnalysis";
import CallSummary from "@/components/CallSummary";

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
  summary?: string | null;
  summary_generated_at?: string | null;
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

// Normalize a phone for comparison — digits only (tolerates spaces, +, dashes,
// parentheses) so "+1 202-643-9822" matches "12026439822".
function digits(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "");
}

export default function CallCard({ call, compact = false, personalPhone, companyPhone }: {
  call: CallRecord;
  compact?: boolean;
  /** The lead's two numbers, so the card can show WHICH was dialed
   * (boss 2026-06-10: "a qué teléfono fue la llamada, privado o público"). */
  personalPhone?: string | null;
  companyPhone?: string | null;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // Inline error replaces the native alert() popups — they were ugly
  // and got in the way of the auth bar at the top of the page.
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showRetranscribeConfirm, setShowRetranscribeConfirm] = useState(false);
  const mins = call.duration ? Math.floor(call.duration / 60) : null;
  const secs = call.duration ? call.duration % 60 : null;
  const durLabel = mins !== null ? `${mins}m ${secs}s` : null;
  const sc = call.status ?? "initiated";

  async function handleDelete() {
    if (deleting) return;
    if (!confirm("Delete this call from the lead history? This can't be undone (a fresh Aircall sync will repull if it still exists upstream).")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/calls/${call.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body.error ?? `Couldn't delete (${res.status})`);
        setDeleting(false);
        return;
      }
      router.refresh();
    } catch (e: any) {
      setDeleteError(e?.message ?? "Network error");
      setDeleting(false);
    }
  }

  async function handleTranscribe(force = false) {
    if (transcribing) return;
    if (force) {
      // Surface the cost-confirm as an inline state, not a native confirm() —
      // those popups land at the top of the browser viewport, way above the
      // call card, and look unprofessional next to the auth bar.
      if (!showRetranscribeConfirm) {
        setShowRetranscribeConfirm(true);
        return;
      }
      setShowRetranscribeConfirm(false);
    }
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const res = await fetch(`/api/aircall/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: call.id, force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTranscribeError(body.error ?? `Couldn't transcribe (${res.status})`);
        setTranscribing(false);
        return;
      }
      router.refresh();
    } catch (e: any) {
      setTranscribeError(e?.message ?? "Network error");
      setTranscribing(false);
    }
  }

  // Show a player whenever the call might have a recording — not just when
  // recording_url is populated. Aircall sometimes fires call.ended before the
  // recording is ready, leaving recording_url null even though the MP3 exists.
  // The /play endpoint fetches a fresh URL from Aircall API and archives it
  // on first access, so the player will work even with recording_url=null as
  // long as aircall_call_id is set and the call was answered.
  const hasRecording = !!call.recording_url
    || (call.status === "answered" && (call.duration ?? 0) > 0 && !!call.aircall_call_id);
  const canTranscribe = hasRecording && !call.transcript && !!call.aircall_call_id;
  const canRetranscribe = hasRecording && !!call.transcript && !!call.aircall_call_id;

  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
            <Phone size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-1.5" style={{ color: C.textPrimary }}>
              {call.phone_number ?? "—"}
              {(() => {
                const d = digits(call.phone_number);
                const which = d && digits(personalPhone) === d ? "Personal"
                  : d && digits(companyPhone) === d ? "Company"
                  : null;
                if (!which) return null;
                const isPersonal = which === "Personal";
                return (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: isPersonal ? "color-mix(in srgb, #7C3AED 14%, transparent)" : C.surface, color: isPersonal ? "#7C3AED" : C.textMuted }}
                    title={isPersonal ? "Dialed the lead's personal number" : "Dialed the lead's company number"}>
                    {which}
                  </span>
                );
              })()}
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
          {!call.classification && (
            <span className="text-xs font-bold px-2.5 py-0.5 rounded animate-pulse"
              style={{ backgroundColor: C.redLight, color: C.red }}>
              Needs review
            </span>
          )}
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
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textDim }}>Transcript</p>
            {canRetranscribe && !showRetranscribeConfirm && (
              <button
                type="button"
                onClick={() => handleTranscribe(true)}
                disabled={transcribing}
                title="Re-transcribe with the newer model (fixes bad transcripts; costs ~$0.003)"
                className="p-1 rounded inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                style={{ color: C.textMuted }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#b79832"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.textMuted; }}
              >
                {transcribing
                  ? <Loader2 size={11} className="animate-spin" />
                  : <RotateCw size={11} />}
                <span className="text-[10px] font-medium">Re-transcribe</span>
              </button>
            )}
          </div>
          <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{call.transcript}</p>
          {showRetranscribeConfirm && (
            <div className="mt-3 p-2.5 rounded border flex items-center justify-between gap-2"
              style={{ backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }}>
              <p className="text-[11px]" style={{ color: "#92400E" }}>
                Replace this transcript? Cost ~$0.003.
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setShowRetranscribeConfirm(false)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md"
                  style={{ color: "#92400E" }}>
                  Cancel
                </button>
                <button
                  onClick={() => handleTranscribe(true)}
                  disabled={transcribing}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-50"
                  style={{ backgroundColor: "#D97706", color: "#fff" }}>
                  {transcribing ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={10} />}
                  Confirm
                </button>
              </div>
            </div>
          )}
          {transcribeError && (
            <div className="mt-3 p-2.5 rounded border flex items-start justify-between gap-2"
              style={{ backgroundColor: C.redLight, borderColor: `${C.red}40` }}>
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: C.red }} />
                <p className="text-[11px] leading-relaxed" style={{ color: C.red }}>
                  Couldn't transcribe: {transcribeError.length > 200 ? transcribeError.slice(0, 200) + "…" : transcribeError}
                </p>
              </div>
              <button onClick={() => setTranscribeError(null)} className="shrink-0 p-0.5" style={{ color: C.red }}>
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}
      {call.notes && (
        <div className="rounded-lg p-3 mt-2 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
          <p className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: C.textDim }}>Notes</p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{call.notes}</p>
        </div>
      )}
      {hasRecording && (
        <div className="mt-3">
          <audio controls preload="none" src={`/api/aircall/calls/${call.id}/play`} className="w-full h-8" />
        </div>
      )}
      {canTranscribe && (
        <div className="mt-3 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => handleTranscribe(false)}
            disabled={transcribing}
            className="text-xs font-medium px-3 py-1.5 rounded-md border inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
            style={{ color: C.textBody, borderColor: C.border, backgroundColor: C.surface }}
            title="Transcribe with gpt-4o-mini-transcribe (fetches a fresh recording URL from Aircall)"
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
          {transcribeError && (
            <div className="w-full p-2.5 rounded border flex items-start justify-between gap-2"
              style={{ backgroundColor: C.redLight, borderColor: `${C.red}40` }}>
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: C.red }} />
                <p className="text-[11px] leading-relaxed" style={{ color: C.red }}>
                  Couldn't transcribe: {transcribeError.length > 200 ? transcribeError.slice(0, 200) + "…" : transcribeError}
                </p>
              </div>
              <button onClick={() => setTranscribeError(null)} className="shrink-0 p-0.5" style={{ color: C.red }}>
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}
      {deleteError && (
        <div className="mt-3 p-2.5 rounded border flex items-start justify-between gap-2"
          style={{ backgroundColor: C.redLight, borderColor: `${C.red}40` }}>
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: C.red }} />
            <p className="text-[11px] leading-relaxed" style={{ color: C.red }}>
              Couldn't delete: {deleteError.length > 200 ? deleteError.slice(0, 200) + "…" : deleteError}
            </p>
          </div>
          <button onClick={() => setDeleteError(null)} className="shrink-0 p-0.5" style={{ color: C.red }}>
            <X size={12} />
          </button>
        </div>
      )}
      {!compact && (
        <CallSummary
          callId={call.id}
          hasTranscript={!!call.transcript && call.transcript.trim().length >= 10}
          initialSummary={call.summary ?? null}
          initialGeneratedAt={call.summary_generated_at ?? null}
        />
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
