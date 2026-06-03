"use client";

import { useState } from "react";
import { ClipboardList, ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

// AI pre-call brief, surfaced inline inside the call card. A visible toggle
// (only present when the lead has talking points) expands the Pain / Fit /
// Opener points in place — no floating popover that overlaps neighbouring rows.

type Point = string | { type: "pain" | "fit" | "opener"; text: string };

export default function PreCallBrief({ talkingPoints }: { talkingPoints: Point[] | null }) {
  const [open, setOpen] = useState(false);
  if (!talkingPoints || talkingPoints.length === 0) return null;

  return (
    <div className="px-5 pb-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors"
        style={{
          color: "var(--brand, #c9a83a)",
          borderColor: open ? "color-mix(in srgb, var(--brand, #c9a83a) 45%, transparent)" : C.border,
          backgroundColor: open ? "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)" : C.card,
        }}
      >
        <ClipboardList size={12} /> Pre-call brief
        <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div className="mt-2 rounded-xl border p-3.5" style={{ backgroundColor: C.bg, borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)" }}>
          <ol className="space-y-2">
            {talkingPoints.map((p, i) => {
              const structured = typeof p === "object" && p !== null && "type" in p;
              const label = structured ? (p.type === "pain" ? "Pain" : p.type === "fit" ? "Fit" : "Opener") : `${i + 1}.`;
              const labelColor = structured ? (p.type === "pain" ? "#B91C1C" : p.type === "fit" ? "#1D4ED8" : "#B45309") : "var(--brand, #c9a83a)";
              const text = typeof p === "string" ? p : p.text;
              return (
                <li key={i}>
                  <span className="text-[9px] font-bold uppercase tracking-wider mr-1.5" style={{ color: labelColor, letterSpacing: "0.06em" }}>{label}</span>
                  <span className="text-[11px] leading-snug" style={{ color: C.textPrimary }}>{text}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
