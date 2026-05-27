"use client";

// Sticky filter strip at the top of the dashboard. The whole page is
// server-rendered, so changes here push to the URL — the server reads
// ?from / ?to / ?campaigns / ?icps / ?sellers and the rest of the page
// re-renders against the filtered slice.
//
// Speed pass (boss feedback 2026-05-27): the filter chip ABSOLUTELY MUST
// look active the instant the user clicks, not after the server roundtrip
// completes. We hold an optimistic snapshot of the desired URL params in
// local state; the chip's "on" state reads from optimistic state first,
// falling back to the actual URL. As soon as React commits the new URL
// (transition ends), the optimistic state clears and the real URL takes
// over. Result: instant visual feedback + still a single source of truth.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, X, Filter } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

type Option = { id: string; label: string };

const PERIODS = [
  { id: "7d",  labelKey: "dashx.filters.7d",  days: 7 },
  { id: "30d", labelKey: "dashx.filters.30d", days: 30 },
  { id: "90d", labelKey: "dashx.filters.90d", days: 90 },
  { id: "all", labelKey: "dashx.filters.all", days: null as number | null },
];

function toIsoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function FiltersBar({
  options,
}: {
  options: { campaigns: Option[]; sellers: Option[]; icps: Option[] };
}) {
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
    if (!currentFrom && !currentTo) return "30d";
    if (currentFrom && currentTo) {
      const days = Math.round((new Date(currentTo).getTime() - new Date(currentFrom).getTime()) / 86_400_000);
      const m = PERIODS.find(p => p.days === days);
      return m ? m.id : "custom";
    }
    return "custom";
  })();

  const selectedCampaigns = effective.get("campaigns")?.split("|").filter(Boolean) ?? [];
  const selectedIcps      = effective.get("icps")?.split("|").filter(Boolean) ?? [];
  const selectedSellers   = effective.get("sellers")?.split("|").filter(Boolean) ?? [];

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

  function setParam(key: string, value: string | null) {
    apply(p => {
      if (value && value.length > 0) p.set(key, value); else p.delete(key);
    });
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

  function toggleMulti(key: "campaigns" | "icps" | "sellers", id: string) {
    const current = key === "campaigns" ? selectedCampaigns : key === "icps" ? selectedIcps : selectedSellers;
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    setParam(key, next.length > 0 ? next.join("|") : null);
  }

  const anyFilter = selectedCampaigns.length + selectedIcps.length + selectedSellers.length > 0;

  function clearAll() {
    apply(p => { for (const k of Array.from(p.keys())) p.delete(k); });
  }

  return (
    <div
      className="sticky top-2 z-20 rounded-2xl border px-3 py-2 flex items-center gap-2 flex-wrap relative"
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

      <div className="w-px h-5 mx-1" style={{ backgroundColor: C.border }} />

      <MultiSelect label={t("dashx.filters.campaigns")} items={options.campaigns} value={selectedCampaigns}
        onToggle={id => toggleMulti("campaigns", id)} emptyLabel={t("dashx.filters.noOptions")} />
      <MultiSelect label={t("dashx.filters.icps")} items={options.icps} value={selectedIcps}
        onToggle={id => toggleMulti("icps", id)} emptyLabel={t("dashx.filters.noOptions")} />
      <MultiSelect label={t("dashx.filters.sellers")} items={options.sellers} value={selectedSellers}
        onToggle={id => toggleMulti("sellers", id)} emptyLabel={t("dashx.filters.noOptions")} />

      {anyFilter && (
        <button onClick={clearAll}
          className="ml-auto text-[11px] font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1 transition-colors hover:bg-black/[0.04]"
          style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
          <X size={11} /> {t("dashx.filters.clear")}
        </button>
      )}
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

function MultiSelect({
  label, items, value, onToggle, emptyLabel,
}: {
  label: string;
  items: Option[];
  value: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 transition-colors"
        style={{
          backgroundColor: value.length > 0 ? `color-mix(in srgb, ${gold} 12%, transparent)` : "transparent",
          borderColor: value.length > 0 ? `color-mix(in srgb, ${gold} 35%, transparent)` : C.border,
          color: value.length > 0 ? gold : C.textBody,
        }}
      >
        <Filter size={11} />
        {label}
        {value.length > 0 && (
          <span className="ml-0.5 text-[10px] font-bold tabular-nums px-1 py-0 rounded"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            {value.length}
          </span>
        )}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 z-50 rounded-lg border shadow-lg min-w-[220px] max-h-[320px] overflow-y-auto py-1"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}>
            {items.length === 0 ? (
              <div className="px-3 py-3 text-xs" style={{ color: C.textMuted }}>{emptyLabel}</div>
            ) : items.map(it => {
              const on = value.includes(it.id);
              return (
                <button
                  key={it.id}
                  onClick={() => onToggle(it.id)}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors hover:bg-black/[0.04]"
                >
                  <span className="w-4 h-4 rounded border flex items-center justify-center shrink-0"
                    style={{ backgroundColor: on ? gold : "transparent", borderColor: on ? gold : C.border }}>
                    {on && <span className="text-[#04070d] font-bold leading-none" style={{ fontSize: 9 }}>✓</span>}
                  </span>
                  <span className="truncate" style={{ color: C.textBody }}>{it.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
