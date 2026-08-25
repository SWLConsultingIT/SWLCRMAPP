"use client";

// Linear-style keyboard shortcuts scoped to the dashboard surface.
// Listens at document-level for unmodified keys so it never fights with
// the browser's chrome (Cmd+R stays as browser refresh; we use plain R).
//
// Active shortcuts:
//   R         → soft refresh
//   /         → focus the global Ask anything... search bar
//   ?         → toggle the cheatsheet overlay
//   G 1..6    → two-key sequence: G then 1..6 to switch the dashboard tab.
//               The digits match the numbers PRINTED on the tab pills
//               (01 Today … 06 Sellers). They used to be off by one —
//               the pills read 01=Today but G+1 jumped to Overview.
//               Switching is local state now (see DashboardTabs), so the
//               shortcut is instant instead of triggering a full re-render.
//
// All shortcuts are suppressed when focus is in an editable field
// (input/textarea/[contenteditable]) so typing into a filter or note
// never accidentally fires R as "refresh".

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDashboardTab, CLIENT_TABS } from "@/components/dashboard/DashboardTabs";

// "1" → CLIENT_TABS[0] ("today"), "2" → "overview", … "6" → "sellers".
const tabByDigit: Record<string, string> = Object.fromEntries(
  CLIENT_TABS.map((id, i) => [String(i + 1), id]),
);

export default function DashboardKeyboardShortcuts() {
  const router = useRouter();
  const { setTab } = useDashboardTab();
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

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inEditable(e.target)) return;

      const k = e.key.toLowerCase();
      const now = Date.now();
      const gActive = gArmed.current.active && now < gArmed.current.clearAt;

      // Inside an armed "G _" sequence — a digit 1..6 selects a tab.
      if (gActive && tabByDigit[k]) {
        e.preventDefault();
        setTab(tabByDigit[k]);
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
  }, [router, setTab]);

  return null;
}
