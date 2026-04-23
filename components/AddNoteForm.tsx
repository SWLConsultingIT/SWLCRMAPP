"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { StickyNote, Loader } from "lucide-react";

export default function AddNoteForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.trim() }),
      });
      if (res.ok) {
        setText("");
        router.refresh();
      } else {
        const { error: msg } = await res.json();
        setError(msg ?? "Error al guardar la nota");
      }
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.gold}` }}>
      <div className="px-4 py-3 border-b flex items-center gap-2"
        style={{ borderColor: C.border, background: "linear-gradient(90deg, color-mix(in srgb, var(--brand, #c9a83a) 5%, transparent) 0%, transparent 60%)" }}>
        <StickyNote size={13} style={{ color: C.gold }} />
        <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>Agregar nota</span>
      </div>
      <div className="p-4">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Escribe una nota interna..."
          rows={3}
          className="w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none transition-colors"
          style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }}
        />
        {error && <p className="text-xs mt-1" style={{ color: C.red }}>{error}</p>}
        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="mt-2 flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
          style={{ backgroundColor: C.goldGlow, color: C.gold, border: `1px solid ${C.gold}30` }}
        >
          {loading ? <Loader size={12} className="animate-spin" /> : null}
          Guardar nota
        </button>
      </div>
    </form>
  );
}
