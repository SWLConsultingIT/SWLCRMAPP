"use client";

import { useState, type ReactNode } from "react";
import { C } from "@/lib/design";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";

// Premium collapsible section for /admin/reliability. Each section gets a
// 3px accent rail on the left that picks up the section's severity color
// (red for failed/ghost, amber for stuck/cooldown, blue for ready, gold
// for sellers) so the operator can read the page by color alone. The
// header band sits on a tinted surface that matches the rail.
export default function CollapsibleSection({
  title,
  accent,
  count,
  defaultOpen,
  hint,
  children,
}: {
  title: string;
  accent: string;
  count?: number;
  defaultOpen?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div
      className="rounded-xl border overflow-hidden mb-3 transition-shadow hover:shadow-md"
      style={{
        backgroundColor: C.card,
        borderColor: `color-mix(in srgb, ${accent} 18%, ${C.border})`,
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3.5 flex items-center gap-3 text-left transition-colors hover:bg-black/[0.02]"
        style={{
          borderBottom: open ? `1px solid ${C.border}` : "1px solid transparent",
          backgroundColor: open ? `color-mix(in srgb, ${accent} 5%, transparent)` : "transparent",
        }}>
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
          }}
        >
          {open
            ? <ChevronDown size={13} style={{ color: accent }} />
            : <ChevronRight size={13} style={{ color: accent }} />}
        </span>
        <Zap size={11} style={{ color: accent }} />
        <span className="text-[12.5px] font-bold uppercase tracking-wider" style={{ color: accent, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{title}</span>
        {typeof count === "number" && (
          <span className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
            {count}
          </span>
        )}
        {hint && <span className="text-[10.5px] ml-2 hidden sm:inline" style={{ color: C.textMuted }}>{hint}</span>}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
