"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

type Props = {
  title: string;
  description?: string;
  /** Slot at the right of the header (e.g. count badge, "View all" link). */
  rightSlot?: ReactNode;
  /** Icon shown left of the title — pre-rendered, not a component reference. */
  icon?: ReactNode;
  /** localStorage key. When set, the open/closed state persists across reloads
   *  so each user's collapse preferences stick on their machine without
   *  cluttering the URL with `?collapsed=…`. */
  storageKey?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

// Generic collapsible wrapper for dashboard cards. Designed to drop in around
// existing card markup without re-skinning the inner content — just hides the
// body when collapsed. State is per-card via storageKey so the dashboard can
// remember "the user keeps ICP Performance closed" without coordinating a
// global store.
//
// Animation is intentionally minimal (instant toggle of `display: none`). A
// height transition would need known/measured heights and the cards in this
// app vary wildly with data; a snap is safer for live clients than a janky
// transition.
export default function CollapsibleCard({
  title, description, rightSlot, icon, storageKey, defaultOpen = true, children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  // After hydration, restore the persisted state. We can't read localStorage
  // server-side so we render with `defaultOpen`, then sync. The brief flash on
  // first paint is acceptable; we suppress it with `hydrated` so the chevron
  // doesn't visually flip after the rest of the page is ready.
  useEffect(() => {
    if (!storageKey) { setHydrated(true); return; }
    try {
      const v = window.localStorage.getItem(`dash.collapsed.${storageKey}`);
      if (v === "1") setOpen(false);
      else if (v === "0") setOpen(true);
    } catch { /* ignore — private mode or quota */ }
    setHydrated(true);
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (storageKey) {
      try {
        window.localStorage.setItem(`dash.collapsed.${storageKey}`, next ? "0" : "1");
      } catch { /* ignore */ }
    }
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        style={{ borderBottom: open ? `1px solid ${C.border}` : "none" }}
      >
        {icon && <span className="shrink-0 inline-flex" style={{ color: C.textMuted }}>{icon}</span>}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold leading-tight" style={{ color: C.textPrimary }}>{title}</h2>
          {description && (
            <p className="text-[11px] mt-0.5 truncate" style={{ color: C.textMuted }}>{description}</p>
          )}
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform duration-150"
          style={{
            color: C.textMuted,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            opacity: hydrated ? 1 : 0,
          }}
        />
      </button>
      {open && <div className="fade-in">{children}</div>}
    </div>
  );
}
