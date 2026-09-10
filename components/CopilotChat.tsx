"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Brain, Loader2, Plus } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";
type Turn = { role: "user" | "assistant"; text: string };
const STORAGE_KEY = "copilot.turns";

const SUGGESTIONS = [
  "What are the most common objections across my prospects?",
  "What's working in our openers — which got positive replies?",
  "Compare reactions by industry.",
  "Which prospects went positive and why?",
];

// Cross-prospect Copilot chat — queries the team's interaction memory across
// ALL prospects (replies + call outcomes) via /api/copilot/ask.
//
// The conversation is PERSISTED in localStorage, so closing the floating panel
// (which unmounts this component) no longer wipes it — it comes back on reopen.
// "Nueva conversación" is the explicit way to clear it.
//
// `embedded` = rendered inside the floating panel (which already has its own
// header) → we drop our internal header + card chrome to avoid a header-in-a-
// header and a box-in-a-box. The standalone /copilot page keeps the full card.
export default function CopilotChat({ initialQuestion, embedded = false }: { initialQuestion?: string; embedded?: boolean }) {
  const { t } = useLocale();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);

  // Load persisted conversation once (client-only → no SSR hydration mismatch).
  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setTurns(JSON.parse(raw)); } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  // Persist after hydration (so we never clobber the stored turns with []).
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(turns)); } catch { /* ignore */ }
  }, [turns, hydrated]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setError(null);
    setInput("");
    const nextTurns: Turn[] = [...turns, { role: "user", text: question }];
    setTurns(nextTurns);
    setLoading(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
    try {
      const res = await fetch(`/api/copilot/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: turns.slice(-6) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setTurns([...nextTurns, { role: "assistant", text: data.answer }]);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      setTurns((t) => t.slice(0, -1));
      setInput(question);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
    }
  }

  function clearConversation() {
    if (loading) return;
    setTurns([]);
    setError(null);
    setInput("");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // Auto-run a question passed in via ?q= (from the "Ask the Copilot" bar), but
  // only after hydration and only when there's no stored conversation to keep.
  useEffect(() => {
    if (!hydrated || ranInitial.current) return;
    if (initialQuestion && initialQuestion.trim() && turns.length === 0) {
      ranInitial.current = true;
      ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const newBtn = (
    <button
      onClick={clearConversation}
      disabled={loading}
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors disabled:opacity-40 hover:shadow-sm shrink-0"
      style={{ color: gold, border: `1px solid color-mix(in srgb, ${gold} 30%, ${C.border})`, backgroundColor: `color-mix(in srgb, ${gold} 6%, transparent)` }}
      title={t("copilot.newConversation")}>
      <Plus size={12} /> Nueva conversación
    </button>
  );

  const containerStyle = embedded
    ? { backgroundColor: "transparent", height: "100%" }
    : { backgroundColor: C.card, borderColor: C.border, borderTop: `3px solid ${gold}`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)", minHeight: "60vh" };

  return (
    <div className={`flex flex-col ${embedded ? "h-full" : "rounded-2xl border overflow-hidden"}`} style={containerStyle}>
      {/* Full header only in standalone; the floating panel already has one. */}
      {!embedded && (
        <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: C.border }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 65%, white))` }}>
            <Brain size={17} style={{ color: "#fff" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold" style={{ color: C.textPrimary }}>Copilot</p>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#fff", letterSpacing: "0.06em" }}>AI</span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>Memory across all your prospects — compare objections, reactions and what&apos;s working.</p>
          </div>
          {turns.length > 0 && newBtn}
        </div>
      )}

      {/* Embedded: a slim row that just carries the "new conversation" action. */}
      {embedded && turns.length > 0 && (
        <div className="flex items-center justify-end px-3 py-2 border-b" style={{ borderColor: C.border }}>
          {newBtn}
        </div>
      )}

      <div ref={scrollRef} className="px-5 py-4 space-y-3 flex-1" style={{ overflowY: "auto" }}>
        {turns.length === 0 && !loading && (
          <div className="py-2">
            <p className="text-[12px] mb-2.5" style={{ color: C.textMuted }}>Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="text-[12px] text-left px-3 py-1.5 rounded-lg border transition-colors hover:shadow-sm"
                  style={{ color: C.textBody, borderColor: `color-mix(in srgb, ${gold} 30%, ${C.border})`, backgroundColor: `color-mix(in srgb, ${gold} 5%, transparent)` }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
              style={t.role === "user"
                ? { backgroundColor: `color-mix(in srgb, ${gold} 16%, transparent)`, color: C.textPrimary, borderTopRightRadius: 4 }
                : { backgroundColor: C.bg, color: C.textBody, border: `1px solid ${C.border}`, borderTopLeftRadius: 4 }}>
              {t.role === "assistant"
                ? t.text.split("\n").map((line, j) => {
                    const x = line.trim();
                    if (!x) return null;
                    const bullet = x.startsWith("- ") || x.startsWith("• ");
                    return bullet
                      ? <div key={j} className="flex gap-1.5"><span style={{ color: gold }}>•</span><span>{x.replace(/^[-•]\s+/, "")}</span></div>
                      : <p key={j} className={j > 0 ? "mt-1.5" : ""}>{x}</p>;
                  })
                : t.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-2.5 inline-flex items-center gap-2 text-[12px]" style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}`, borderTopLeftRadius: 4 }}>
              <Loader2 size={13} className="animate-spin" /> Searching your prospects…
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t" style={{ borderColor: C.border }}>
        {error && <p className="text-[11px] mb-2" style={{ color: C.red }}>{error}</p>}
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(input); } }}
            placeholder="Ask across all your prospects… (⌘/Ctrl+Enter to send)" rows={1}
            className="flex-1 resize-none rounded-xl px-3 py-2.5 text-[13px] outline-none"
            style={{ backgroundColor: C.bg, color: C.textPrimary, border: `1px solid ${C.border}`, maxHeight: 120 }} />
          <button onClick={() => ask(input)} disabled={loading || !input.trim()}
            className="rounded-xl px-3.5 py-2.5 flex items-center gap-1.5 text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#fff" }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
