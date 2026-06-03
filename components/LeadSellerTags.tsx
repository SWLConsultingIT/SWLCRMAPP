"use client";

import { useEffect, useRef, useState } from "react";
import { Tag, X, Plus, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

// "Tagged sellers" on a lead — loop teammates into a lead beyond the single
// assigned owner. Tagging notifies the seller (in-app bell). Lives in the lead
// Profile Overview, under the Assigned Seller row.

type SellerTag = { sellerId: string; name: string };
type SellerOption = { id: string; name: string };

export default function LeadSellerTags({ leadId }: { leadId: string }) {
  const [tags, setTags] = useState<SellerTag[]>([]);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/leads/${leadId}/tags`).then(r => r.json()).then(d => setTags(d.tags ?? [])).catch(() => {});
    fetch(`/api/sellers?usable=1`).then(r => r.ok ? r.json() : { sellers: [] }).then(d => setSellers((d.sellers ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => {});
  }, [leadId]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function addTag(s: SellerOption) {
    setOpen(false);
    if (tags.some(t => t.sellerId === s.id)) return;
    setTags(prev => [...prev, { sellerId: s.id, name: s.name }]);
    setBusy(true);
    try {
      await fetch(`/api/leads/${leadId}/tags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellerId: s.id }) });
    } catch { setTags(prev => prev.filter(t => t.sellerId !== s.id)); }
    finally { setBusy(false); }
  }

  async function removeTag(sellerId: string) {
    setTags(prev => prev.filter(t => t.sellerId !== sellerId));
    try { await fetch(`/api/leads/${leadId}/tags?sellerId=${encodeURIComponent(sellerId)}`, { method: "DELETE" }); } catch {}
  }

  const available = sellers.filter(s => !tags.some(t => t.sellerId === s.id));

  return (
    <div className="pt-4 border-t" style={{ borderColor: C.border }}>
      <div className="flex items-center gap-2 mb-2">
        <Tag size={12} style={{ color: C.textDim }} />
        <p className="text-xs uppercase tracking-wider" style={{ color: C.textDim, fontSize: 10 }}>Tagged sellers</p>
        {busy && <Loader2 size={11} className="animate-spin" style={{ color: C.textDim }} />}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {tags.map(t => (
          <span key={t.sellerId} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold, border: `1px solid color-mix(in srgb, ${C.gold} 30%, transparent)` }}>
            {t.name}
            <button onClick={() => removeTag(t.sellerId)} className="hover:opacity-70" title="Remove tag"><X size={11} /></button>
          </span>
        ))}
        <div ref={wrapRef} className="relative">
          <button onClick={() => setOpen(v => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
            <Plus size={12} /> Tag seller
          </button>
          {open && (
            <div className="absolute z-20 mt-1 left-0 rounded-lg border shadow-lg max-h-56 overflow-y-auto min-w-[180px]"
              style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.12)" }}>
              {available.length === 0 ? (
                <p className="px-3 py-2 text-xs" style={{ color: C.textDim }}>No more sellers.</p>
              ) : available.map(s => (
                <button key={s.id} onClick={() => addTag(s)}
                  className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-black/[0.04]" style={{ color: C.textBody }}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
