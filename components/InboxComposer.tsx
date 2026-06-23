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

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

export default function InboxComposer({
  leadId,
  channel,
  onSent,
  compact = false,
  autoSuggest = false,
  defaultSubject = null,
}: {
  leadId: string;
  channel?: string | null;
  onSent?: () => void;
  compact?: boolean;
  /** When true, auto-generate a draft as soon as this lead's thread opens
   *  (used for the Inbox "needs review" questions so the seller never stares
   *  at a blank box). The seller still edits + sends manually. */
  autoSuggest?: boolean;
  /** Prefill for the email Subject line (e.g. "Re: <original subject>"). Only
   *  used when channel === "email". */
  defaultSubject?: string | null;
}) {
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [lang, setLang] = useState("auto");
  const [suggesting, setSuggesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelLabel =
    channel === "email" ? "Email" : channel === "linkedin" ? "LinkedIn" : null;
  const isEmail = channel === "email";

  const suggest = useCallback(async (langOverride?: string) => {
    setError(null);
    setSuggesting(true);
    try {
      const chosen = langOverride ?? lang;
      const r = await fetch(`/api/inbox/suggest/${leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chosen && chosen !== "auto" ? { lang: chosen } : {}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data?.error || "No se pudo generar el borrador"); return; }
      if (data?.draft) setText(data.draft);
    } catch {
      setError("No se pudo generar el borrador");
    } finally {
      setSuggesting(false);
    }
  }, [leadId, lang]);

  // Reset on lead change so a draft never leaks across leads. When autoSuggest
  // is on, kick off a fresh draft for the newly-opened question.
  useEffect(() => {
    setText("");
    setSubject(defaultSubject ?? "");
    setError(null);
    if (autoSuggest && leadId) void suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, autoSuggest, defaultSubject]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    setSending(true);
    try {
      const r = await fetch(`/api/inbox/reply/${leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: body,
          ...(channel ? { channel } : {}),
          ...(isEmail && subject.trim() ? { subject: subject.trim() } : {}),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data?.error || "No se pudo enviar"); return; }
      setText("");
      // Soft delivery warning (email path can't always confirm) — the message
      // WAS sent, but surface the caution so the seller can double-check.
      if (data?.warning) setError(data.warning);
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
      {isEmail && (
        <div className="flex items-center gap-2 px-1 pb-1.5 mb-1.5 border-b" style={{ borderColor: C.border }}>
          <span className="text-[10px] uppercase tracking-wide font-semibold shrink-0" style={{ color: C.textDim }}>Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Re: …"
            disabled={sending}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: C.textPrimary }}
          />
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          isEmail
            ? "Cuerpo del email…"
            : channelLabel
            ? `Responder por ${channelLabel}…`
            : "Escribí tu respuesta…"
        }
        rows={compact ? 4 : 6}
        disabled={sending}
        className="w-full resize-y bg-transparent text-sm outline-none px-1 py-1 leading-relaxed"
        style={{ color: C.textPrimary, minHeight: compact ? 76 : 120 }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
        }}
      />
      {error && (
        <p className="text-[11px] px-1 mb-1" style={{ color: "#dc2626" }}>{error}</p>
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => suggest()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
            style={{ color: "var(--brand, #c9a83a)", backgroundColor: `color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)` }}
          >
            {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Sugerir respuesta
          </button>
          {/* Language picker — forces the draft language. "auto" detects from the
              conversation (default). Switching while a draft exists regenerates it. */}
          <select
            value={lang}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              setLang(v);
              if (text.trim()) void suggest(v); // regenerate the existing draft in the new language
            }}
            title="Idioma de la respuesta"
            className="text-xs font-medium px-1.5 py-1.5 rounded-lg outline-none cursor-pointer disabled:opacity-50"
            style={{ color: C.textBody, backgroundColor: C.surface, border: `1px solid ${C.border}` }}
          >
            <option value="auto">🌐 Auto</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="it">Italiano</option>
            <option value="pt">Português</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="nl">Nederlands</option>
          </select>
        </div>
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
