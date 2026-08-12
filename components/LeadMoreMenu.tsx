"use client";

// Secondary lead actions collapsed into one "More" menu so the lead hero's
// action row stays calm: one primary Call button + this menu + prev/next nav.
// Holds View flow / Export / Log outcome / Delete. Log outcome reuses the same
// CallOutcomePrompt as an in-app dial; Delete replicates the confirm + DELETE
// /api/leads/[id] flow from the old standalone DeleteLeadButton.

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Megaphone, FileDown, ClipboardCheck, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { C } from "@/lib/design";
import CallOutcomePrompt from "@/components/CallOutcomePrompt";

export default function LeadMoreMenu({ leadId, leadName, campaignId }: {
  leadId: string; leadName: string; campaignId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Portal the modals to <body>: the hero card has a CSS `transform` (.reveal
  // animation) which makes any position:fixed descendant relative to the card
  // instead of the viewport — so an in-tree modal renders clipped/off-center.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  async function del() {
    setDeleting(true); setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      if (res.ok) { router.push("/leads"); router.refresh(); }
      else { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed to delete lead"); setDeleting(false); }
    } catch { setError("Network error"); setDeleting(false); }
  }

  const item = "w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:bg-black/[0.04]";

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="true" aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold border transition-colors hover:bg-black/[0.03]"
        style={{ borderColor: C.border, color: C.textBody }} title="More actions">
        More <MoreHorizontal size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 rounded-xl border shadow-lg p-1.5 min-w-[190px]"
          style={{ backgroundColor: C.card, borderColor: C.border }}>
          {campaignId && (
            <Link href={`/campaigns/${campaignId}`} className={item} style={{ color: C.textBody }} onClick={() => setOpen(false)}>
              <Megaphone size={15} style={{ color: C.textMuted }} /> View flow
            </Link>
          )}
          <a href={`/leads/${leadId}/print`} target="_blank" rel="noopener noreferrer" className={item} style={{ color: C.textBody }} onClick={() => setOpen(false)}>
            <FileDown size={15} style={{ color: C.textMuted }} /> Export PDF
          </a>
          <button type="button" className={item} style={{ color: C.textBody }} onClick={() => { setOpen(false); setOutcome(true); }}>
            <ClipboardCheck size={15} style={{ color: C.textMuted }} /> Log outcome
          </button>
          <div className="my-1 h-px" style={{ backgroundColor: C.border }} />
          <button type="button" className={item} style={{ color: C.red }} onClick={() => { setOpen(false); setConfirm(true); }}>
            <Trash2 size={15} style={{ color: C.red }} /> Delete lead
          </button>
        </div>
      )}

      {mounted && outcome && createPortal(<CallOutcomePrompt leadId={leadId} onClose={() => setOutcome(false)} />, document.body)}

      {mounted && confirm && createPortal((
        <div className="fixed inset-0 z-[1200] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="rounded-xl border p-6 w-full max-w-sm shadow-xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: C.redLight }}>
                <AlertTriangle size={20} style={{ color: C.red }} />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Delete lead</h3>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm mb-5" style={{ color: C.textBody }}>
              Delete <strong>{leadName}</strong>? All campaigns, messages and replies for this lead are permanently removed.
            </p>
            {error && <div className="rounded-lg px-3 py-2 mb-4 text-xs font-medium" style={{ backgroundColor: C.redLight, color: C.red }}>{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirm(false); setError(null); }} disabled={deleting}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold border" style={{ borderColor: C.border, color: C.textBody }}>Cancel</button>
              <button onClick={del} disabled={deleting}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold inline-flex items-center gap-1.5" style={{ backgroundColor: C.red, color: "#fff" }}>
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
