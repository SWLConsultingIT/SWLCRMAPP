"use client";

import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

// Inline glossary tooltip for product jargon like "ICP", "Sequence", "Step",
// "Cadence" etc. Underlines the term with a dotted accent so first-time users
// know it's explained on hover/focus. Uses native `title` for the screen-reader
// + mobile fallback and a styled popover for sighted desktop users.
//
// Usage:
//   <TermTooltip definition="Ideal Customer Profile — the segment you're targeting.">ICP</TermTooltip>
//
// If you want the tooltip to live next to the term (rather than wrap it), pass
// `iconOnly` and skip children:
//   ICP <TermTooltip iconOnly definition="..." />

type Props = {
  children?: ReactNode;
  definition: string;
  iconOnly?: boolean;
  /** Where the popover renders relative to the trigger. Default 'top'. */
  placement?: "top" | "bottom";
};

export default function TermTooltip({ children, definition, iconOnly = false, placement = "top" }: Props) {
  const [open, setOpen] = useState(false);

  if (iconOnly) {
    // Use a non-button <span role="button"> wrapper because TermTooltip is
    // often nested INSIDE another <button> (collapsible card headers, table
    // sort headers, etc.). HTML disallows nested <button> elements; the span
    // gives us the same hover/focus behaviour without the invalid markup
    // warning and stops the outer button's onClick from firing on tooltip
    // interactions.
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={definition}
        title={definition}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.stopPropagation(); e.preventDefault(); } }}
        className="relative inline-flex items-center justify-center rounded-full cursor-help focus:outline-none focus-visible:ring-1 ml-1"
        style={{ color: "var(--c-textDim, #94a3b8)" }}
      >
        <HelpCircle size={11} strokeWidth={2} />
        {open && <Popover text={definition} placement={placement} />}
      </span>
    );
  }

  return (
    <span className="relative inline">
      <span
        tabIndex={0}
        title={definition}
        aria-label={definition}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-help focus:outline-none focus-visible:ring-1 rounded-sm"
        style={{
          textDecoration: "underline dotted",
          textDecorationThickness: "1px",
          textUnderlineOffset: "3px",
          textDecorationColor: "color-mix(in srgb, var(--brand, #c9a83a) 70%, transparent)",
        }}
      >
        {children}
      </span>
      {open && <Popover text={definition} placement={placement} />}
    </span>
  );
}

function Popover({ text, placement }: { text: string; placement: "top" | "bottom" }) {
  return (
    <span
      role="tooltip"
      className="absolute z-50 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg text-[11px] font-normal leading-snug shadow-lg pointer-events-none whitespace-normal"
      style={{
        [placement === "top" ? "bottom" : "top"]: "calc(100% + 6px)",
        backgroundColor: "var(--c-textPrimary, #0f172a)",
        color: "#fff",
        maxWidth: 260,
        minWidth: 180,
        textAlign: "left",
      }}
    >
      {text}
    </span>
  );
}
