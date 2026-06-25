"use client";

import { useRef, useState } from "react";
import { Sparkles, Send, Brain, Loader2 } from "lucide-react";
import { C } from "@/lib/design";


type Turn = { role: "user" | "assistant"; text: string; at?: string };

const SUGGESTIONS = [
  "What's the strongest angle for this account?",
  "How should I open the call?",
  "Likely objections and how to handle them?",
  "Summarise everything we know in 3 lines.",
];

// Lead Copilot — grounded Q&A chat about this lead, with persistent per-lead
// memory. Ask anything ("how do I handle the price objection?", "summarise the
// last call") and get a tactical answer grounded in the lead's data.
export default function LeadQA({ leadId, initialHistory, accent }: { leadId: string; initialHistory?: Turn[] | null; accent?: string }) {
  const gold = accent ?? "var(--brand, #c9a83a)";
  const [turns, setTurns] = useState<Turn[]>(Array.isArray(initialHistory) ? initialHistory : []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setError(null);
    setInput("");
    setTurns((t) => [...t, { role: "user", text: question }]);
    setLoading(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
    try {
      const res = await fetch(`/api/leads/${leadId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setTurns(Array.isArray(data.history) ? data.history : (t) => [...t, { role: "assistant", text: data.answer }]);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      setTurns((t) => t.slice(0, -1)); // roll back the optimistic user turn
      setInput(question);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
    }
  }

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${gold}`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: C.border }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 65%, white))` }}>
          <Brain size={17} style={{ color: "#fff" }} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-bold" style={{ color: C.textPrimary }}>Lead Copilot</p>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#fff", letterSpacing: "0.06em" }}>AI</span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>Ask anything about this lead — grounded in their data, with memory.</p>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="px-5 py-4 space-y-3" style={{ maxHeight: 420, overflowY: "auto" }}>
        {turns.length === 0 && !loading && (
          <div className="py-2">
            <p className="text-[12px] mb-2.5" style={{ color: C.textMuted }}>Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)}
                  className="text-[12px] text-left px-3 py-1.5 rounded-lg border transition-colors hover:shadow-sm"
                  style={{ color: C.textBody, borderColor: `color-mix(in srgb, ${gold} 30%, ${C.border})`, backgroundColor: `color-mix(in srgb, ${gold} 5%, transparent)` }}>
                  {s}
                </button>
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
            <div className="rounded-2xl px-3.5 py-2.5 inline-flex items-center gap-2 text-[12px]"
              style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}`, borderTopLeftRadius: 4 }}>
              <Loader2 size={13} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t" style={{ borderColor: C.border }}>
        {error && <p className="text-[11px] mb-2" style={{ color: C.red }}>{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(input); } }}
            placeholder="Ask the copilot… (⌘/Ctrl+Enter to send)"
            rows={1}
            className="flex-1 resize-none rounded-xl px-3 py-2.5 text-[13px] outline-none"
            style={{ backgroundColor: C.bg, color: C.textPrimary, border: `1px solid ${C.border}`, maxHeight: 120 }}
          />
          <button
            onClick={() => ask(input)}
            disabled={loading || !input.trim()}
            className="rounded-xl px-3.5 py-2.5 flex items-center gap-1.5 text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#fff" }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
