"use client";

// Linear-style keyboard shortcuts scoped to the dashboard surface.
// Listens at document-level for unmodified keys so it never fights with
// the browser's chrome (Cmd+R stays as browser refresh; we use plain R).
//
// Active shortcuts:
//   R         → soft refresh (router.refresh — re-fetches server data
//               without losing client state, so this is the right key to
//               pair with the live FreshnessChip)
//   /         → focus the global Ask anything... search bar
//   ?         → toggle the cheatsheet overlay
//   G 1..5    → two-key sequence: G then 1..5 to jump to a chapter
//               (1=overview, 2=icps, 3=campaigns, 4=channels, 5=sellers).
//               Mirrors Linear's "G I" navigation, scoped to the dashboard.
//
// All shortcuts are suppressed when focus is in an editable field
// (input/textarea/[contenteditable]) so typing into a filter or note
// never accidentally fires R as "refresh".

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const chapterByDigit: Record<string, string> = {
  "1": "overview",
  "2": "icps",
  "3": "campaigns",
  "4": "channels",
  "5": "sellers",
};

export default function DashboardKeyboardShortcuts() {
  const router = useRouter();
  // Tracks whether the user is mid-"G _" sequence. Cleared after 1.5s so
  // a stray G doesn't trap the next keystroke. Ref instead of state — we
  // never re-render based on this flag.
  const gArmed = useRef<{ active: boolean; clearAt: number }>({ active: false, clearAt: 0 });

  useEffect(() => {
    function inEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function scrollToChapter(id: string) {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Replace the hash without an additional scroll jump (smooth scroll
      // is doing that for us). This keeps the address bar reflective of
      // the current chapter — Shareable + reload-stable.
      try { history.replaceState(null, "", `#${id}`); } catch { /* noop */ }
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inEditable(e.target)) return;

      const k = e.key.toLowerCase();
      const now = Date.now();
      const gActive = gArmed.current.active && now < gArmed.current.clearAt;

      // Inside an armed "G _" sequence — a digit 1..5 selects a chapter.
      if (gActive && chapterByDigit[k]) {
        e.preventDefault();
        scrollToChapter(chapterByDigit[k]);
        gArmed.current = { active: false, clearAt: 0 };
        return;
      }
      // Any other key (or expired window) clears the G state.
      gArmed.current = { active: false, clearAt: 0 };

      if (k === "g") {
        // Arm a 1.5s window for a digit; do not preventDefault so any
        // remapping of G stays innocuous if no digit follows.
        gArmed.current = { active: true, clearAt: now + 1500 };
        return;
      }
      if (k === "r") {
        e.preventDefault();
        router.refresh();
      } else if (k === "/") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>("[data-global-search]");
        input?.focus();
      } else if (k === "?") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("swl:show-shortcuts"));
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
