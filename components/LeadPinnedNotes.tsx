"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { Star, Phone, X } from "lucide-react";

// Pinned ("Key") notes surfaced in the lead's Profile Overview. Sellers pin a
// good note from the Notes tab and it shows here. Hidden when nothing is pinned.

type Note = { id: string; content: string; author_name: string | null; created_at: string; note_type: "general" | "call"; pinned: boolean };

export default function LeadPinnedNotes({ leadId }: { leadId: string }) {
  const [pinned, setPinned] = useState<Note[]>([]);

  useEffect(() => {
    fetch(`/api/leads/${leadId}/notes`).then(r => r.json())
      .then(d => setPinned((d.notes ?? []).filter((n: Note) => n.pinned)))
      .catch(() => {});
  }, [leadId]);

  async function unpin(id: string) {
    setPinned(prev => prev.filter(n => n.id !== id));
    try { await fetch(`/api/leads/${leadId}/notes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noteId: id, pinned: false }) }); } catch {}
  }

  if (pinned.length === 0) return null;

  return (
    <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: `color-mix(in srgb, ${C.gold} 30%, ${C.border})`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center gap-2 mb-4">
        <Star size={14} style={{ color: C.gold, fill: C.gold }} />
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textPrimary }}>Key notes</h3>
      </div>
      <div className="space-y-3">
        {pinned.map(n => (
          <div key={n.id} className="flex items-start gap-3 group">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: n.note_type === "call" ? C.phone : "var(--brand, #c9a83a)" }}>
              {n.note_type === "call" ? <Phone size={12} /> : (n.author_name ?? "?")[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{n.author_name ?? "Team"}{n.note_type === "call" ? " · Call" : ""}</span>
                <button onClick={() => unpin(n.id)} title="Remove from overview" className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/[0.04]"><X size={11} style={{ color: C.textDim }} /></button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap mt-0.5" style={{ color: C.textBody }}>{n.content}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
