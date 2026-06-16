"use client";

// Reliability Q&A — a small client widget at the bottom of the page that
// posts a free-text question to /api/admin/reliability/qa, which relays
// to the n8n workflow `SWL - CRM - Reliability Q&A`. The workflow takes
// the grounded tenant summary + history bundle, asks Haiku, returns an
// answer. This file is the UI only — the backend does NOT call the LLM
// directly (LAW: all AI calls go through n8n workflows).

import { useState } from "react";
import { Bot, Send, Loader2 } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

export default function QABot({ bioId, bioName }: { bioId: string; bioName: string }) {
  const { t } = useLocale();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true); setAnswer(null); setErr(null);
    try {
      const r = await fetch("/api/admin/reliability/qa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bioId, question: question.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(body.error ?? `HTTP ${r.status}`);
      } else {
        setAnswer(body.answer ?? "(sin respuesta)");
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
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
      <header className="px-7 py-6 border-b flex items-center gap-3" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 3%, ${C.card}) 100%)`,
      }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
            color: "#1A1A2E",
            boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)`,
          }}>
          <Bot size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
            {t("rel.qa.title")}
          </h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{t("rel.qa.subtitle")}</p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 30%, transparent)` }}>
          {bioName}
        </span>
      </header>

      <div className="px-7 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); ask(); } }}
            placeholder={t("rel.qa.placeholder")}
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-xl text-[13.5px] outline-none transition-shadow focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand,_#c9a83a)_22%,transparent)]"
            style={{
              backgroundColor: C.bg,
              border: `1px solid ${C.border}`,
              color: C.textPrimary,
            }}
          />
          <button onClick={ask} disabled={busy || !question.trim()}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[12.5px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-50 hover:opacity-90"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
              color: "#1A1A2E",
              boxShadow: `0 4px 10px -3px color-mix(in srgb, ${gold} 40%, transparent)`,
            }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? t("rel.qa.sending") : t("rel.qa.send")}
          </button>
        </div>

        {answer && (
          <div className="rounded-xl p-5 leading-relaxed"
            style={{
              backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)`,
              border: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
              color: C.textPrimary,
              fontSize: 13.5,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}>
            {answer}
          </div>
        )}
        {err && (
          <div className="rounded-xl p-4 text-[12.5px]"
            style={{
              backgroundColor: "color-mix(in srgb, #DC2626 5%, transparent)",
              border: "1px solid color-mix(in srgb, #DC2626 28%, transparent)",
              color: "#DC2626",
            }}>
            {t("rel.qa.error", { err })}
          </div>
        )}
      </div>
    </section>
  );
}
