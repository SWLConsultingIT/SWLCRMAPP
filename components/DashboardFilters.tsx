"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CalendarDays, ChevronDown, Filter, X, Loader2, Search, Check } from "lucide-react";
import { C } from "@/lib/design";

type Opt = { id: string; label: string };

// URL-driven filter bar shared by Live + Reports. State lives in the URL
// (not local state) so refreshes / shared links reproduce the same view,
// and every server component re-renders when a param changes.

const gold = "var(--brand, #c9a83a)";

export default function DashboardFilters({
  campaigns, sellers, icps,
}: { campaigns: Opt[]; sellers: Opt[]; icps: Opt[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const cIds = (sp.get("campaigns") ?? "").split(",").filter(Boolean);
  const sIds = (sp.get("sellers") ?? "").split(",").filter(Boolean);
  const iIds = (sp.get("icps") ?? "").split(",").filter(Boolean);

  const anyActive = !!from || !!to || cIds.length > 0 || sIds.length > 0 || iIds.length > 0;
  const totalActive = (from ? 1 : 0) + (to ? 1 : 0) + cIds.length + sIds.length + iIds.length;

  function update(patch: Record<string, string | null>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function toggle(key: string, value: string, current: string[]) {
    const next = current.includes(value) ? current.filter(x => x !== value) : [...current, value];
    update({ [key]: next.length ? next.join(",") : null });
  }

  function clearAll() {
    update({ from: null, to: null, campaigns: null, sellers: null, icps: null });
  }

  // For the active-filter chip row at the bottom of the bar: resolve each
  // selected id back to its human label so the chip is self-describing.
  const campLabel = useMemo(() => new Map(campaigns.map(c => [c.id, c.label])), [campaigns]);
  const sellLabel = useMemo(() => new Map(sellers.map(s => [s.id, s.label])), [sellers]);
  const icpLabel  = useMemo(() => new Map(icps.map(p => [p.id, p.label])), [icps]);

  return (
    <div className="relative rounded-2xl border overflow-hidden mb-4"
      style={{
        backgroundColor: C.card,
        borderColor: anyActive ? `color-mix(in srgb, ${gold} 35%, ${C.border})` : C.border,
        boxShadow: anyActive
          ? `0 4px 18px -6px color-mix(in srgb, ${gold} 28%, transparent), 0 1px 3px rgba(0,0,0,0.04)`
          : "0 2px 8px rgba(0,0,0,0.03)",
        transition: "border-color 150ms ease, box-shadow 150ms ease",
      }}>
      {/* Loading bar across the top — replaces the lonely spinner so the
          whole bar visibly responds to filter changes. */}
      {pending && (
        <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden">
          <div className="h-full animate-pulse"
            style={{ background: `linear-gradient(90deg, transparent, ${gold}, transparent)`, backgroundSize: "200% 100%" }} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 pr-2 mr-0.5 border-r" style={{ borderColor: C.border }}>
          <div className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{
              backgroundColor: anyActive ? `color-mix(in srgb, ${gold} 14%, transparent)` : C.surface,
              color: anyActive ? gold : C.textMuted,
            }}>
            <Filter size={12} />
          </div>
          <span className="text-xs font-semibold" style={{ color: C.textBody }}>Filters</span>
          {totalActive > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums"
              style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
              {totalActive}
            </span>
          )}
        </div>

        {/* Date range — From → To grouped as a single chip. Reads as one
            concept ("date range") rather than two unrelated inputs. */}
        <div className="flex items-center gap-0 rounded-lg border overflow-hidden"
          style={{ borderColor: from || to ? gold : C.border, backgroundColor: C.bg }}>
          <div className="flex items-center pl-2.5 pr-1.5" style={{ color: from || to ? gold : C.textMuted }}>
            <CalendarDays size={12} />
          </div>
          <DateField value={from} onChange={v => update({ from: v || null })} placeholder="From" />
          <span className="text-[11px]" style={{ color: C.textDim }}>→</span>
          <DateField value={to} onChange={v => update({ to: v || null })} placeholder="To" />
        </div>

        <MultiPopover label="Campaign" selected={cIds} options={campaigns}
          onToggle={id => toggle("campaigns", id, cIds)}
          onClear={() => update({ campaigns: null })} />
        <MultiPopover label="Seller" selected={sIds} options={sellers}
          onToggle={id => toggle("sellers", id, sIds)}
          onClear={() => update({ sellers: null })} />
        <MultiPopover label="ICP" selected={iIds} options={icps}
          onToggle={id => toggle("icps", id, iIds)}
          onClear={() => update({ icps: null })} />

        <div className="flex-1" />

        {anyActive && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2.5 py-1.5 border transition-colors hover:bg-black/[0.02]"
            style={{ borderColor: C.border, color: C.textMuted }}
          >
            <X size={11} /> Clear all
          </button>
        )}
      </div>

      {/* Active filter chips row — one chip per selected value with a × to
          remove it individually. The user gets to see what's active at a
          glance and remove pieces without re-opening the dropdowns. */}
      {anyActive && (cIds.length + sIds.length + iIds.length > 0 || from || to) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2 border-t"
          style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 3%, var(--c-bg))` }}>
          {from && (
            <Chip label={`From ${from}`} onRemove={() => update({ from: null })} />
          )}
          {to && (
            <Chip label={`To ${to}`} onRemove={() => update({ to: null })} />
          )}
          {cIds.map(id => (
            <Chip key={`c-${id}`} label={`Campaign: ${campLabel.get(id) ?? id}`}
              onRemove={() => toggle("campaigns", id, cIds)} />
          ))}
          {sIds.map(id => (
            <Chip key={`s-${id}`} label={`Seller: ${sellLabel.get(id) ?? id}`}
              onRemove={() => toggle("sellers", id, sIds)} />
          ))}
          {iIds.map(id => (
            <Chip key={`i-${id}`} label={`ICP: ${icpLabel.get(id) ?? id}`}
              onRemove={() => toggle("icps", id, iIds)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DateField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="bg-transparent text-[11px] font-medium px-2 py-1.5 focus:outline-none"
      style={{ color: value ? C.textPrimary : C.textMuted, minWidth: 118 }}
    />
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full pl-2 pr-1 py-0.5 border"
      style={{
        backgroundColor: C.card,
        borderColor: `color-mix(in srgb, ${gold} 25%, ${C.border})`,
        color: C.textBody,
      }}>
      {label}
      <button onClick={onRemove} aria-label="Remove filter"
        className="inline-flex items-center justify-center rounded-full w-3.5 h-3.5 hover:opacity-100 opacity-60 transition-opacity"
        style={{ color: C.textMuted }}>
        <X size={9} />
      </button>
    </span>
  );
}

function MultiPopover({
  label, selected, options, onToggle, onClear,
}: {
  label: string;
  selected: string[];
  options: Opt[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const hasSelection = selected.length > 0;
  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [query, options]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] font-semibold rounded-lg px-2.5 py-1.5 border transition-colors hover:bg-black/[0.02]"
        style={{
          borderColor: hasSelection ? gold : C.border,
          backgroundColor: hasSelection ? `color-mix(in srgb, ${gold} 8%, transparent)` : C.bg,
          color: hasSelection ? gold : C.textBody,
        }}
      >
        <span>{label}</span>
        {hasSelection && (
          <span className="text-[10px] font-bold tabular-nums rounded-full px-1.5"
            style={{ backgroundColor: gold, color: "#fff", minWidth: 16, textAlign: "center" }}>
            {selected.length}
          </span>
        )}
        <ChevronDown size={11} className="transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }} />
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1.5 rounded-xl border shadow-xl overflow-hidden"
          style={{
            backgroundColor: C.card, borderColor: C.border,
            minWidth: 260, maxHeight: 360,
            boxShadow: "0 12px 28px -8px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.04)",
          }}
        >
          {/* Search input — only renders when there are >6 options, otherwise
              the dropdown is short enough that searching is overkill. */}
          {options.length > 6 && (
            <div className="px-2.5 py-2 border-b" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
                style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                <Search size={11} style={{ color: C.textDim }} />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="bg-transparent text-[11px] focus:outline-none flex-1"
                  style={{ color: C.textPrimary }}
                />
              </div>
            </div>
          )}

          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {filtered.length === 0 ? (
              <p className="text-[11px] px-3 py-4 text-center" style={{ color: C.textMuted }}>
                {options.length === 0 ? "No options" : "No matches"}
              </p>
            ) : (
              filtered.map(opt => {
                const checked = selected.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() => onToggle(opt.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-black/[0.025] transition-colors"
                    style={{ color: C.textBody }}
                  >
                    <span className="inline-flex items-center justify-center rounded-md shrink-0 border"
                      style={{
                        width: 16, height: 16,
                        borderColor: checked ? gold : C.border,
                        backgroundColor: checked ? gold : "transparent",
                      }}>
                      {checked && <Check size={10} style={{ color: "#fff" }} strokeWidth={3} />}
                    </span>
                    <span className="truncate flex-1">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>

          {hasSelection && (
            <button
              onClick={onClear}
              className="w-full text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2 border-t hover:bg-black/[0.02] transition-colors flex items-center gap-1.5"
              style={{ borderColor: C.border, color: C.textMuted }}
            >
              <X size={10} /> Clear {label.toLowerCase()} selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
