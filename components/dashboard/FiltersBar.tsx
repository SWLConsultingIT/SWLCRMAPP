"use client";

// Sticky filter strip at the top of the dashboard. Period-only after the
// 2026-05-27 simplification: the campaign / icp / seller multi-selects
// were removed because they duplicated the click-into-row drill-down and
// added invisible state (user couldn't tell what was filtered). Drilling
// into a specific entity is now done by clicking it in its leaderboard.
//
// URL still parses ?campaigns / ?icps / ?sellers if present so old saved
// links don't break — the bar just doesn't expose UI to set them.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

const PERIODS = [
  { id: "7d",  labelKey: "dashx.filters.7d",  days: 7 },
  { id: "30d", labelKey: "dashx.filters.30d", days: 30 },
  { id: "90d", labelKey: "dashx.filters.90d", days: 90 },
  { id: "all", labelKey: "dashx.filters.all", days: null as number | null },
];

function toIsoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function FiltersBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const { t } = useLocale();

  // ── Optimistic params snapshot ─────────────────────────────────────────
  // Holds the *desired* URL params the moment the user clicks. The UI
  // reads its active state from here first, falling back to the real URL.
  // Cleared when the URL actually matches what we wanted, so we never
  // get stuck on stale optimistic state.
  const [optimistic, setOptimistic] = useState<URLSearchParams | null>(null);
  const effective = optimistic ?? params;

  useEffect(() => {
    // When the URL catches up to whatever we optimistically applied, drop
    // the snapshot. Compare by stringified params so a stable input keeps
    // the snapshot until React commits.
    if (optimistic && optimistic.toString() === params.toString()) {
      setOptimistic(null);
    }
  }, [params, optimistic]);

  const currentFrom = effective.get("from");
  const currentTo   = effective.get("to");
  const activePeriod = (() => {
    if (!currentFrom && !currentTo) return "all";
    if (currentFrom && currentTo) {
      const days = Math.round((new Date(currentTo).getTime() - new Date(currentFrom).getTime()) / 86_400_000);
      const m = PERIODS.find(p => p.days === days);
      return m ? m.id : "custom";
    }
    return "custom";
  })();

  /** Apply a builder to the current params and push immediately. The
   *  optimistic snapshot updates synchronously so the chip switches to
   *  "on" before the server has even started re-rendering. */
  function apply(mutate: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    setOptimistic(next);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `?${qs}` : "?", { scroll: false }));
  }

  function setPeriod(id: string) {
    const p = PERIODS.find(x => x.id === id);
    if (!p) return;
    apply(next => {
      if (p.days === null) { next.delete("from"); next.delete("to"); }
      else {
        const to = new Date();
        const from = new Date(Date.now() - p.days * 86_400_000);
        next.set("from", from.toISOString().slice(0, 10));
        next.set("to",   to.toISOString().slice(0, 10));
      }
    });
  }

  return (
    <div
      // ChapterNav above also uses sticky top-2 z-30 — the filter bar has to
      // stack BELOW it (top-[60px] clears the nav's height with a few px of
      // breathing room) and use a lower z so the chapter chips win when they
      // overlap. Boss flagged on 2026-05-27 that the date filter wasn't
      // reachable after scrolling.
      className="sticky top-[60px] z-20 rounded-2xl border px-3 py-2 flex items-center gap-2 flex-wrap relative"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Pending indicator — thin gold strip animates left-to-right at the
          top of the filter bar whenever a transition is in flight. Subtle
          enough not to distract, loud enough to tell the user "data on
          the way". */}
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
          <style>{`@keyframes swl-filter-pulse { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
        </span>
      )}
      <div className="flex items-center gap-1.5 pl-1 pr-1" style={{ color: C.textMuted }}>
        <Calendar size={13} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{t("dashx.filters.period")}</span>
      </div>
      <div className="flex items-center gap-1">
        {PERIODS.map(p => {
          const on = activePeriod === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors"
              style={{
                backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
                borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
                color: on ? gold : C.textBody,
              }}
            >
              {t(p.labelKey)}
            </button>
          );
        })}
        {/* Custom range — opens a popover with from/to date inputs. The
            popover writes ?from / ?to directly, so the dashboard re-renders
            against the picked window. Shows the picked range as the chip
            label when active (e.g. "12 Jun — 28 Jun") so the user always
            sees what window is in play. */}
        <CustomPeriodChip
          activePeriod={activePeriod}
          currentFrom={currentFrom}
          currentTo={currentTo}
          onApply={(from, to) => {
            apply(next => { next.set("from", from); next.set("to", to); });
          }}
          customLabel={t("dashx.filters.custom")}
          applyLabel={t("dashx.filters.applyCustom")}
          fromLabel={t("dashx.filters.from")}
          toLabel={t("dashx.filters.to")}
        />
      </div>

    </div>
  );
}

function CustomPeriodChip({
  activePeriod, currentFrom, currentTo, onApply,
  customLabel, applyLabel, fromLabel, toLabel,
}: {
  activePeriod: string;
  currentFrom: string | null;
  currentTo: string | null;
  onApply: (from: string, to: string) => void;
  customLabel: string;
  applyLabel: string;
  fromLabel: string;
  toLabel: string;
}) {
  const on = activePeriod === "custom";
  const [open, setOpen] = useState(false);
  // Initialize the inputs from the current URL window so the popover
  // opens onto what the user is already looking at — feels native.
  const today = toIsoDay(new Date());
  const monthAgo = toIsoDay(new Date(Date.now() - 30 * 86_400_000));
  const [from, setFrom] = useState<string>(currentFrom ?? monthAgo);
  const [to, setTo] = useState<string>(currentTo ?? today);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Sync local state with URL when the user picks a preset elsewhere.
  useEffect(() => {
    if (currentFrom) setFrom(currentFrom);
    if (currentTo) setTo(currentTo);
  }, [currentFrom, currentTo]);

  // Compact label — when custom is active, render the date span; otherwise
  // just show "Custom" so the operator knows the option exists.
  function fmt(iso: string) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }
  const chipLabel = on && currentFrom && currentTo
    ? `${fmt(currentFrom)} — ${fmt(currentTo)}`
    : customLabel;

  const valid = from && to && new Date(from) <= new Date(to);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors inline-flex items-center gap-1"
        style={{
          backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
          borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
          color: on ? gold : C.textBody,
        }}
      >
        <Calendar size={11} />
        {chipLabel}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 mt-1.5 z-50 rounded-lg border shadow-lg p-3 min-w-[280px]"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}
          >
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{fromLabel}</span>
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={e => setFrom(e.target.value)}
                  className="text-[12px] px-2.5 py-1.5 rounded-md border"
                  style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textPrimary }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{toLabel}</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  max={toIsoDay(new Date())}
                  onChange={e => setTo(e.target.value)}
                  className="text-[12px] px-2.5 py-1.5 rounded-md border"
                  style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textPrimary }}
                />
              </label>
              <button
                type="button"
                disabled={!valid}
                onClick={() => {
                  if (!valid) return;
                  onApply(from, to);
                  setOpen(false);
                }}
                className="mt-1 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-opacity"
                style={{
                  background: valid ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))` : C.surface,
                  color: valid ? "#04070d" : C.textDim,
                  cursor: valid ? "pointer" : "not-allowed",
                  opacity: valid ? 1 : 0.6,
                }}
              >
                {applyLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

