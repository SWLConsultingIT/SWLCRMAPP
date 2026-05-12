"use client";

import { useState, type ReactNode } from "react";
import { C } from "@/lib/design";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";

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
    <div className="rounded-xl border overflow-hidden mb-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 border-b flex items-center gap-3 text-left transition-colors hover:bg-gray-50"
        style={{ borderColor: open ? C.border : "transparent" }}>
        {open
          ? <ChevronDown size={14} style={{ color: accent }} />
          : <ChevronRight size={14} style={{ color: accent }} />}
        <Zap size={12} style={{ color: accent }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>{title}</span>
        {typeof count === "number" && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>
            {count}
          </span>
        )}
        {hint && <span className="text-[10px] ml-2 hidden sm:inline" style={{ color: C.textDim }}>{hint}</span>}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
