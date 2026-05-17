"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Calendar, ChevronDown, Filter, X, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

type Opt = { id: string; label: string };

// URL-driven filter bar shared by Live + Reports. Reading state from the URL
// (not local state) keeps a refresh / shared link reproducible, and the
// server components re-render whenever a param changes because each page
// receives `searchParams`.
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

  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-4 rounded-xl border px-3 py-2"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold pr-1" style={{ color: C.textMuted }}>
        <Filter size={13} />
        Filters
      </div>

      <DateInput label="From" value={from} onChange={v => update({ from: v || null })} />
      <DateInput label="To"   value={to}   onChange={v => update({ to:   v || null })} />

      <MultiPopover
        label="Campaign"
        selected={cIds}
        options={campaigns}
        onToggle={id => toggle("campaigns", id, cIds)}
        onClear={() => update({ campaigns: null })}
      />
      <MultiPopover
        label="Seller"
        selected={sIds}
        options={sellers}
        onToggle={id => toggle("sellers", id, sIds)}
        onClear={() => update({ sellers: null })}
      />
      <MultiPopover
        label="ICP"
        selected={iIds}
        options={icps}
        onToggle={id => toggle("icps", id, iIds)}
        onClear={() => update({ icps: null })}
      />

      <div className="flex-1" />

      {pending && <Loader2 size={13} className="animate-spin" style={{ color: C.textMuted }} />}

      {anyActive && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 hover:opacity-80"
          style={{ backgroundColor: C.redLight, color: C.red }}
        >
          <X size={11} /> Clear
        </button>
      )}
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] font-medium rounded-md px-2 py-1 border"
      style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textMuted }}>
      <Calendar size={11} />
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent text-[11px] focus:outline-none"
        style={{ color: C.textPrimary, minWidth: 110 }}
      />
    </label>
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const hasSelection = selected.length > 0;
  const summary = hasSelection
    ? `${label} · ${selected.length}`
    : label;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1.5 border"
        style={{
          borderColor: hasSelection ? "var(--brand, #c9a83a)" : C.border,
          backgroundColor: hasSelection ? "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)" : C.bg,
          color: hasSelection ? "var(--brand, #c9a83a)" : C.textBody,
        }}
      >
        {summary}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 rounded-lg border shadow-xl"
          style={{
            backgroundColor: C.card, borderColor: C.border,
            minWidth: 220, maxHeight: 320, overflow: "auto",
          }}
        >
          {options.length === 0 ? (
            <p className="text-[11px] px-3 py-3 text-center" style={{ color: C.textMuted }}>None</p>
          ) : (
            <>
              {hasSelection && (
                <button
                  onClick={onClear}
                  className="w-full text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2 border-b hover:bg-black/[0.02]"
                  style={{ borderColor: C.border, color: C.textMuted }}
                >
                  Clear selection
                </button>
              )}
              {options.map(opt => {
                const checked = selected.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() => onToggle(opt.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-black/[0.02]"
                    style={{ color: C.textBody }}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={checked}
                      style={{ accentColor: "var(--brand, #c9a83a)" }}
                    />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
