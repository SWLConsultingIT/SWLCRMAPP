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
import { useEffect, useState, useTransition } from "react";
import { C, N } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type ChapterItem = { id: string; number: number; label: string };

export default function ChapterNav({
  items,
  actions,
}: {
  items: ChapterItem[];
  /** Right-side slot — typically the freshness chip + a primary CTA. The
   * tab bar is the most prominent surface on the dashboard, so action
   * buttons that pair with the active chapter (Download PDF, Refresh chip,
   * etc) live here instead of in a separate header strip. */
  actions?: React.ReactNode;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Optimistic tab snapshot — clicking switches the highlight INSTANTLY
  // (no waiting on the server-side re-render to settle the URL). Cleared
  // once the real URL catches up. Same pattern as FiltersBar.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const urlTab = params.get("tab") || items[0]?.id || "";
  const activeId = optimistic ?? urlTab;
  useEffect(() => {
    if (optimistic && urlTab === optimistic) setOptimistic(null);
  }, [urlTab, optimistic]);

  function goTo(id: string) {
    setOptimistic(id);
    const next = new URLSearchParams(params.toString());
    if (id === items[0]?.id) next.delete("tab"); else next.set("tab", id);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `?${qs}` : "?", { scroll: false }));
  }

  if (items.length < 2) return null;

  return (
    <nav
      className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 flex items-center justify-between gap-3 relative"
      style={{
        backgroundColor: `color-mix(in srgb, ${C.card} 92%, transparent)`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.border}`,
      }}
      aria-label="Dashboard tabs"
    >
      {/* Pending indicator — same gold pulse used by FiltersBar so the user
          sees a consistent "data in flight" signal across both navigations. */}
      {pending && (
        <span
          aria-hidden
          className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden pointer-events-none"
        >
          <span
            className="block h-full"
            style={{
              width: "30%",
              background: `linear-gradient(90deg, transparent, ${gold} 50%, transparent)`,
              animation: "swl-filter-pulse 0.9s linear infinite",
            }}
          />
        </span>
      )}
      <div className="flex items-stretch gap-1 overflow-x-auto flex-1 min-w-0">
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
      {actions && (
        <div className="shrink-0 flex items-center gap-2 pr-1">
          {actions}
        </div>
      )}
    </nav>
  );
}
