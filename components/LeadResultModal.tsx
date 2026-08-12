"use client";

// Lead-detail "Mark result" — a calm Positive / Negative marker (replaces the
// call-framed Log-outcome on the lead hero). Marking uses the lead-level
// call-outcome endpoint (positive -> qualified + stop flow, negative ->
// closed_lost + stop flow), which sends NOTHING to the prospect. Sending the
// flow's auto-reply is an EXPLICIT opt-in: toggle it on and the message —
// prefilled from the flow's authored reply, fully editable — goes out the
// lead's channel via /api/inbox/reply. Default = no message is sent.
// Self-portals to <body> so it centers over the viewport (the hero card has a
// CSS transform that would otherwise trap a fixed overlay).

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ThumbsUp, ThumbsDown, X, Check, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

type Outcome = "positive" | "negative";

export default function LeadResultModal({ leadId, autoReplies, onClose }: {
  leadId: string;
  autoReplies: { positive?: string; negative?: string } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [sendReply, setSendReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);

  function pick(o: Outcome) {
    setOutcome(o);
    setReplyText(((o === "positive" ? autoReplies?.positive : autoReplies?.negative) ?? "").trim());
  }

  async function submit() {
    if (!outcome || busy) return;
    setBusy(true); setErr(null);
    try {
      // 1) Mark the lead (lead-level) — sends nothing to the prospect.
      const r = await fetch(`/api/leads/${leadId}/call-outcome`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: outcome === "positive" ? "interested" : "not_interested", note: note.trim() || undefined }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error ?? "No se pudo marcar el lead"); setBusy(false); return; }
      // 2) Optional, opt-in: send the (edited) reply out the lead's channel.
      if (sendReply && replyText.trim()) {
        const s = await fetch(`/api/inbox/reply/${leadId}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: replyText.trim() }),
        });
        if (!s.ok) { setErr("El lead se marcó, pero el envío de la respuesta falló."); setBusy(false); return; }
      }
      setSaved(true);
      router.refresh();
      window.setTimeout(onClose, 900);
    } catch { setErr("Error de red"); setBusy(false); }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="rounded-2xl border shadow-2xl p-5 relative w-[360px] max-w-[calc(100vw-2rem)]"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: C.card, borderColor: `color-mix(in srgb, ${C.gold} 30%, ${C.border})`, boxShadow: "0 24px 60px -16px rgba(0,0,0,0.4)" }}>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute top-3 right-3 rounded p-1 hover:bg-black/[0.04]" style={{ color: C.textDim }}><X size={14} /></button>

        {saved ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)` }}><Check size={22} style={{ color: C.green }} /></div>
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>Resultado guardado</p>
          </div>
        ) : !outcome ? (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: C.textMuted }}>Resultado del lead</p>
            <p className="text-sm font-semibold mb-3" style={{ color: C.textPrimary }}>¿Cómo resultó?</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => pick("positive")} className="rounded-xl border p-3 text-left transition-colors hover:opacity-90"
                style={{ borderColor: `color-mix(in srgb, ${C.green} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${C.green} 8%, transparent)` }}>
                <ThumbsUp size={16} style={{ color: C.green }} />
                <p className="text-sm font-semibold mt-1.5" style={{ color: C.green }}>Positive</p>
                <p className="text-[11px]" style={{ color: C.textMuted }}>Avanza a oportunidad</p>
              </button>
              <button onClick={() => pick("negative")} className="rounded-xl border p-3 text-left transition-colors hover:opacity-90"
                style={{ borderColor: `color-mix(in srgb, ${C.red} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${C.red} 8%, transparent)` }}>
                <ThumbsDown size={16} style={{ color: C.red }} />
                <p className="text-sm font-semibold mt-1.5" style={{ color: C.red }}>Negative</p>
                <p className="text-[11px]" style={{ color: C.textMuted }}>Cierra el lead</p>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: outcome === "positive" ? C.green : C.red }}>
              Marcar {outcome === "positive" ? "Positive" : "Negative"}
            </p>
            <p className="text-xs mb-3" style={{ color: C.textMuted }}>
              {outcome === "positive" ? "El lead pasa a oportunidad y se frena el flow." : "El lead se cierra (closed_lost) y se frena el flow."}
            </p>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Nota (interna, opcional)"
              className="w-full rounded-lg border px-3 py-2 text-[12px] resize-none outline-none focus:ring-2" style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }} />

            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input type="checkbox" checked={sendReply} onChange={e => setSendReply(e.target.checked)} style={{ accentColor: C.gold, width: 15, height: 15 }} />
              <span className="text-[12px] font-semibold" style={{ color: C.textBody }}>Enviar respuesta al prospecto</span>
            </label>
            {sendReply ? (
              <>
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={4} placeholder="Escribí la respuesta a enviar…"
                  className="w-full rounded-lg border px-3 py-2 text-[12px] resize-none outline-none focus:ring-2 mt-2" style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }} />
                <p className="text-[10px] mt-1" style={{ color: C.textDim }}>Se envía por el canal del lead (LinkedIn / email). Editá el texto libremente.</p>
              </>
            ) : (
              <p className="text-[10px] mt-1.5" style={{ color: C.textDim }}>Por default NO se envía ningún mensaje al prospecto.</p>
            )}

            {err && <p className="text-[11px] mt-2" style={{ color: C.red }}>{err}</p>}
            <div className="flex items-center gap-2 mt-3">
              <button type="button" disabled={busy} onClick={() => setOutcome(null)} className="px-3 py-2 rounded-lg border text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: C.border, color: C.textMuted }}>Atrás</button>
              <button type="button" disabled={busy || (sendReply && !replyText.trim())} onClick={submit}
                className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ backgroundColor: outcome === "positive" ? C.green : C.red, color: "#fff" }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                {sendReply ? "Marcar y enviar" : "Marcar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
