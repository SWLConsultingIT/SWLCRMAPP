"use client";

// Sticky mini-nav of the dashboard chapters. Underline pattern (Linear /
// Vercel docs): the active chapter gets a thick gold underline + bold gold
// label; inactive chapters fade to muted with the ordinal as a thin counter
// pill. Tracks scroll via IntersectionObserver and updates the active state
// as the user moves through the page.
//
// Hidden on narrow mobile — chapters give the same orientation naturally on
// a long scroll.

import { useEffect, useState } from "react";
import { C, N } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type ChapterItem = { id: string; number: number; label: string };

export default function ChapterNav({ items }: { items: ChapterItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const observed = items
      .map(it => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (observed.length === 0) return;

    const onSeen: IntersectionObserverCallback = (entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    };

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
      className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 hidden sm:block"
      style={{
        backgroundColor: `color-mix(in srgb, ${C.card} 88%, transparent)`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.border}`,
      }}
      aria-label="Dashboard chapters"
    >
      <div className="flex items-stretch gap-1 overflow-x-auto">
        {items.map(it => {
          const on = active === it.id;
          return (
            <a
              key={it.id}
              href={`#${it.id}`}
              className="relative inline-flex items-center gap-2.5 px-3 sm:px-4 py-3 whitespace-nowrap group transition-colors"
              style={{
                color: on ? C.textPrimary : C.textMuted,
              }}
              onClick={() => setActive(it.id)}
            >
              {/* Counter pill — ordinal in a tiny dark navy capsule when active,
                  ghost outline when inactive. Brings dark contrast right next
                  to gold so the active state really pops. */}
              <span
                className="text-[9.5px] font-bold tabular-nums tracking-[0.08em] px-1.5 py-[2px] rounded-md transition-colors"
                style={{
                  backgroundColor: on ? N.ink : "transparent",
                  color: on ? "#E6C661" : C.textDim,
                  border: on ? "none" : `1px solid ${C.border}`,
                }}
              >
                {String(it.number).padStart(2, "0")}
              </span>
              <span
                className="text-[12.5px] font-semibold tracking-[-0.005em]"
                style={{ color: on ? C.textPrimary : C.textMuted }}
              >
                {it.label}
              </span>
              {/* Gold underline — the primary active-state signal */}
              <span
                aria-hidden
                className="absolute left-3 right-3 bottom-0 h-[2.5px] rounded-t-full transition-opacity"
                style={{
                  background: `linear-gradient(90deg, ${gold} 0%, color-mix(in srgb, ${gold} 60%, transparent) 100%)`,
                  opacity: on ? 1 : 0,
                  boxShadow: on ? `0 0 12px color-mix(in srgb, ${gold} 38%, transparent)` : "none",
                }}
              />
            </a>
          );
        })}
      </div>
    </nav>
  );
}
