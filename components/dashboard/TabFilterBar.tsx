"use client";

// Per-tab chip-dropdown filter bar. Lives INSIDE a tab section (Campaigns /
// Channels / Sellers) and exposes only the filter dropdowns that make sense
// for that tab. URL params (?campaigns=...|...&icps=...&sellers=...) are
// global because the data layer already uses them — this component just
// surfaces them in the right context so the user knows what's filtering
// what.
//
// Optimistic snapshot pattern: chip flips ON instantly, server re-render
// happens in startTransition. Boss flagged on 2026-05-27 that the previous
// global bar's chips felt sluggish; this restores instant feedback while
// the per-tab placement gives the filters visible relevance.

import { useEffect, useState, useTransition, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, ChevronDown, X } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type FilterOption = { id: string; label: string };

export default function TabFilterBar({
  campaigns,
  icps,
  sellers,
  labels,
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
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Optimistic snapshot — see FiltersBar.tsx for the pattern.
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

  function apply(mutate: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    setOptimistic(next);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `?${qs}` : "?", { scroll: false }));
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
      <div className="flex items-center gap-1.5 pl-1 pr-1" style={{ color: C.textMuted }}>
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
        {label}
        {value.length > 0 && (
          <span className="ml-0.5 text-[9.5px] font-bold tabular-nums px-1 py-0 rounded"
            style={{ backgroundColor: gold, color: "#04070d" }}>
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
                <button
                  key={it.id}
                  type="button"
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
