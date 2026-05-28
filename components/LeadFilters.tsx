"use client";

import { useState, useEffect, type ReactNode } from "react";
import { C } from "@/lib/design";
import { Search, X, SlidersHorizontal, Flame, Megaphone, MessageCircle, Target, ChevronDown, Briefcase, Building2 } from "lucide-react";

const gold = "var(--brand, #c9a83a)";
const goldDark = "var(--brand-dark, #b79832)";

type FilterOption = { key: string; label: string; color?: string; count?: number };

function PillGroup({ icon, label, options, value, onChange, wrap = false }: {
  icon: ReactNode;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (v: string) => void;
  /** Allow the pill row to wrap to multiple lines when content overflows.
   *  Used by the Profile filter where ICP names can be long ("Pathway
   *  Invoice Finance — Construction"). */
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "flex items-start gap-2 flex-wrap min-w-0" : "flex items-center gap-2"}>
      <div className="flex items-center gap-1.5 shrink-0 pt-1">
        <span style={{ color: C.textDim }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted, letterSpacing: "0.08em" }}>{label}</span>
      </div>
      <div className={`${wrap ? "flex flex-wrap" : "flex items-center"} gap-0.5 rounded-lg p-0.5 border`} style={{ backgroundColor: C.bg, borderColor: C.border }}>
        {options.map(opt => {
          const isActive = value === opt.key;
          const accent = opt.color ?? goldDark;
          return (
            <button
              key={opt.key}
              onClick={() => onChange(opt.key)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 hover:scale-[1.02]"
              style={{
                backgroundColor: isActive
                  ? `color-mix(in srgb, ${accent} 14%, ${C.card})`
                  : "transparent",
                color: isActive ? accent : C.textMuted,
                border: isActive
                  ? `1px solid color-mix(in srgb, ${accent} 35%, transparent)`
                  : "1px solid transparent",
                boxShadow: isActive
                  ? `0 1px 0 color-mix(in srgb, ${accent} 18%, transparent), 0 0 0 2px color-mix(in srgb, ${accent} 8%, transparent)`
                  : "none",
              }}
            >
              {opt.label}
              {opt.count !== undefined && isActive && opt.key !== "all" && (
                <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }}>{opt.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type LeadFilterState = {
  search: string;
  score: string;
  campaign: string;
  reply: string;
  profile: string;
  /** Job role / title. "all" or a string that must match (case-insensitive
   *  contains) against the lead's primary_title_role. */
  role: string;
  /** Company industry. Same shape as role — "all" or a contains-match. */
  industry: string;
};

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
}) {
  const set = (key: keyof LeadFilterState, val: string) => onChange({ ...filters, [key]: val });
  // "Filter pills" used to be permanently visible — 3 pill groups + a profile
  // row with 11 long ICP names. Way too much visual noise on first paint when
  // most sellers just need search + the saved-view chips above. Hidden by
  // default now, expand via the "Filters" toggle.
  const hasFacetFilter =
    filters.score !== "all" ||
    filters.campaign !== "all" ||
    filters.reply !== "all" ||
    filters.profile !== "all" ||
    filters.role !== "all" ||
    filters.industry !== "all";
  const [expanded, setExpanded] = useState(hasFacetFilter);
  // Re-open the panel whenever a programmatic filter is applied (e.g. clicking
  // a saved view from the parent), so the user can see at a glance which
  // facets the view configured.
  useEffect(() => {
    if (hasFacetFilter) setExpanded(true);
  }, [hasFacetFilter]);

  const activeCount =
    (filters.score !== "all" ? 1 : 0) +
    (filters.campaign !== "all" ? 1 : 0) +
    (filters.reply !== "all" ? 1 : 0) +
    (filters.profile !== "all" ? 1 : 0) +
    (filters.role !== "all" ? 1 : 0) +
    (filters.industry !== "all" ? 1 : 0) +
    (filters.search !== "" ? 1 : 0);
  const hasActiveFilter = activeCount > 0;

  return (
    <div className="rounded-2xl border mb-4 overflow-hidden relative" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      {/* Subtle gold accent line — same signature as the lead detail card */}
      <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)`, opacity: 0.4 }} />

      {/* Search row */}
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
            onChange={e => set("search", e.target.value)}
            placeholder="Search by name, company, email…"
            className="bg-transparent text-[12px] outline-none flex-1 placeholder:font-normal placeholder:text-[12px]"
            style={{ color: C.textPrimary }}
          />
          {filters.search && (
            <button onClick={() => set("search", "")} className="rounded p-0.5 hover:bg-black/5 transition-colors">
              <X size={11} style={{ color: C.textDim }} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors hover:bg-black/[0.03]"
          style={{
            borderColor: hasActiveFilter ? `color-mix(in srgb, ${goldDark} 30%, ${C.border})` : C.border,
            backgroundColor: hasActiveFilter ? `color-mix(in srgb, ${goldDark} 8%, transparent)` : "transparent",
          }}
          title={expanded ? "Hide filters" : "Show filters"}
        >
          <SlidersHorizontal size={12} style={{ color: hasActiveFilter ? goldDark : C.textDim }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: hasActiveFilter ? goldDark : C.textDim, letterSpacing: "0.08em" }}>
            Filters
          </span>
          {activeCount > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: goldDark, color: "white", lineHeight: 1 }}>
              {activeCount}
            </span>
          )}
          <ChevronDown
            size={11}
            style={{
              color: hasActiveFilter ? goldDark : C.textDim,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          />
        </button>

        {hasActiveFilter && (
          <button
            onClick={() => onChange({ search: "", score: "all", campaign: "all", reply: "all", profile: "all", role: "all", industry: "all" })}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors hover:bg-red-50"
            style={{ color: C.red, letterSpacing: "0.06em" }}
          >
            Clear
          </button>
        )}

        <span className="text-[11px] font-bold tabular-nums px-2.5 py-1 rounded-md" style={{ backgroundColor: C.bg, color: C.textBody, border: `1px solid ${C.border}` }}>
          {resultCount === totalCount ? `${totalCount}` : `${resultCount} / ${totalCount}`}
        </span>
      </div>

      {/* Filter pills row */}
      <div className="px-4 py-3 flex items-center gap-4 flex-wrap" style={{ backgroundColor: `color-mix(in srgb, ${C.bg} 50%, transparent)` }}>
        <PillGroup
          icon={<Flame size={11} />}
          label="Score"
          value={filters.score}
          onChange={v => set("score", v)}
          options={[
            { key: "all", label: "All" },
            { key: "hot", label: "Hot", color: C.hot },
            { key: "warm", label: "Warm", color: C.warm },
            { key: "nurture", label: "Nurture", color: C.nurture },
          ]}
        />

        {showCampaignFilter && (
          <PillGroup
            icon={<Megaphone size={11} />}
            label="Campaign"
            value={filters.campaign}
            onChange={v => set("campaign", v)}
            options={[
              { key: "all", label: "All" },
              { key: "yes", label: "Active", color: C.green },
              { key: "no", label: "None", color: "#92400E" },
            ]}
          />
        )}

        <PillGroup
          icon={<MessageCircle size={11} />}
          label="Reply"
          value={filters.reply}
          onChange={v => set("reply", v)}
          options={[
            { key: "all", label: "All" },
            { key: "positive", label: "Positive", color: C.green },
            { key: "replied", label: "Replied", color: "#D97706" },
            { key: "none", label: "No Reply" },
          ]}
        />
      </div>

      {(showProfileFilter && profileNames && profileNames.length > 1)
        || (roleOptions && roleOptions.length > 1)
        || (industryOptions && industryOptions.length > 1) ? (
        <div className="px-4 py-2.5 border-t flex items-center gap-4 flex-wrap" style={{ borderColor: C.border, backgroundColor: C.card }}>
          {showProfileFilter && profileNames && profileNames.length > 1 && (
            <FacetDropdown
              icon={<Target size={11} />}
              label="ICP"
              value={filters.profile}
              onChange={v => set("profile", v)}
              options={profileNames}
              allLabel={`All ICPs (${profileNames.length})`}
              dropdownThreshold={5}
            />
          )}
          {roleOptions && roleOptions.length > 1 && (
            <FacetDropdown
              icon={<Briefcase size={11} />}
              label="Role"
              value={filters.role}
              onChange={v => set("role", v)}
              options={roleOptions}
              allLabel={`All roles (${roleOptions.length})`}
              dropdownThreshold={5}
            />
          )}
          {industryOptions && industryOptions.length > 1 && (
            <FacetDropdown
              icon={<Building2 size={11} />}
              label="Industry"
              value={filters.industry}
              onChange={v => set("industry", v)}
              options={industryOptions}
              allLabel={`All industries (${industryOptions.length})`}
              dropdownThreshold={5}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

// Shared facet picker — pills when ≤ threshold, dropdown when more. Used by
// ICP, Role, Industry. Behaviour copies the pre-existing ICP filter so the
// whole row stays visually consistent.
function FacetDropdown({
  icon, label, value, onChange, options, allLabel, dropdownThreshold = 5,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
  dropdownThreshold?: number;
}) {
  if (options.length > dropdownThreshold) {
    return (
      <div className="flex items-center gap-2">
        <span style={{ color: C.textDim }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted, letterSpacing: "0.08em" }}>{label}</span>
        <div
          className="flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 py-1"
          style={{
            backgroundColor: value !== "all" ? `color-mix(in srgb, ${goldDark} 8%, ${C.bg})` : C.bg,
            borderColor: value !== "all" ? `color-mix(in srgb, ${goldDark} 32%, ${C.border})` : C.border,
          }}
        >
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="bg-transparent text-[11px] font-semibold outline-none appearance-none pr-1"
            style={{ color: value !== "all" ? goldDark : C.textBody, maxWidth: 220 }}
          >
            <option value="all">{allLabel}</option>
            {options.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <ChevronDown size={11} style={{ color: value !== "all" ? goldDark : C.textDim }} />
        </div>
        {value !== "all" && (
          <button
            onClick={() => onChange("all")}
            className="rounded p-0.5 hover:bg-black/5 transition-colors"
            title={`Clear ${label} filter`}
          >
            <X size={11} style={{ color: C.textDim }} />
          </button>
        )}
      </div>
    );
  }
  return (
    <PillGroup
      icon={icon}
      label={label}
      value={value}
      onChange={onChange}
      wrap
      options={[
        { key: "all", label: "All" },
        ...options.map(n => ({ key: n, label: n })),
      ]}
    />
  );
}
