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
import { useLocale } from "@/lib/i18n";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Megaphone, FileDown, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

// "Mark result" was removed from this menu — it duplicated the hero's primary
// "Set result" action (same LeadResultModal). More now holds only View flow /
// Export PDF / Delete (Fran 2026-09-11). `autoReplies` stays in the type so
// callers don't change, but the component no longer needs it.
export default function LeadMoreMenu({ leadId, leadName, campaignId }: {
  leadId: string; leadName: string; campaignId: string | null;
  autoReplies?: { positive?: string; negative?: string } | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
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
        style={{ borderColor: C.border, color: C.textBody }} title={t("lmm.moreActions")}>
        {t("lmm.more")} <MoreHorizontal size={15} />
      </button>

      {mounted && open && pos && createPortal(
        <div ref={menuRef} className="fixed z-[1100] rounded-xl border shadow-lg p-1.5 min-w-[190px]"
          style={{ top: pos.top, right: pos.right, backgroundColor: C.card, borderColor: C.border }}>
          {campaignId && (
            <Link href={`/campaigns/${campaignId}`} className={item} style={{ color: C.textBody }} onClick={() => setOpen(false)}>
              <Megaphone size={15} style={{ color: C.textMuted }} /> {t("lmm.viewFlow")}
            </Link>
          )}
          <a href={`/leads/${leadId}/print`} target="_blank" rel="noopener noreferrer" className={item} style={{ color: C.textBody }} onClick={() => setOpen(false)}>
            <FileDown size={15} style={{ color: C.textMuted }} /> {t("lmm.exportPdf")}
          </a>
          <div className="my-1 h-px" style={{ backgroundColor: C.border }} />
          <button type="button" className={item} style={{ color: C.red }} onClick={() => { setOpen(false); setConfirm(true); }}>
            <Trash2 size={15} style={{ color: C.red }} /> {t("lmm.deleteLead")}
          </button>
        </div>,
        document.body
      )}

      {mounted && confirm && createPortal((
        <div className="fixed inset-0 z-[1200] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="rounded-xl border p-6 w-full max-w-sm shadow-xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: C.redLight }}>
                <AlertTriangle size={20} style={{ color: C.red }} />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("lmm.deleteLead")}</h3>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{t("lmm.cannotUndo")}</p>
              </div>
            </div>
            <p className="text-sm mb-5" style={{ color: C.textBody }}>
              {t("lmm.deleteWord")} <strong>{leadName}</strong>{t("lmm.deleteConfirmRest")}
            </p>
            {error && <div className="rounded-lg px-3 py-2 mb-4 text-xs font-medium" style={{ backgroundColor: C.redLight, color: C.red }}>{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirm(false); setError(null); }} disabled={deleting}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold border" style={{ borderColor: C.border, color: C.textBody }}>{t("lmm.cancel")}</button>
              <button onClick={del} disabled={deleting}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold inline-flex items-center gap-1.5" style={{ backgroundColor: C.red, color: "#fff" }}>
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {t("lmm.delete")}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
