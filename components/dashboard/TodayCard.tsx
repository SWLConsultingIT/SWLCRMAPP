// "What to do today" — the dashboard's narrative opener. Replaces the
// giant HeroStat as the top of Overview. Story-mode design (boss feedback
// 2026-05-27): start with action items, not vanity metrics. Each row is
// a clickable deep-link into the surface where the work happens.
//
// Layout: compact card (~120-150px), 2-col grid of action rows on desktop
// and stacked single-col on mobile. Gold accent eyebrow + subtle navy
// hover state to signal interactivity without screaming.

import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { C, N, T } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type TodayAction = {
  /** Big number / metric the row is built around (e.g. "12"). */
  value: number | string;
  /** Short imperative label — "Replies need review", "Leads to assign". */
  label: string;
  /** One-line context underneath. Keep it scannable. */
  hint?: string;
  /** Deep link target. */
  href: string;
  /** Icon for the left rail. */
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  /** Accent color — drives the icon background + number tint. */
  accent: string;
  /** Render even when value === 0. Defaults to true for state cohorts,
   *  false for in-flight counters where 0 = "nothing to act on". */
  showWhenEmpty?: boolean;
};

export default function TodayCard({
  title,
  emptyText,
  actions,
}: {
  title: string;
  emptyText: string;
  actions: TodayAction[];
}) {
  const visible = actions.filter(a => a.showWhenEmpty || (typeof a.value === "number" ? a.value > 0 : a.value));

  return (
    <section
      className="rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
        boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 14%, transparent)`,
      }}
    >
      {/* Header strip — gold-tinted to mark this as the action belt */}
      <div
        className="px-4 py-2 flex items-center gap-2 border-b"
        style={{
          borderColor: C.border,
          background: `linear-gradient(90deg, color-mix(in srgb, ${gold} 8%, ${C.card}) 0%, ${C.card} 60%)`,
        }}
      >
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`,
            color: N.ink,
            boxShadow: `0 2px 6px color-mix(in srgb, ${gold} 28%, transparent)`,
          }}
        >
          <Sparkles size={11} />
        </span>
        <p className={`${T.label}`} style={{ color: C.textPrimary }}>
          {title}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-5 text-center text-[12.5px]" style={{ color: C.textMuted }}>
          {emptyText}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: C.border }}>
          {visible.map((a, i) => {
            const Icon = a.icon;
            return (
              <Link
                key={i}
                href={a.href}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.025]"
              >
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${a.accent} 14%, transparent)`,
                    color: a.accent,
                  }}
                >
                  <Icon size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="flex items-baseline gap-1.5">
                    <span
                      className="text-[22px] font-bold tabular-nums leading-none tracking-[-0.02em]"
                      style={{ color: a.accent, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
                    >
                      {a.value}
                    </span>
                    <span className="text-[13px] font-semibold leading-tight" style={{ color: C.textPrimary }}>
                      {a.label}
                    </span>
                  </p>
                  {a.hint && (
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: C.textDim }}>
                      {a.hint}
                    </p>
                  )}
                </div>
                <ArrowUpRight
                  size={14}
                  className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  style={{ color: C.textDim }}
                />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
