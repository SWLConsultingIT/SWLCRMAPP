"use client";

// Unified dashboard filter bar — ONE line: Period · Campaign · ICPs · Sellers
// (boss 2026-06-08: "debería aparecer en una sola línea"). Rendered once at the
// top of every analytics tab; the URL params it writes (?from/?to,
// ?campaigns|?icps|?sellers) are global, so the data layer (lib/dashboard-data)
// filters every section against them. Replaces the old split of a period-only
// FiltersBar + a separate per-tab dropdown bar.
//
// Optimistic snapshot pattern: a chip flips ON instantly; the server re-render
// runs inside startTransition.

import { useEffect, useState, useTransition, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, ChevronDown, X, Calendar } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

export type FilterOption = { id: string; label: string };

const PERIODS = [
  { id: "today", labelKey: "dashx.filters.today", days: 0 },
  { id: "7d",    labelKey: "dashx.filters.7d",    days: 7 },
  { id: "30d",   labelKey: "dashx.filters.30d",   days: 30 },
  { id: "90d",   labelKey: "dashx.filters.90d",   days: 90 },
  { id: "all",   labelKey: "dashx.filters.all",   days: null as number | null },
];

function toIsoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function TabFilterBar({
  campaigns,
  icps,
  sellers,
  labels,
  showPeriod = false,
}: {
  /** When undefined, the dropdown is hidden. Pass an array (possibly empty)
   * to render the dropdown. */
  campaigns?: FilterOption[];
  icps?: FilterOption[];
  sellers?: FilterOption[];
  labels: {
    campaigns: string;
    icps: string;
    sellers: string;
    clear: string;
    empty: string;
    applied: string;
  };
  /** Render the Period control (7d/30d/90d/All + custom range) at the front. */
  showPeriod?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const { t } = useLocale();

  // Optimistic snapshot — chip flips ON before the server re-renders.
  const [optimistic, setOptimistic] = useState<URLSearchParams | null>(null);
  const effective = optimistic ?? params;
  useEffect(() => {
    if (optimistic && optimistic.toString() === params.toString()) {
      setOptimistic(null);
    }
  }, [params, optimistic]);

  const selCampaigns = effective.get("campaigns")?.split("|").filter(Boolean) ?? [];
  const selIcps      = effective.get("icps")?.split("|").filter(Boolean) ?? [];
  const selSellers   = effective.get("sellers")?.split("|").filter(Boolean) ?? [];

  const currentFrom = effective.get("from");
  const currentTo   = effective.get("to");
  const activePeriod = (() => {
    if (!currentFrom && !currentTo) return "all";
    if (currentFrom && currentTo) {
      const todayIso = toIsoDay(new Date());
      if (currentFrom === todayIso && currentTo === todayIso) return "today";
      const days = Math.round((new Date(currentTo).getTime() - new Date(currentFrom).getTime()) / 86_400_000);
      const m = PERIODS.find(p => p.days !== null && p.days > 0 && p.days === days);
      return m ? m.id : "custom";
    }
    return "custom";
  })();

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
      else if (p.days === 0) {
        const today = toIsoDay(new Date());
        next.set("from", today);
        next.set("to", today);
      } else {
        const to = new Date();
        const from = new Date(Date.now() - p.days * 86_400_000);
        next.set("from", from.toISOString().slice(0, 10));
        next.set("to", to.toISOString().slice(0, 10));
      }
    });
  }

  function toggleMulti(key: "campaigns" | "icps" | "sellers", id: string) {
    const current = key === "campaigns" ? selCampaigns : key === "icps" ? selIcps : selSellers;
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    apply(p => {
      if (next.length > 0) p.set(key, next.join("|"));
      else p.delete(key);
    });
  }

  const totalSelected = selCampaigns.length + selIcps.length + selSellers.length;

  function clearAll() {
    apply(p => {
      p.delete("campaigns");
      p.delete("icps");
      p.delete("sellers");
    });
  }

  return (
    <div className="relative rounded-xl border px-3 py-2 flex items-center gap-2 flex-wrap"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      {pending && (
        <span aria-hidden className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden pointer-events-none">
          <span className="block h-full" style={{
            width: "30%",
            background: `linear-gradient(90deg, transparent, ${gold} 50%, transparent)`,
            animation: "tab-filter-pulse 0.9s linear infinite",
          }} />
          <style>{`@keyframes tab-filter-pulse { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
        </span>
      )}

      {showPeriod && (
        <>
          <div className="flex items-center gap-1.5 pl-1" style={{ color: C.textMuted }}>
            <Calendar size={12} />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider">{t("dashx.filters.period")}</span>
          </div>
          <div className="flex items-center gap-1">
            {PERIODS.map(p => {
              const on = activePeriod === p.id;
              return (
                <button key={p.id} onClick={() => setPeriod(p.id)} type="button"
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors"
                  style={{
                    backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
                    borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
                    color: on ? gold : C.textBody,
                  }}>
                  {t(p.labelKey)}
                </button>
              );
            })}
            <CustomPeriodChip
              activePeriod={activePeriod}
              currentFrom={currentFrom}
              currentTo={currentTo}
              onApply={(from, to) => apply(next => { next.set("from", from); next.set("to", to); })}
              customLabel={t("dashx.filters.custom")}
              applyLabel={t("dashx.filters.applyCustom")}
              fromLabel={t("dashx.filters.from")}
              toLabel={t("dashx.filters.to")}
            />
          </div>
          <span className="w-px h-5 mx-0.5" style={{ backgroundColor: C.border }} />
        </>
      )}

      <div className="flex items-center gap-1.5 pl-0.5" style={{ color: C.textMuted }}>
        <Filter size={12} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider">{labels.applied}</span>
      </div>

      {campaigns !== undefined && (
        <Dropdown label={labels.campaigns} items={campaigns} value={selCampaigns}
          onToggle={id => toggleMulti("campaigns", id)} emptyLabel={labels.empty} />
      )}
      {icps !== undefined && (
        <Dropdown label={labels.icps} items={icps} value={selIcps}
          onToggle={id => toggleMulti("icps", id)} emptyLabel={labels.empty} />
      )}
      {sellers !== undefined && (
        <Dropdown label={labels.sellers} items={sellers} value={selSellers}
          onToggle={id => toggleMulti("sellers", id)} emptyLabel={labels.empty} />
      )}

      {totalSelected > 0 && (
        <button onClick={clearAll} type="button"
          className="ml-auto text-[10.5px] font-medium px-2 py-0.5 rounded-md inline-flex items-center gap-1 transition-colors hover:bg-black/[0.04]"
          style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
          <X size={10} /> {labels.clear}
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
  const today = toIsoDay(new Date());
  const monthAgo = toIsoDay(new Date(Date.now() - 30 * 86_400_000));
  const [from, setFrom] = useState<string>(currentFrom ?? monthAgo);
  const [to, setTo] = useState<string>(currentTo ?? today);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (currentFrom) setFrom(currentFrom);
    if (currentTo) setTo(currentTo);
  }, [currentFrom, currentTo]);

  function fmt(iso: string) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }
  const chipLabel = on && currentFrom && currentTo ? `${fmt(currentFrom)} — ${fmt(currentTo)}` : customLabel;
  const valid = from && to && new Date(from) <= new Date(to);

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors inline-flex items-center gap-1"
        style={{
          backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
          borderColor: on ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border,
          color: on ? gold : C.textBody,
        }}>
        <Calendar size={11} />
        {chipLabel}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1.5 z-50 rounded-lg border shadow-lg p-3 min-w-[280px]"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{fromLabel}</span>
                <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}
                  className="text-[12px] px-2.5 py-1.5 rounded-md border" style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textPrimary }} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{toLabel}</span>
                <input type="date" value={to} min={from || undefined} max={toIsoDay(new Date())} onChange={e => setTo(e.target.value)}
                  className="text-[12px] px-2.5 py-1.5 rounded-md border" style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textPrimary }} />
              </label>
              <button type="button" disabled={!valid}
                onClick={() => { if (!valid) return; onApply(from, to); setOpen(false); }}
                className="mt-1 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-opacity"
                style={{
                  background: valid ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))` : C.surface,
                  color: valid ? "#04070d" : C.textDim,
                  cursor: valid ? "pointer" : "not-allowed",
                  opacity: valid ? 1 : 0.6,
                }}>
                {applyLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Dropdown({
  label, items, value, onToggle, emptyLabel,
}: {
  label: string;
  items: FilterOption[];
  value: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 transition-colors"
        style={{
          backgroundColor: value.length > 0 ? `color-mix(in srgb, ${gold} 12%, transparent)` : "transparent",
          borderColor: value.length > 0 ? `color-mix(in srgb, ${gold} 35%, transparent)` : C.border,
          color: value.length > 0 ? gold : C.textBody,
        }}>
        {label}
        {value.length > 0 && (
          <span className="ml-0.5 text-[9.5px] font-bold tabular-nums px-1 py-0 rounded" style={{ backgroundColor: gold, color: "#04070d" }}>
            {value.length}
          </span>
        )}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 z-40 rounded-lg border shadow-lg min-w-[240px] max-h-[320px] overflow-y-auto py-1"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}>
            {items.length === 0 ? (
              <div className="px-3 py-3 text-xs" style={{ color: C.textMuted }}>{emptyLabel}</div>
            ) : items.map(it => {
              const on = value.includes(it.id);
              return (
                <button key={it.id} type="button" onClick={() => onToggle(it.id)}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors hover:bg-black/[0.04]">
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
