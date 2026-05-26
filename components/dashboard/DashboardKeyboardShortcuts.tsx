"use client";

// Linear-style keyboard shortcuts scoped to the dashboard surface.
// Listens at document-level for unmodified keys so it never fights with
// the browser's chrome (Cmd+R stays as browser refresh; we use plain R).
//
// Active shortcuts:
//   R       → soft refresh (router.refresh — re-fetches server data
//             without losing client state, so this is the right key to
//             pair with the live FreshnessChip)
//   /       → focus the global Ask anything... search bar (id provided
//             by TopHeader)
//   ?       → toggle the cheatsheet overlay (existing KeyboardCheatsheet
//             component if mounted — this hook just dispatches the event)
//
// All shortcuts are suppressed when focus is in an editable field
// (input/textarea/[contenteditable]) so typing into a filter or note
// never accidentally fires R as "refresh".

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function inEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      // No modifiers — these shortcuts compete with anything that uses
      // Cmd / Ctrl / Alt / Meta, so we bail when modifiers are pressed.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inEditable(e.target)) return;

      const k = e.key.toLowerCase();
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

  return null; // hooks-only, no rendered output
}
