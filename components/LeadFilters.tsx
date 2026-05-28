"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Search, X, SlidersHorizontal, Flame, Megaphone, MessageCircle, Target, ChevronDown, Briefcase, Building2 } from "lucide-react";

const gold = "var(--brand, #c9a83a)";
const goldDark = "var(--brand-dark, #b79832)";

type FilterOption = { key: string; label: string; color?: string; count?: number };

// Multi-select pill group. `selected` is the array of active keys; empty
// array = "no filter applied". Click a pill to toggle it in or out — no
// "All" pill anymore, because "everything off" already means "all".
function PillGroup({ icon, label, options, selected, onToggle }: {
  icon: ReactNode;
  label: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 shrink-0">
        <span style={{ color: C.textDim }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted, letterSpacing: "0.08em" }}>{label}</span>
      </div>
      <div className="flex items-center gap-0.5 rounded-lg p-0.5 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
        {options.map(opt => {
          const isActive = selected.includes(opt.key);
          // Per-option semantic color (Hot red, Warm amber, Positive
          // green, etc). Reverted from gold-uniform 2026-05-28 r8 —
          // Fran preferred keeping the color coding because it gives
          // each pill recognisable meaning at a glance.
          const accent = opt.color ?? goldDark;
          return (
            <button
              key={opt.key}
              onClick={() => onToggle(opt.key)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 hover:scale-[1.02]"
              style={{
                backgroundColor: isActive ? `color-mix(in srgb, ${accent} 14%, ${C.card})` : "transparent",
                color: isActive ? accent : C.textMuted,
                border: isActive ? `1px solid color-mix(in srgb, ${accent} 35%, transparent)` : "1px solid transparent",
                boxShadow: isActive ? `0 1px 0 color-mix(in srgb, ${accent} 18%, transparent), 0 0 0 2px color-mix(in srgb, ${accent} 8%, transparent)` : "none",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type LeadFilterState = {
  search: string;
  /** Multi-select. Empty array means "no filter" (= show everything).
   *  Each filter is OR within itself, AND across filters. Boss feedback
   *  2026-05-28 r5: "se tiene que poder seleccionar varias opciones en
   *  cada filtro". */
  score: string[];
  campaign: string[];
  /** Renamed from "reply" → "results" 2026-05-28 r5. Now stores positive
   *  / negative as discrete values (see PILL_OPTS below). */
  results: string[];
  profile: string[];
  /** Job role / title. Each entry is a case-insensitive exact match
   *  against the lead's primary_title_role. */
  role: string[];
  /** Company industry. Same shape as role. */
  industry: string[];
};

export function emptyLeadFilterState(): LeadFilterState {
  return { search: "", score: [], campaign: [], results: [], profile: [], role: [], industry: [] };
}

export function LeadFilterBar({
  filters,
  onChange,
  resultCount,
  totalCount,
  profileNames,
  roleOptions,
  industryOptions,
  showCampaignFilter = true,
  showProfileFilter = true,
  showStatusPills = true,
}: {
  filters: LeadFilterState;
  onChange: (f: LeadFilterState) => void;
  resultCount: number;
  totalCount: number;
  profileNames?: string[];
  /** Distinct role values present in the current lead set. Pass null/empty
   *  to hide the Role filter. The bar autoswitches to a dropdown when the
   *  list is long (>5) to match the ICP filter pattern. */
  roleOptions?: string[];
  /** Distinct industry values present in the current lead set. */
  industryOptions?: string[];
  showCampaignFilter?: boolean;
  showProfileFilter?: boolean;
  /** Score / Campaign / Reply pill groups. On /leads they duplicate the
   *  Status chip row above the table, so pass `false` there. On surfaces
   *  without a status chip row (Lead Miner ticket) keep the default true
   *  so the seller can still slice by score / reply / campaign. */
  showStatusPills?: boolean;
}) {
  // Multi-select toggle helper. Each facet (score, campaign, results,
  // profile, role, industry) is a string[]. Click adds, click again
  // removes. Empty array = no filter applied.
  const { t } = useLocale();
  const toggle = (key: Exclude<keyof LeadFilterState, "search">, v: string) => {
    const curr = filters[key];
    const next = curr.includes(v) ? curr.filter(x => x !== v) : [...curr, v];
    onChange({ ...filters, [key]: next });
  };
  const setSearch = (v: string) => onChange({ ...filters, search: v });

  const activeCount =
    filters.score.length +
    filters.campaign.length +
    filters.results.length +
    filters.profile.length +
    filters.role.length +
    filters.industry.length +
    (filters.search !== "" ? 1 : 0);
  const hasActiveFilter = activeCount > 0;

  return (
    <div
      className="rounded-2xl border mb-4 relative"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* Subtle gold accent line — same signature as the lead detail card.
          Outer wrapper has overflow:visible (was hidden) so the FacetDropdown
          popups can escape the bar — boss feedback 2026-05-28 r7:
          "siguen sin verse los filtros desplegables". The accent stripe
          stays clipped by rounding the inner span instead. */}
      <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none rounded-t-2xl overflow-hidden" style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)`, opacity: 0.4 }} />

      {/* Search row + result count + Clear. The old "Filters" toggle was
          removed 2026-05-28 r5: pills + facets are always visible now
          ("el botón Filters arriba a la derecha no sirve de nada"). */}
      <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ borderColor: C.border }}>
        <div
          className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 flex-1 transition-shadow focus-within:shadow-sm"
          style={{
            borderColor: filters.search ? `color-mix(in srgb, ${goldDark} 35%, ${C.border})` : C.border,
            backgroundColor: C.bg,
          }}
        >
          <Search size={12} style={{ color: filters.search ? goldDark : C.textDim }} />
          <input
            type="text"
            value={filters.search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("leadFilters.search")}
            className="bg-transparent text-[12px] outline-none flex-1 placeholder:font-normal placeholder:text-[12px]"
            style={{ color: C.textPrimary }}
          />
          {filters.search && (
            <button onClick={() => setSearch("")} className="rounded p-0.5 hover:bg-black/5 transition-colors">
              <X size={11} style={{ color: C.textDim }} />
            </button>
          )}
        </div>

        {hasActiveFilter && (
          <button
            onClick={() => onChange(emptyLeadFilterState())}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors hover:bg-red-50 inline-flex items-center gap-1"
            style={{ color: C.red, letterSpacing: "0.06em" }}
          >
            <X size={11} /> {t("leadFilters.clear")} {activeCount > 1 ? `(${activeCount})` : ""}
          </button>
        )}

        <span className="text-[11px] font-bold tabular-nums px-2.5 py-1 rounded-md" style={{ backgroundColor: C.bg, color: C.textBody, border: `1px solid ${C.border}` }}>
          {resultCount === totalCount ? `${totalCount}` : `${resultCount} / ${totalCount}`}
        </span>
      </div>

      {/* Row 1 — quick filters (pills). 3 pill groups distributed in a
          fixed 3-column grid so each gets equal space and they stop
          piling on the right side. Multi-select inside each group. */}
      {showStatusPills && (
      <div
        className="px-4 py-3 grid gap-x-6 gap-y-3 border-b"
        style={{
          backgroundColor: `color-mix(in srgb, ${C.bg} 50%, transparent)`,
          borderColor: C.border,
          gridTemplateColumns: showCampaignFilter ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))",
        }}
      >
        <PillGroup
          icon={<Flame size={11} />}
          label={t("leadFilters.score")}
          selected={filters.score}
          onToggle={v => toggle("score", v)}
          options={[
            { key: "hot",     label: t("leadFilters.hot"),     color: C.hot },
            { key: "warm",    label: t("leadFilters.warm"),    color: C.warm },
            { key: "nurture", label: t("leadFilters.nurture"), color: C.nurture },
          ]}
        />
        {showCampaignFilter && (
          <PillGroup
            icon={<Megaphone size={11} />}
            label={t("leadFilters.campaign")}
            selected={filters.campaign}
            onToggle={v => toggle("campaign", v)}
            options={[
              { key: "yes", label: t("leadFilters.active"), color: C.green },
              { key: "no",  label: t("leadFilters.none"),   color: "#92400E" },
            ]}
          />
        )}
        <PillGroup
          icon={<MessageCircle size={11} />}
          label={t("leadFilters.results")}
          selected={filters.results}
          onToggle={v => toggle("results", v)}
          options={[
            { key: "positive", label: t("leadFilters.positive"), color: C.green },
            { key: "negative", label: t("leadFilters.negative"), color: C.red },
          ]}
        />
      </div>
      )}

      {/* Row 2 — facet dropdowns. ICP / Industry / Role, each gets a
          third of the bar so the trigger pills are equal-width and the
          dropdown popups have somewhere to anchor without clipping. */}
      {((showProfileFilter && profileNames && profileNames.length > 0) || (industryOptions && industryOptions.length > 0) || (roleOptions && roleOptions.length > 0)) && (
      <div
        className="px-4 py-3 grid gap-x-6 gap-y-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        {showProfileFilter && profileNames && profileNames.length > 0 && (
          <FacetDropdown
            icon={<Target size={11} />}
            label={t("leadFilters.icp")}
            selected={filters.profile}
            onToggle={v => toggle("profile", v)}
            onClear={() => onChange({ ...filters, profile: [] })}
            options={profileNames}
          />
        )}
        {industryOptions && industryOptions.length > 0 && (
          <FacetDropdown
            icon={<Building2 size={11} />}
            label={t("leadFilters.industry")}
            selected={filters.industry}
            onToggle={v => toggle("industry", v)}
            onClear={() => onChange({ ...filters, industry: [] })}
            options={industryOptions}
          />
        )}
        {roleOptions && roleOptions.length > 0 && (
          <FacetDropdown
            icon={<Briefcase size={11} />}
            label={t("leadFilters.role")}
            selected={filters.role}
            onToggle={v => toggle("role", v)}
            onClear={() => onChange({ ...filters, role: [] })}
            options={roleOptions}
          />
        )}
      </div>
      )}
    </div>
  );
}

// Multi-select facet picker — pops a checkbox list below the trigger.
// Click outside to close. Used by ICP / Industry / Role uniformly so
// the seller learns one interaction. Boss feedback 2026-05-28 r5:
// "industry tiene que ser deplegable" + "se tiene que poder seleccionar
// varias opciones en cada filtro".
function FacetDropdown({
  icon, label, selected, onToggle, onClear, options,
}: {
  icon: ReactNode;
  label: string;
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  options: string[];
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside-click. We attach mousedown (not click) so clicks
  // inside the popup don't fight the toggle.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const hasFilter = selected.length > 0;
  const visibleOptions = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Trigger label: "All Roles" when nothing selected, "Director" when
  // one selected, "Director +2" when many. Translated via the
  // leadFilters.allOf template which keeps "All {label} ({n})"
  // grammatically right in both EN and ES.
  const triggerText = !hasFilter
    ? t("leadFilters.allOf").replace("{label}", label.toLowerCase()).replace("{n}", String(options.length))
    : selected.length === 1
      ? selected[0]
      : `${selected[0]} +${selected.length - 1}`;

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      <span style={{ color: C.textDim }}>{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted, letterSpacing: "0.08em" }}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 py-1 transition-[border-color,background-color]"
        style={{
          backgroundColor: hasFilter ? `color-mix(in srgb, ${goldDark} 8%, ${C.bg})` : C.bg,
          borderColor: hasFilter ? `color-mix(in srgb, ${goldDark} 32%, ${C.border})` : C.border,
        }}
      >
        <span
          className="text-[11px] font-semibold truncate"
          style={{ color: hasFilter ? goldDark : C.textBody, maxWidth: 200 }}
          title={hasFilter ? selected.join(", ") : undefined}
        >
          {triggerText}
        </span>
        {hasFilter && (
          <span className="text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: goldDark, color: "white", lineHeight: 1 }}>
            {selected.length}
          </span>
        )}
        <ChevronDown size={11} style={{ color: hasFilter ? goldDark : C.textDim, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }} />
      </button>
      {hasFilter && (
        <button
          onClick={onClear}
          className="rounded p-0.5 hover:bg-black/[0.05] transition-colors"
          title={`Clear ${label} filter`}
        >
          <X size={11} style={{ color: C.textDim }} />
        </button>
      )}

      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 z-30 rounded-xl border shadow-lg overflow-hidden"
          style={{
            backgroundColor: C.card,
            borderColor: C.border,
            width: 280,
            boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
          }}
        >
          {/* Search inside the popup — meaningful only when we have
              more than ~8 options. Stays cheap to render either way. */}
          {options.length > 6 && (
            <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <Search size={11} style={{ color: C.textDim }} />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t("leadFilters.searchPopup").replace("{label}", label.toLowerCase())}
                className="bg-transparent text-[11px] outline-none flex-1"
                style={{ color: C.textPrimary }}
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {visibleOptions.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-center" style={{ color: C.textMuted }}>{t("leadFilters.noMatch")}</p>
            ) : visibleOptions.map(opt => {
              const isOn = selected.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => onToggle(opt)}
                  className="w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 hover:bg-black/[0.03] transition-colors"
                  style={{ color: isOn ? goldDark : C.textBody }}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0"
                    style={{
                      borderColor: isOn ? goldDark : C.border,
                      backgroundColor: isOn ? goldDark : "transparent",
                    }}
                  >
                    {isOn && (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1 4.5L3.5 7L8 1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate" style={{ fontWeight: isOn ? 600 : 500 }}>{opt}</span>
                </button>
              );
            })}
          </div>
          {hasFilter && (
            <div className="px-3 py-2 border-t flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <span className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>{t("leadFilters.selected").replace("{n}", String(selected.length))}</span>
              <button onClick={onClear}
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors hover:bg-red-50"
                style={{ color: C.red, letterSpacing: "0.06em" }}>
                {t("leadFilters.clear")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
