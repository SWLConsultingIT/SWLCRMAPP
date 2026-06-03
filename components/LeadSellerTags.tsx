"use client";

import { useEffect, useRef, useState } from "react";
import { Tag, X, Plus, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

// "Tagged teammates" on a lead — loop anyone on the team into a lead beyond the
// single assigned owner. Tagging notifies them (in-app bell). Lives in the lead
// Profile Overview, under the Assigned Seller row.

type TeamTag = { userId: string; name: string };

export default function LeadSellerTags({ leadId }: { leadId: string }) {
  const [tags, setTags] = useState<TeamTag[]>([]);
  const [roster, setRoster] = useState<TeamTag[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/leads/${leadId}/tags`).then(r => r.json()).then(d => setTags(d.tags ?? [])).catch(() => {});
    fetch(`/api/team/roster`).then(r => r.ok ? r.json() : { roster: [] }).then(d => setRoster(d.roster ?? [])).catch(() => {});
  }, [leadId]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function addTag(m: TeamTag) {
    setOpen(false);
    if (tags.some(t => t.userId === m.userId)) return;
    setTags(prev => [...prev, m]);
    setBusy(true);
    try {
      await fetch(`/api/leads/${leadId}/tags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: m.userId }) });
    } catch { setTags(prev => prev.filter(t => t.userId !== m.userId)); }
    finally { setBusy(false); }
  }

  async function removeTag(userId: string) {
    setTags(prev => prev.filter(t => t.userId !== userId));
    try { await fetch(`/api/leads/${leadId}/tags?userId=${encodeURIComponent(userId)}`, { method: "DELETE" }); } catch {}
  }

  const available = roster.filter(m => !tags.some(t => t.userId === m.userId));

  return (
    <div className="pt-4 border-t" style={{ borderColor: C.border }}>
      <div className="flex items-center gap-2 mb-2">
        <Tag size={12} style={{ color: C.textDim }} />
        <p className="text-xs uppercase tracking-wider" style={{ color: C.textDim, fontSize: 10 }}>Tagged teammates</p>
        {busy && <Loader2 size={11} className="animate-spin" style={{ color: C.textDim }} />}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {tags.map(t => (
          <span key={t.userId} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold, border: `1px solid color-mix(in srgb, ${C.gold} 30%, transparent)` }}>
            {t.name}
            <button onClick={() => removeTag(t.userId)} className="hover:opacity-70" title="Remove tag"><X size={11} /></button>
          </span>
        ))}
        <div ref={wrapRef} className="relative">
          <button onClick={() => setOpen(v => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
            <Plus size={12} /> Tag teammate
          </button>
          {open && (
            <div className="absolute z-20 mt-1 left-0 rounded-lg border shadow-lg max-h-56 overflow-y-auto min-w-[180px]"
              style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.12)" }}>
              {available.length === 0 ? (
                <p className="px-3 py-2 text-xs" style={{ color: C.textDim }}>No more teammates.</p>
              ) : available.map(m => (
                <button key={m.userId} onClick={() => addTag(m)}
                  className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
