"use client";

// Linear-style keyboard shortcuts scoped to the dashboard surface.
// Listens at document-level for unmodified keys so it never fights with
// the browser's chrome (Cmd+R stays as browser refresh; we use plain R).
//
// Active shortcuts:
//   R         → soft refresh
//   /         → focus the global Ask anything... search bar
//   ?         → toggle the cheatsheet overlay
//   G 1..5    → two-key sequence: G then 1..5 to switch the dashboard
//               tab (1=overview, 2=icps, 3=campaigns, 4=channels,
//               5=sellers). Dashboard is now tab-driven; the shortcut
//               updates `?tab=` instead of scrolling.
//
// All shortcuts are suppressed when focus is in an editable field
// (input/textarea/[contenteditable]) so typing into a filter or note
// never accidentally fires R as "refresh".

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const tabByDigit: Record<string, string> = {
  "1": "overview",
  "2": "icps",
  "3": "campaigns",
  "4": "channels",
  "5": "sellers",
};

export default function DashboardKeyboardShortcuts() {
  const router = useRouter();
  const params = useSearchParams();
  // Tracks whether the user is mid-"G _" sequence. Cleared after 1.5s so
  // a stray G doesn't trap the next keystroke.
  const gArmed = useRef<{ active: boolean; clearAt: number }>({ active: false, clearAt: 0 });

  useEffect(() => {
    function inEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function goToTab(id: string) {
      const next = new URLSearchParams(params.toString());
      if (id === "overview") next.delete("tab"); else next.set("tab", id);
      const qs = next.toString();
      router.push(qs ? `?${qs}` : "?");
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inEditable(e.target)) return;

      const k = e.key.toLowerCase();
      const now = Date.now();
      const gActive = gArmed.current.active && now < gArmed.current.clearAt;

      // Inside an armed "G _" sequence — a digit 1..5 selects a tab.
      if (gActive && tabByDigit[k]) {
        e.preventDefault();
        goToTab(tabByDigit[k]);
        gArmed.current = { active: false, clearAt: 0 };
        return;
      }
      // Any other key (or expired window) clears the G state.
      gArmed.current = { active: false, clearAt: 0 };

      if (k === "g") {
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
  }, [router, params]);

  return null;
}
