"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell, Phone, MessageSquare, AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { C } from "@/lib/design";

// Bell icon in the TopHeader → opens a slim popover summarising "Today's plan":
// pending calls, replies awaiting triage, items needing approval. Click any
// row to jump to that surface. Lets sellers check status without leaving the
// current page.

type Counts = {
  calls: number;
  pending: number;
  pendingReplies: number;
};

export default function TodayPlanPopover() {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>({ calls: 0, pending: 0, pendingReplies: 0 });
  const [mounted, setMounted] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Re-anchor the portaled popover under the bell on open + on scroll/resize.
  // Without this the popover would sit at (0,0) of the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [open]);

  // Reuse the existing sidebar badges endpoint — same data shape, no new
  // round-trip type to maintain. Cached server-side per session.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/sidebar/badges", { cache: "no-store" });
        if (!res.ok) return;
        const d = await res.json();
        if (!alive) return;
        setCounts({
          calls: d.calls ?? 0,
          pending: d.pending ?? 0,
          pendingReplies: d.pendingReplies ?? 0,
        });
      } catch { /* silent */ }
    }
    load();
    // Re-poll on open so the seller sees fresh numbers; cheap because endpoint
    // is head-only counts.
    if (open) load();
    const interval = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(interval); };
  }, [open]);

  // Esc → close (click-outside handled by the portaled backdrop)
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const total = counts.calls + counts.pending + counts.pendingReplies;
  const items = [
    {
      key: "calls",
      count: counts.calls,
      label: "Calls pending",
      icon: Phone,
      color: "#F97316",
      href: "/queue",
    },
    {
      key: "replies",
      count: counts.pendingReplies,
      label: "Replies to triage",
      icon: MessageSquare,
      color: C.blue,
      href: "/queue?tab=inbox",
    },
    {
      key: "approvals",
      count: counts.pending,
      label: "Awaiting approval",
      icon: AlertCircle,
      color: "var(--brand, #c9a83a)",
      href: "/queue?tab=reviews",
    },
  ];

  const panel = (
    <>
      <div
        className="fixed inset-0 z-[9998]"
        style={{ backgroundColor: "rgba(15,23,42,0.18)" }}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        ref={wrapRef}
        className="fixed rounded-xl border z-[9999] w-72 overflow-hidden"
        style={{
          top: anchor?.top ?? 0,
          right: anchor?.right ?? 0,
          backgroundColor: C.card,
          borderColor: C.border,
          boxShadow: "0 24px 56px -20px rgba(0,0,0,0.35), 0 4px 12px -4px rgba(0,0,0,0.08)",
        }}
      >
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b" style={{ borderColor: C.border }}>
              <p className="text-xs font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {total === 0 ? "All caught up" : `${total} need you`}
              </p>
              <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textDim }}>
                Today
              </span>
            </div>

            {total === 0 ? (
              <div className="px-4 py-6 text-center">
                <CheckCircle2 size={18} className="mx-auto mb-1.5" style={{ color: C.green }} />
                <p className="text-[11px]" style={{ color: C.textMuted }}>
                  Nothing pending right now.
                </p>
              </div>
            ) : (
              <div className="py-1">
                {items.map(it => {
                  if (it.count === 0) return null;
                  const Icon = it.icon;
                  return (
                    <Link
                      key={it.key}
                      href={it.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-black/[0.04]"
                    >
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, ${it.color} 14%, transparent)`, color: it.color }}
                      >
                        <Icon size={13} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold leading-tight" style={{ color: C.textPrimary }}>
                          {it.label}
                        </p>
                        <p className="text-[10px] leading-tight mt-0.5" style={{ color: C.textMuted }}>
                          {it.count} pending
                        </p>
                      </div>
                      <ArrowRight size={11} style={{ color: C.textDim }} />
                    </Link>
                  );
                })}
              </div>
            )}

        <Link
          href="/queue"
          onClick={() => setOpen(false)}
          className="block border-t px-3.5 py-2 text-[11px] font-semibold text-center transition-opacity hover:opacity-80"
          style={{ borderColor: C.border, color: "var(--brand, #c9a83a)" }}
        >
          Open Queue →
        </Link>
      </div>
    </>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title="Today's plan"
        aria-label="Today's plan"
        className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100 relative"
        style={{ color: C.textMuted }}
      >
        <Bell size={16} />
        {total > 0 && (
          <span
            className="absolute top-1 right-1 w-2 h-2 rounded-full pulse-dot"
            style={{ backgroundColor: "var(--brand, #c9a83a)" }}
          />
        )}
      </button>
      {open && mounted && createPortal(panel, document.body)}
    </>
  );
}
