"use client";

// Dashboard tab bar — URL-driven tabs that swap the active chapter via
// `?tab=overview|icps|campaigns|channels|sellers`. Replaces the prior
// scroll-anchor model: today each tab renders only its own content
// (server-side) instead of stacking everything on a single page.
//
// Active state is read from the URL; clicks push a new URL preserving
// every other filter (period, campaigns, icps, sellers). Inactive tabs
// look muted with a counter pill; active tab gets a gold underline +
// glow + bold label.

import { useSearchParams, useRouter } from "next/navigation";
import { useTransition } from "react";
import { C, N } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type ChapterItem = { id: string; number: number; label: string };

export default function ChapterNav({ items }: { items: ChapterItem[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const activeId = params.get("tab") || items[0]?.id || "";

  function goTo(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === items[0]?.id) next.delete("tab"); else next.set("tab", id);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `?${qs}` : "?"));
  }

  if (items.length < 2) return null;

  return (
    <nav
      className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6"
      style={{
        backgroundColor: `color-mix(in srgb, ${C.card} 92%, transparent)`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.border}`,
        opacity: pending ? 0.75 : 1,
        transition: "opacity 150ms",
      }}
      aria-label="Dashboard tabs"
    >
      <div className="flex items-stretch gap-1 overflow-x-auto">
        {items.map(it => {
          const on = activeId === it.id;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => goTo(it.id)}
              className="relative inline-flex items-center gap-2.5 px-3 sm:px-4 py-3 whitespace-nowrap group transition-colors"
              style={{
                color: on ? C.textPrimary : C.textMuted,
              }}
            >
              {/* Counter pill — ordinal in a tiny dark navy capsule when
                  active, ghost outline when inactive. */}
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
              {/* Gold underline — primary active state signal */}
              <span
                aria-hidden
                className="absolute left-3 right-3 bottom-0 h-[2.5px] rounded-t-full transition-opacity"
                style={{
                  background: `linear-gradient(90deg, ${gold} 0%, color-mix(in srgb, ${gold} 60%, transparent) 100%)`,
                  opacity: on ? 1 : 0,
                  boxShadow: on ? `0 0 12px color-mix(in srgb, ${gold} 38%, transparent)` : "none",
                }}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
