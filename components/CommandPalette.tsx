"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { Search, ArrowRight, CheckCircle, XCircle, Clock, MinusCircle, Loader } from "lucide-react";

type Result = {
  id: string; first_name: string; last_name: string;
  company: string; role: string; status: string; email: string;
};

const statusConfig: Record<string, { color: string; icon: React.ElementType }> = {
  new:         { color: C.cyan,     icon: Clock },
  contacted:   { color: C.gold,     icon: Clock },
  qualified:   { color: C.green,    icon: CheckCircle },
  cold:        { color: C.textBody, icon: MinusCircle },
  closed_lost: { color: C.red,      icon: XCircle },
};

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(""); setResults([]); setCursor(0); }
  }, [open]);

  const search = useCallback((q: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(q)}`);
        const { leads } = await res.json();
        setResults(leads ?? []);
        setCursor(0);
      } finally { setLoading(false); }
    }, 200);
  }, []);

  function navigate(id: string) {
    setOpen(false);
    router.push(`/leads/${id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && results[cursor]) navigate(results[cursor].id);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      style={{ backgroundColor: "rgba(4,7,13,0.8)", backdropFilter: "blur(4px)" }}
      onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl rounded-2xl border overflow-hidden shadow-2xl fade-in"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: `0 0 60px rgba(0,0,0,0.6), 0 0 0 1px ${C.border}` }}
        onClick={e => e.stopPropagation()}>

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: C.border }}>
          {loading
            ? <Loader size={16} style={{ color: C.gold }} className="animate-spin shrink-0" />
            : <Search size={16} style={{ color: C.textMuted }} className="shrink-0" />}
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); search(e.target.value); }}
            onKeyDown={onKeyDown}
            placeholder="Buscar lead por nombre, empresa, email..."
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: C.textPrimary }}
          />
          <kbd className="text-xs px-1.5 py-0.5 rounded font-mono"
            style={{ backgroundColor: C.surface, color: C.textMuted, border: `1px solid ${C.border}` }}>esc</kbd>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="py-1.5 max-h-80 overflow-y-auto">
            {results.map((r, i) => {
              const st = statusConfig[r.status] ?? statusConfig.new;
              const Icon = st.icon;
              return (
                <button key={r.id} onClick={() => navigate(r.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  style={{ backgroundColor: i === cursor ? C.surface : "transparent" }}
                  onMouseEnter={() => setCursor(i)}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: `linear-gradient(135deg, ${C.gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#04070d" }}>
                    {r.first_name?.[0]}{r.last_name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: C.textPrimary }}>
                      {r.first_name} {r.last_name}
                    </p>
                    <p className="text-xs truncate" style={{ color: C.textMuted }}>{r.company} {r.role ? `· ${r.role}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Icon size={11} style={{ color: st.color }} />
                    <ArrowRight size={12} style={{ color: C.textDim }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {query.length >= 2 && !loading && results.length === 0 && (
          <p className="px-4 py-6 text-sm text-center" style={{ color: C.textDim }}>Sin resultados para "{query}"</p>
        )}

        {/* Footer */}
        <div className="px-4 py-2 border-t flex items-center gap-4" style={{ borderColor: C.border }}>
          {[["↑↓", "navegar"], ["↵", "abrir"], ["esc", "cerrar"]].map(([k, l]) => (
            <span key={k} className="flex items-center gap-1.5 text-xs" style={{ color: C.textDim }}>
              <kbd className="px-1 py-0.5 rounded font-mono text-xs"
                style={{ backgroundColor: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}>{k}</kbd>
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
