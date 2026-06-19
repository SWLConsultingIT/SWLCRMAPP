"use client";

// Reliability Q&A — chat widget that relays questions to the n8n workflow
// `SWL - CRM - Reliability Q&A` via /api/admin/reliability/qa. Conversation
// history is kept client-side and forwarded to n8n so follow-up questions
// have context. All LLM calls stay in n8n (LAW: never call LLM directly
// from Next.js).

import { useState, useRef, useEffect } from "react";
import { Bot, Send, Loader2, ChevronDown, User, Trash2, Copy, Check } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

type Message = { role: "user" | "assistant"; content: string; ts: number };

const SUGGESTION_KEYS = {
  general: Array.from({ length: 6 }, (_, i) => `rel.qa.suggest.general.${i}` as const),
  tenant:  Array.from({ length: 6 }, (_, i) => `rel.qa.suggest.tenant.${i}` as const),
};

export default function QABot({ bioId, bioName }: { bioId: string; bioName: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestionKeys = SUGGESTION_KEYS[bioId === "general" ? "general" : "tenant"];
  const suggestions = suggestionKeys.map(k => t(k));
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function copyMsg(content: string, idx: number) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(i => i === idx ? null : i), 1500);
    });
  }

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setQuestion("");
    setErr(null);
    const userMsg: Message = { role: "user", content: text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setBusy(true);
    try {
      const r = await fetch("/api/admin/reliability/qa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bioId,
          question: text,
          // last 6 turns (3 exchanges) so n8n has context for follow-ups
          conversationHistory: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(body.error ?? `HTTP ${r.status}`);
        setMessages(prev => prev.filter((_, i) => i !== prev.length - 1));
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: body.answer ?? t("rel.qa.no_answer"), ts: Date.now() }]);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setMessages(prev => prev.filter((_, i) => i !== prev.length - 1));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      borderLeftWidth: 4,
      borderLeftColor: gold,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      {/* ── Header ── */}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full px-7 py-5 flex items-center gap-3 text-left transition-colors"
        style={{
          background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 3%, ${C.card}) 100%)`,
          borderBottom: open ? `1px solid ${C.border}` : "none",
        }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
            color: "#1A1A2E",
            boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)`,
          }}>
          <Bot size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-bold leading-tight" style={{ color: C.textPrimary, letterSpacing: "-0.01em" }}>
            {t("rel.qa.title")}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{t("rel.qa.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasMessages && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
              {t(Math.ceil(messages.length / 2) === 1 ? "rel.qa.questions.count_one" : "rel.qa.questions.count_other", { n: String(Math.ceil(messages.length / 2)) })}
            </span>
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 28%, transparent)` }}>
            {bioName}
          </span>
        </div>
        <ChevronDown size={16} className="transition-transform shrink-0"
          style={{ color: C.textMuted, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} />
      </button>

      {open && (
        <div className="flex flex-col">
          {/* ── Suggestions (prominent when empty) ── */}
          {!hasMessages && (
            <div className="px-7 pt-5 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>
                {t("rel.qa.suggestions.label")}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} disabled={busy}
                    className="text-[12px] px-3.5 py-1.5 rounded-full border transition-all hover:opacity-80 active:scale-95"
                    style={{
                      borderColor: `color-mix(in srgb, ${gold} 35%, transparent)`,
                      color: gold,
                      backgroundColor: `color-mix(in srgb, ${gold} 6%, transparent)`,
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Chat thread ── */}
          {hasMessages && (
            <div ref={threadRef} className="overflow-y-auto px-7 py-5 space-y-4" style={{ maxHeight: 360 }}>
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1"
                    style={{
                      background: msg.role === "user"
                        ? `color-mix(in srgb, ${gold} 14%, transparent)`
                        : `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
                      border: msg.role === "user" ? `1px solid color-mix(in srgb, ${gold} 30%, transparent)` : "none",
                      color: msg.role === "user" ? gold : "#1A1A2E",
                    }}>
                    {msg.role === "user" ? <User size={11} /> : <Bot size={11} />}
                  </div>
                  <div className="max-w-[85%] flex flex-col">
                    <div className="rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed"
                      style={msg.role === "user" ? {
                        backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
                        color: C.textPrimary,
                        borderTopRightRadius: 4,
                      } : {
                        backgroundColor: C.bg,
                        border: `1px solid ${C.border}`,
                        color: C.textPrimary,
                        whiteSpace: "pre-wrap",
                        borderTopLeftRadius: 4,
                      }}>
                      {msg.content}
                    </div>
                    {msg.role === "assistant" && (
                      <button type="button"
                        onClick={() => copyMsg(msg.content, i)}
                        className="self-start mt-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors"
                        style={{ color: copiedIdx === i ? gold : C.textMuted, opacity: 0.55 }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={e => { if (copiedIdx !== i) e.currentTarget.style.opacity = "0.55"; }}>
                        {copiedIdx === i ? <Check size={10} /> : <Copy size={10} />}
                        <span>{copiedIdx === i ? "Copiado" : "Copiar"}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {busy && (
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1"
                    style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}>
                    <Bot size={11} />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3"
                    style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                    <div className="flex gap-1 items-center h-4">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce inline-block"
                          style={{ backgroundColor: gold, animationDelay: `${i * 160}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Error ── */}
          {err && (
            <div className="mx-7 mb-3 rounded-xl p-3 text-[12px]"
              style={{
                backgroundColor: "color-mix(in srgb, #DC2626 5%, transparent)",
                border: "1px solid color-mix(in srgb, #DC2626 25%, transparent)",
                color: "#DC2626",
              }}>
              {t("rel.qa.error", { err })}
            </div>
          )}

          {/* ── Quick chips (when chat is active) ── */}
          {hasMessages && (
            <div className="px-7 pt-3 pb-1 flex flex-wrap gap-1.5" style={{ borderTop: `1px solid ${C.border}` }}>
              {suggestions.slice(0, 4).map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} disabled={busy}
                  className="text-[11px] px-2.5 py-1 rounded-full border transition-all hover:opacity-80"
                  style={{
                    borderColor: `color-mix(in srgb, ${gold} 30%, transparent)`,
                    color: gold,
                    backgroundColor: `color-mix(in srgb, ${gold} 5%, transparent)`,
                  }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* ── Input row ── */}
          <div className="px-7 py-4 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); ask(); } }}
              placeholder={t("rel.qa.placeholder")}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] outline-none transition-shadow focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand,_#c9a83a)_20%,transparent)]"
              style={{
                backgroundColor: C.bg,
                border: `1px solid ${C.border}`,
                color: C.textPrimary,
              }}
            />
            {hasMessages && (
              <button type="button" onClick={() => { setMessages([]); setErr(null); }}
                disabled={busy}
                title={t("rel.qa.clear")}
                className="p-2.5 rounded-xl transition-opacity hover:opacity-70 disabled:opacity-30"
                style={{ border: `1px solid ${C.border}`, color: C.textMuted, backgroundColor: C.bg }}>
                <Trash2 size={14} />
              </button>
            )}
            <button type="button" onClick={() => ask()} disabled={busy || !question.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-40 hover:opacity-90"
              style={{
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
                color: "#1A1A2E",
                boxShadow: `0 4px 10px -3px color-mix(in srgb, ${gold} 38%, transparent)`,
              }}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {busy ? t("rel.qa.sending") : t("rel.qa.send")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
