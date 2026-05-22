"use client";

import { useEffect, useState } from "react";
import { X, Keyboard } from "lucide-react";
import { C } from "@/lib/design";

// Global keyboard-shortcuts cheatsheet. Mounted once at app shell level.
// Trigger: ⌘+/ (or ?). Modal overlay listing every shortcut the app
// supports, grouped by surface. Linear/GitHub pattern — power users don't
// have to dig docs or trial-and-error.

type Section = {
  title: string;
  shortcuts: { keys: string[]; label: string }[];
};

const SECTIONS: Section[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["G", "D"], label: "Go to Dashboard" },
      { keys: ["G", "B"], label: "Go to Company Bio" },
      { keys: ["G", "N"], label: "Go to Notifications" },
      { keys: ["G", "I"], label: "Go to Lead Miner (ICPs)" },
      { keys: ["G", "O"], label: "Go to Outreach Flow (Campaigns)" },
      { keys: ["G", "L"], label: "Go to Leads & Campaigns" },
      { keys: ["G", "A"], label: "Go to Accounts" },
      { keys: ["G", "S"], label: "Go to Settings" },
    ],
  },
  {
    title: "Inbox",
    shortcuts: [
      { keys: ["J"], label: "Next reply" },
      { keys: ["K"], label: "Previous reply" },
      { keys: ["A"], label: "Mark current reply as reviewed" },
    ],
  },
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], label: "Open command palette (search anything)" },
      { keys: ["⌘", "/"], label: "Show this cheatsheet" },
      { keys: ["Esc"], label: "Close modals / dialogs" },
    ],
  },
  {
    title: "Lead list",
    shortcuts: [
      { keys: ["Click + Shift+Click"], label: "Select a range of leads" },
    ],
  },
];

export default function KeyboardCheatsheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const isInput = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (isInput) return;
      // ⌘+/  or  ?  → open
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setOpen(v => !v);
      } else if (e.key === "?") {
        e.preventDefault();
        setOpen(v => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="rounded-2xl border shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 64px -12px rgba(0,0,0,0.45)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)`, color: "var(--brand, #c9a83a)" }}>
              <Keyboard size={14} />
            </div>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              Keyboard Shortcuts
            </h2>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 hover:bg-black/[0.04] transition-colors" style={{ color: C.textMuted }}>
            <X size={14} />
          </button>
        </div>

        {/* Sections */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 p-5">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2.5" style={{ color: C.textMuted }}>
                {section.title}
              </p>
              <div className="space-y-1.5">
                {section.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-xs" style={{ color: C.textBody }}>{s.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums"
                          style={{
                            backgroundColor: C.bg,
                            borderColor: C.border,
                            color: C.textBody,
                            boxShadow: "0 1px 0 rgba(0,0,0,0.05)",
                            minWidth: 18,
                            textAlign: "center",
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t px-5 py-2.5 text-[10px]" style={{ borderColor: C.border, color: C.textDim }}>
          Press <kbd className="px-1 rounded border" style={{ borderColor: C.border, color: C.textBody }}>?</kbd> any time to re-open this list.
        </div>
      </div>
    </div>
  );
}
