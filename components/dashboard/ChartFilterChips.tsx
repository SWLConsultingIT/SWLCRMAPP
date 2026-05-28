"use client";

// Compact per-chart filter chip-row. Sits in the header area of an
// important chart so the operator can adjust filters without scrolling
// back to the tab-level TabFilterBar.
//
// v1 (this commit): writes to the SAME global URL params as TabFilterBar.
// Behaves as a duplicate of the tab-level filter, surfaced near each
// chart for accessibility. Visual "I can filter from here too".
//
// v2 (future): per-chart isolated params + data-layer-recompute so each
// chart can hold its own slice. Tradeoff = much more code, will only be
// worth it if the user actually uses chart-independent scopes.

import { useEffect, useState, useTransition, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type Opt = { id: string; label: string };

export default function ChartFilterChips({
  campaigns,
  icps,
  sellers,
  labels,
  compact = true,
}: {
  campaigns?: Opt[];
  icps?: Opt[];
  sellers?: Opt[];
  labels: {
    campaigns: string;
    icps: string;
    sellers: string;
    empty: string;
  };
  compact?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<URLSearchParams | null>(null);
  const effective = optimistic ?? params;
  useEffect(() => {
    if (optimistic && optimistic.toString() === params.toString()) setOptimistic(null);
  }, [params, optimistic]);

  const selC = effective.get("campaigns")?.split("|").filter(Boolean) ?? [];
  const selI = effective.get("icps")?.split("|").filter(Boolean) ?? [];
  const selS = effective.get("sellers")?.split("|").filter(Boolean) ?? [];

  function apply(mut: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mut(next);
    setOptimistic(next);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `?${qs}` : "?", { scroll: false }));
  }

  function toggle(key: "campaigns" | "icps" | "sellers", id: string) {
    const cur = key === "campaigns" ? selC : key === "icps" ? selI : selS;
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    apply(p => { if (next.length > 0) p.set(key, next.join("|")); else p.delete(key); });
  }

  const sizeCls = compact ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1";

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      {campaigns !== undefined && (
        <Dd label={labels.campaigns} items={campaigns} value={selC} onToggle={id => toggle("campaigns", id)} empty={labels.empty} sizeCls={sizeCls} />
      )}
      {icps !== undefined && (
        <Dd label={labels.icps} items={icps} value={selI} onToggle={id => toggle("icps", id)} empty={labels.empty} sizeCls={sizeCls} />
      )}
      {sellers !== undefined && (
        <Dd label={labels.sellers} items={sellers} value={selS} onToggle={id => toggle("sellers", id)} empty={labels.empty} sizeCls={sizeCls} />
      )}
    </div>
  );
}

function Dd({
  label, items, value, onToggle, empty, sizeCls,
}: {
  label: string; items: Opt[]; value: string[]; onToggle: (id: string) => void; empty: string; sizeCls: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${sizeCls} font-medium rounded-md border inline-flex items-center gap-1 transition-colors`}
        style={{
          backgroundColor: value.length > 0 ? `color-mix(in srgb, ${gold} 14%, transparent)` : "transparent",
          borderColor: value.length > 0 ? `color-mix(in srgb, ${gold} 38%, transparent)` : C.border,
          color: value.length > 0 ? gold : C.textBody,
        }}
      >
        {label}
        {value.length > 0 && (
          <span className="text-[9px] font-bold tabular-nums px-1 py-0 rounded"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            {value.length}
          </span>
        )}
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 z-40 rounded-lg border shadow-lg min-w-[220px] max-h-[280px] overflow-y-auto py-1"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}>
            {items.length === 0 ? (
              <div className="px-3 py-3 text-xs" style={{ color: C.textMuted }}>{empty}</div>
            ) : items.map(it => {
              const on = value.includes(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onToggle(it.id)}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-black/[0.04]"
                >
                  <span className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                    style={{ backgroundColor: on ? gold : "transparent", borderColor: on ? gold : C.border }}>
                    {on && <span className="text-[#04070d] font-bold leading-none" style={{ fontSize: 8 }}>✓</span>}
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
