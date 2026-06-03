"use client";

import { useEffect, useRef, useState } from "react";
import { Tag, X, Plus, Loader2, ChevronLeft } from "lucide-react";
import { C } from "@/lib/design";

// "Tagged teammates" on a lead — loop anyone on the team into a lead beyond the
// single assigned owner. Tagging notifies them (in-app bell) and can carry an
// optional reason, shown on hover over the chip. `compact` renders inline (for
// the lead header, next to the name) without the labelled block.

type TeamTag = { userId: string; name: string; reason: string | null };
type Member = { userId: string; name: string };

export default function LeadSellerTags({ leadId, compact = false }: { leadId: string; compact?: boolean }) {
  const [tags, setTags] = useState<TeamTag[]>([]);
  const [roster, setRoster] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Two-step add: pick teammate → optionally type a reason → confirm.
  const [pending, setPending] = useState<Member | null>(null);
  const [reason, setReason] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/leads/${leadId}/tags`).then(r => r.json()).then(d => setTags(d.tags ?? [])).catch(() => {});
    fetch(`/api/team/roster`).then(r => r.ok ? r.json() : { roster: [] }).then(d => setRoster(d.roster ?? [])).catch(() => {});
  }, [leadId]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setPending(null); setReason(""); } }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function commit() {
    if (!pending) return;
    const member = pending, r = reason.trim();
    setOpen(false); setPending(null); setReason("");
    if (tags.some(t => t.userId === member.userId)) return;
    setTags(prev => [...prev, { ...member, reason: r || null }]);
    setBusy(true);
    try {
      await fetch(`/api/leads/${leadId}/tags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.userId, reason: r || undefined }) });
    } catch { setTags(prev => prev.filter(t => t.userId !== member.userId)); }
    finally { setBusy(false); }
  }

  async function removeTag(userId: string) {
    setTags(prev => prev.filter(t => t.userId !== userId));
    try { await fetch(`/api/leads/${leadId}/tags?userId=${encodeURIComponent(userId)}`, { method: "DELETE" }); } catch {}
  }

  const available = roster.filter(m => !tags.some(t => t.userId === m.userId));

  const chips = (
    <>
      {tags.map(t => (
        <span key={t.userId} title={t.reason ? `Reason: ${t.reason}` : "No reason given"}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-default"
          style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold, border: `1px solid color-mix(in srgb, ${C.gold} 30%, transparent)` }}>
          <Tag size={10} /> {t.name}
          <button onClick={() => removeTag(t.userId)} className="hover:opacity-70" title="Remove tag"><X size={11} /></button>
        </span>
      ))}
      <div ref={wrapRef} className="relative">
        <button onClick={() => { setOpen(v => !v); setPending(null); setReason(""); }}
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors"
          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
          <Plus size={11} /> Tag teammate
        </button>
        {open && (
          <div className="absolute z-30 mt-1 left-0 rounded-lg border shadow-lg w-60" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.14)" }}>
            {!pending ? (
              <div className="max-h-56 overflow-y-auto">
                {available.length === 0 ? (
                  <p className="px-3 py-2 text-xs" style={{ color: C.textDim }}>No more teammates.</p>
                ) : available.map(m => (
                  <button key={m.userId} onClick={() => { setPending(m); setReason(""); }}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>
                    {m.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-2.5">
                <button onClick={() => setPending(null)} className="flex items-center gap-1 text-[11px] mb-2" style={{ color: C.textDim }}>
                  <ChevronLeft size={11} /> back
                </button>
                <p className="text-xs font-semibold mb-1.5" style={{ color: C.textPrimary }}>Tag {pending.name}</p>
                <input autoFocus value={reason} onChange={e => setReason(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") commit(); }}
                  placeholder="Reason (optional) — e.g. needs your input"
                  className="w-full text-xs px-2.5 py-2 rounded-lg border outline-none mb-2" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
                <button onClick={commit} className="w-full text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ backgroundColor: C.gold, color: "#04070d" }}>
                  Tag
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {busy && <Loader2 size={11} className="animate-spin" style={{ color: C.textDim }} />}
    </>
  );

  if (compact) {
    return <div className="flex items-center gap-1.5 flex-wrap">{chips}</div>;
  }

  return (
    <div className="pt-4 border-t" style={{ borderColor: C.border }}>
      <div className="flex items-center gap-2 mb-2">
        <Tag size={12} style={{ color: C.textDim }} />
        <p className="text-xs uppercase tracking-wider" style={{ color: C.textDim, fontSize: 10 }}>Tagged teammates</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">{chips}</div>
    </div>
  );
}
