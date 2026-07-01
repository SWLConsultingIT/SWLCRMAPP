"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { C } from "@/lib/design";

// Canonical modal — backdrop + centered card, one shadow, Esc-to-close, scroll
// lock. Replaces the copy-pasted `fixed inset-0 … rgba(0,0,0,0.5)` + inline card
// shadow found in 5+ modal components.
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 fade-in"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-2xl border overflow-hidden"
        style={{ maxWidth, backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadowLg }}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <h3 className="text-[15px] font-bold" style={{ color: C.textPrimary }}>{title}</h3>
            <button onClick={onClose} className="rounded-lg p-1 transition-colors hover:bg-black/[0.05]" style={{ color: C.textMuted }} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border }}>{footer}</div>}
      </div>
    </div>
  );
}
