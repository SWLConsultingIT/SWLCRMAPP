"use client";

// Sticky filter strip at the top of the dashboard. The whole page is
// server-rendered, so changes here push to the URL via router.push() —
// the server reads ?from / ?to / ?campaigns / ?icps / ?sellers and the
// rest of the page re-renders against the filtered slice.

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, X, Filter } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Option = { id: string; label: string };

const PERIODS = [
  { id: "7d",  label: "7 días",  days: 7 },
  { id: "30d", label: "30 días", days: 30 },
  { id: "90d", label: "90 días", days: 90 },
  { id: "all", label: "Todo",    days: null as number | null },
];

export default function FiltersBar({
  options,
}: {
  options: { campaigns: Option[]; sellers: Option[]; icps: Option[] };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentFrom = params.get("from");
  const currentTo   = params.get("to");
  // Infer the active preset from the URL if it matches.
  const activePeriod = (() => {
    if (!currentFrom && !currentTo) return "30d";
    if (currentFrom && currentTo) {
      const days = Math.round((new Date(currentTo).getTime() - new Date(currentFrom).getTime()) / 86_400_000) + 1;
      const m = PERIODS.find(p => p.days === days);
      return m ? m.id : "custom";
    }
    return "custom";
  })();

  const selectedCampaigns = params.get("campaigns")?.split("|").filter(Boolean) ?? [];
  const selectedIcps      = params.get("icps")?.split("|").filter(Boolean) ?? [];
  const selectedSellers   = params.get("sellers")?.split("|").filter(Boolean) ?? [];

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value.length > 0) next.set(key, value); else next.delete(key);
    startTransition(() => router.push(`?${next.toString()}`));
  }

  function setPeriod(id: string) {
    const p = PERIODS.find(x => x.id === id);
    if (!p) return;
    const next = new URLSearchParams(params.toString());
    if (p.days === null) { next.delete("from"); next.delete("to"); }
    else {
      const to = new Date();
      const from = new Date(Date.now() - p.days * 86_400_000);
      next.set("from", from.toISOString().slice(0, 10));
      next.set("to",   to.toISOString().slice(0, 10));
    }
    startTransition(() => router.push(`?${next.toString()}`));
  }

  function toggleMulti(key: "campaigns" | "icps" | "sellers", id: string) {
    const current = key === "campaigns" ? selectedCampaigns : key === "icps" ? selectedIcps : selectedSellers;
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    setParam(key, next.length > 0 ? next.join("|") : null);
  }

  const anyFilter = selectedCampaigns.length + selectedIcps.length + selectedSellers.length > 0;

  function clearAll() {
    const next = new URLSearchParams();
    startTransition(() => router.push(next.toString() ? `?${next.toString()}` : "?"));
  }

  return (
    <div
      className="sticky top-2 z-20 rounded-2xl border px-3 py-2 flex items-center gap-2 flex-wrap"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
        backdropFilter: "blur(8px)",
        opacity: pending ? 0.7 : 1,
        transition: "opacity 150ms",
      }}
    >
      <div className="flex items-center gap-1.5 pl-1 pr-1" style={{ color: C.textMuted }}>
        <Calendar size={13} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Período</span>
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
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="w-px h-5 mx-1" style={{ backgroundColor: C.border }} />

      <MultiSelect label="Campañas" items={options.campaigns} value={selectedCampaigns}
        onToggle={id => toggleMulti("campaigns", id)} />
      <MultiSelect label="ICPs" items={options.icps} value={selectedIcps}
        onToggle={id => toggleMulti("icps", id)} />
      <MultiSelect label="Sellers" items={options.sellers} value={selectedSellers}
        onToggle={id => toggleMulti("sellers", id)} />

      {anyFilter && (
        <button onClick={clearAll}
          className="ml-auto text-[11px] font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1 transition-colors hover:bg-black/[0.04]"
          style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
          <X size={11} /> Limpiar filtros
        </button>
      )}
    </div>
  );
}

function MultiSelect({
  label, items, value, onToggle,
}: {
  label: string;
  items: Option[];
  value: string[];
  onToggle: (id: string) => void;
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
          <div className="absolute top-full left-0 mt-1.5 z-40 rounded-lg border shadow-lg overflow-hidden min-w-[220px] max-h-[320px] overflow-y-auto"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
            {items.length === 0 ? (
              <div className="px-3 py-3 text-xs" style={{ color: C.textMuted }}>Sin opciones disponibles.</div>
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
