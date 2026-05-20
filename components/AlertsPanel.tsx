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

  return (
    <div
      className="rounded-xl border mb-6 overflow-hidden"
      style={{ backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }}
    >
      {/* Header / toggle row */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-amber-50/60 focus-visible:outline-none"
        style={{ borderBottom: open ? "1px solid #FDE68A" : "none" }}
      >
        <AlertTriangle size={14} className="shrink-0" style={{ color: "#D97706" }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#92400E" }}>
          Needs Attention
        </span>
        {/* Total count badge */}
        <span
          className="flex items-center justify-center rounded-full text-[10px] font-bold px-2 py-0.5 shrink-0"
          style={{ backgroundColor: "#FCD34D", color: "#78350F" }}
        >
          {total}
        </span>
        <span className="flex-1" />
        <span className="text-[10px] font-medium mr-1" style={{ color: "#B45309", opacity: hydrated ? 1 : 0 }}>
          {open ? "collapse" : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""}`}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform duration-150"
          style={{
            color: "#B45309",
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
            const bg = tone === "info" ? "#EFF6FF" : "#FFFDF5";
            const fg = tone === "info" ? "#1D4ED8" : "#B45309";
            const bd = tone === "info" ? "#BFDBFE" : "#FBBF24";
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
