"use client";

// Sticky mini-nav of the dashboard chapters. Tracks scroll position and
// highlights the chapter currently in view. Click jumps to that chapter
// (uses the id of each <Chapter> divider). Linear/Stripe docs pattern.
//
// Renders as a thin pill bar above the dashboard content. On mobile (very
// narrow) it hides itself — the chapter dividers already give the same
// orientation as the user scrolls.

import { useEffect, useState } from "react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type ChapterItem = { id: string; number: number; label: string };

export default function ChapterNav({ items }: { items: ChapterItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    // IntersectionObserver tracks which Chapter divider is currently
    // intersecting the top band of the viewport. The first match wins
    // because we observe in DOM order.
    const observed = items
      .map(it => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (observed.length === 0) return;

    const onSeen: IntersectionObserverCallback = (entries) => {
      // Pick the highest visible entry — the topmost chapter in view.
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    };

    // Top band detection: the trigger zone is the top 20% of viewport.
    const io = new IntersectionObserver(onSeen, {
      rootMargin: "0px 0px -80% 0px",
      threshold: 0,
    });
    observed.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <nav
      className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 hidden sm:flex items-center gap-1.5 overflow-x-auto"
      style={{
        backgroundColor: `color-mix(in srgb, ${C.card} 92%, transparent)`,
        backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${C.border}`,
      }}
      aria-label="Dashboard chapters"
    >
      {items.map(it => {
        const on = active === it.id;
        return (
          <a
            key={it.id}
            href={`#${it.id}`}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            style={{
              backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
              borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
              color: on ? gold : C.textBody,
            }}
            onClick={() => setActive(it.id)}
          >
            <span className="tabular-nums opacity-70 text-[9.5px]">
              {String(it.number).padStart(2, "0")}
            </span>
            <span>{it.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
