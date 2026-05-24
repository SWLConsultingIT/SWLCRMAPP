"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

type Alert = { label: string; count: number; href: string; color: string };

export default function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem("dash.collapsed.alerts");
      if (v === "1") setOpen(false);
      else if (v === "0") setOpen(true);
    } catch { /* private mode */ }
    setHydrated(true);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem("dash.collapsed.alerts", next ? "0" : "1"); } catch { /* ignore */ }
  }

  const total = alerts.reduce((s, a) => s + a.count, 0);

  // Warm amber accent that has to read in BOTH light + dark mode.
  // - panel bg/border  → use the theme-aware C.yellowLight (#FFFBEB in light,
  //                      a deep #2A1F08 in dark) + a brand-amber border so the
  //                      panel still feels amber-toned in dark without the
  //                      eye-burning #FFFBEB rectangle.
  // - text/icon colors → kept brand amber (#D97706 / #B45309) which reads
  //                      against both backgrounds. The count badge swaps to
  //                      a translucent amber chip via color-mix so it doesn't
  //                      look pasted on in dark mode.
  const amberBorder = "color-mix(in srgb, #D97706 35%, transparent)";
  const amberBadgeBg = "color-mix(in srgb, #D97706 25%, transparent)";
  return (
    <div
      className="rounded-xl border mb-6 overflow-hidden"
      style={{ backgroundColor: C.yellowLight, borderColor: amberBorder }}
    >
      {/* Header / toggle row */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-3 text-left transition-opacity hover:opacity-90 focus-visible:outline-none"
        style={{ borderBottom: open ? `1px solid ${amberBorder}` : "none" }}
      >
        <AlertTriangle size={14} className="shrink-0" style={{ color: C.yellow }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.yellow }}>
          Needs Attention
        </span>
        {/* Total count badge */}
        <span
          className="flex items-center justify-center rounded-full text-[10px] font-bold px-2 py-0.5 shrink-0"
          style={{ backgroundColor: amberBadgeBg, color: C.yellow }}
        >
          {total}
        </span>
        <span className="flex-1" />
        <span className="text-[10px] font-medium mr-1" style={{ color: C.yellow, opacity: hydrated ? 0.85 : 0 }}>
          {open ? "collapse" : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""}`}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform duration-150"
          style={{
            color: C.yellow,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            opacity: hydrated ? 1 : 0,
          }}
        />
      </button>

      {/* Expandable body */}
      {open && (
        <div className="px-5 py-3 flex flex-wrap gap-2">
          {alerts.map((a, i) => {
            const tone = a.label.includes("approval") ? "info" : "warning";
            // Same dark-mode-aware swap: translucent chip + brand text.
            const fg = tone === "info" ? C.linkedin : C.yellow;
            const bd = `color-mix(in srgb, ${fg} 35%, transparent)`;
            const bg = `color-mix(in srgb, ${fg} 12%, transparent)`;
            return (
              <Link
                key={i}
                href={a.href}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all hover:opacity-90 hover:shadow-sm"
                style={{ borderColor: bd, color: fg, backgroundColor: bg }}
              >
                <span className="font-bold tabular-nums">{a.count}</span>
                {a.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
