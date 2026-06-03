"use client";

// Reply composer for the inbox + lead-detail chat. A textarea with two actions:
//   ✨ Sugerir respuesta → GETs an AI draft grounded in the tenant's company
//      bio + the lead's ICP pains/solutions (POST /api/inbox/suggest) and drops
//      it into the box for the seller to edit.
//   Enviar → sends out the lead's channel (LinkedIn via Unipile / email via
//      Instantly) through POST /api/inbox/reply and logs it to the thread.
//
// Reply-only by design (Fran 2026-06-02): the seller always reviews/edits
// before anything leaves. Used in InboxView's right pane and LeadChatThread.

import { useState } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

export default function InboxComposer({
  leadId,
  channel,
  onSent,
  compact = false,
}: {
  leadId: string;
  channel?: string | null;
  onSent?: () => void;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelLabel =
    channel === "email" ? "Email" : channel === "linkedin" ? "LinkedIn" : null;

  async function suggest() {
    setError(null);
    setSuggesting(true);
    try {
      const r = await fetch(`/api/inbox/suggest/${leadId}`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data?.error || "No se pudo generar el borrador"); return; }
      if (data?.draft) setText(data.draft);
    } catch {
      setError("No se pudo generar el borrador");
    } finally {
      setSuggesting(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    setSending(true);
    try {
      const r = await fetch(`/api/inbox/reply/${leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channel ? { text: body, channel } : { text: body }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data?.error || "No se pudo enviar"); return; }
      setText("");
      onSent?.();
    } catch {
      setError("No se pudo enviar");
    } finally {
      setSending(false);
    }
  }

  const busy = suggesting || sending;

  return (
    <div
      className="rounded-2xl border p-2.5"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          channelLabel
            ? `Responder por ${channelLabel}…`
            : "Escribí tu respuesta…"
        }
        rows={compact ? 2 : 3}
        disabled={sending}
        className="w-full resize-none bg-transparent text-sm outline-none px-1 py-1 leading-relaxed"
        style={{ color: C.textPrimary }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
        }}
      />
      {error && (
        <p className="text-[11px] px-1 mb-1" style={{ color: "#dc2626" }}>{error}</p>
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        <button
          type="button"
          onClick={suggest}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
          style={{ color: "var(--brand, #c9a83a)", backgroundColor: `color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)` }}
        >
          {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Sugerir respuesta
        </button>
        <div className="flex items-center gap-2">
          {channelLabel && (
            <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: C.textDim }}>
              {channelLabel}
            </span>
          )}
          <button
            type="button"
            onClick={send}
            disabled={busy || !text.trim()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-40"
            style={{ color: "#fff", backgroundColor: "var(--brand, #c9a83a)" }}
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
