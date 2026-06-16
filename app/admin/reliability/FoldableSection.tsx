"use client";

// Foldable wrapper for every Reliability section. Same design language
// as the bare sections (4px left-edge accent + gradient header + 17px
// headline), with a toggle that collapses the body so the page doesn't
// turn into an endless scroll. Default-open for the executive summary
// + flows in flight; everything else starts collapsed.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type FoldableProps = {
  title: string;
  subtitle?: string;
  icon: ReactNode;       // pre-styled icon tile, comes from the section
  iconBg?: string;       // override the default gold gradient
  accentColor?: string;  // left-edge rail color
  badge?: ReactNode;     // top-right pill (e.g. "201 total", "ATENCIÓN")
  defaultOpen?: boolean;
  children: ReactNode;
};

export default function FoldableSection({
  title,
  subtitle,
  icon,
  iconBg,
  accentColor,
  badge,
  defaultOpen = false,
  children,
}: FoldableProps) {
  const [open, setOpen] = useState(defaultOpen);
  const accent = accentColor ?? gold;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      borderLeftWidth: 4,
      borderLeftColor: accent,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-7 py-6 flex items-center gap-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_2%,transparent)]"
        style={{
          background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${accent} 3%, ${C.card}) 100%)`,
          borderBottom: open ? `1px solid ${C.border}` : "none",
        }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: iconBg ?? `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
            color: iconBg ? "#fff" : "#1A1A2E",
            boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)`,
          }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
            {title}
          </h2>
          {subtitle && <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
        <ChevronDown
          size={18}
          className="transition-transform shrink-0"
          style={{
            color: C.textMuted,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}
