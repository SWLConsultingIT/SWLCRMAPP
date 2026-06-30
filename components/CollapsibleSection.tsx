"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

// Collapsible zone header for the lead detail page. Replicates the ZoneLabel
// look (gold bar + uppercase title + hairline) and adds a chevron toggle.
// When `collapsible={false}` (e.g. Gruppo Everest's custom demo layout) it
// renders exactly like the old static ZoneLabel — header always shown, content
// always open — so that tenant is untouched.
export default function CollapsibleSection({
  title,
  accent = "var(--brand, #c9a83a)",
  defaultOpen = true,
  collapsible = true,
  children,
}: {
  title: string;
  accent?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const header = (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-1.5 h-5 rounded-full" style={{ background: `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 55%, white))` }} />
      <h2 className="text-[14px] font-extrabold uppercase" style={{ color: C.textPrimary, letterSpacing: "0.14em" }}>{title}</h2>
      <span className="flex-1 h-px" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 38%, transparent), transparent)` }} />
      {collapsible && (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md" style={{ color: C.textMuted }}>
          <ChevronDown size={16} style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s" }} />
        </span>
      )}
    </div>
  );

  if (!collapsible) return <>{header}{children}</>;

  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left cursor-pointer" aria-expanded={open}>
        {header}
      </button>
      {open && children}
    </>
  );
}
