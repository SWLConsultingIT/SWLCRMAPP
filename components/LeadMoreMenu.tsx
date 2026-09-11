"use client";

// Secondary lead actions collapsed into one "More" menu so the lead hero's
// action row stays calm: one primary Call button + this menu + prev/next nav.
// Holds View flow / Export / Mark result / Delete. Log outcome reuses the same
// CallOutcomePrompt as an in-app dial; Delete replicates the confirm + DELETE
// /api/leads/[id] flow from the old standalone DeleteLeadButton.
//
// The dropdown is PORTALED to <body> with fixed positioning computed from the
// button — the hero card is `overflow-hidden` (rounded corners + gold strip),
// which used to clip an in-tree absolute menu (Fran 2026-09-11: "el more
// funciona mal"). Portaling + fixed coords keeps it fully visible everywhere.

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Megaphone, FileDown, ClipboardCheck, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { C } from "@/lib/design";
import LeadResultModal from "@/components/LeadResultModal";

export default function LeadMoreMenu({ leadId, leadName, campaignId, autoReplies }: {
  leadId: string; leadName: string; campaignId: string | null;
  autoReplies?: { positive?: string; negative?: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [outcome, setOutcome] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  function toggle() { if (!open) place(); setOpen(o => !o); }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (btnRef.current?.contains(tgt) || menuRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    const onScrollResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
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
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-haspopup="true" aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold border transition-colors hover:bg-black/[0.03]"
        style={{ borderColor: C.border, color: C.textBody }} title="More actions">
        More <MoreHorizontal size={15} />
      </button>

      {mounted && open && pos && createPortal(
        <div ref={menuRef} className="fixed z-[1100] rounded-xl border shadow-lg p-1.5 min-w-[190px]"
          style={{ top: pos.top, right: pos.right, backgroundColor: C.card, borderColor: C.border }}>
          {campaignId && (
            <Link href={`/campaigns/${campaignId}`} className={item} style={{ color: C.textBody }} onClick={() => setOpen(false)}>
              <Megaphone size={15} style={{ color: C.textMuted }} /> View flow
            </Link>
          )}
          <a href={`/leads/${leadId}/print`} target="_blank" rel="noopener noreferrer" className={item} style={{ color: C.textBody }} onClick={() => setOpen(false)}>
            <FileDown size={15} style={{ color: C.textMuted }} /> Export PDF
          </a>
          <button type="button" className={item} style={{ color: C.textBody }} onClick={() => { setOpen(false); setOutcome(true); }}>
            <ClipboardCheck size={15} style={{ color: C.textMuted }} /> Mark result
          </button>
          <div className="my-1 h-px" style={{ backgroundColor: C.border }} />
          <button type="button" className={item} style={{ color: C.red }} onClick={() => { setOpen(false); setConfirm(true); }}>
            <Trash2 size={15} style={{ color: C.red }} /> Delete lead
          </button>
        </div>,
        document.body
      )}

      {outcome && <LeadResultModal leadId={leadId} autoReplies={autoReplies ?? null} onClose={() => setOutcome(false)} />}

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
    </>
  );
}
