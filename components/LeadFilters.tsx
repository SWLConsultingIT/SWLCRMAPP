"use client";

import { useState, useEffect, type ReactNode } from "react";
import { C } from "@/lib/design";
import { Search, X, SlidersHorizontal, Flame, Megaphone, MessageCircle, Target, ChevronDown, Briefcase, Building2 } from "lucide-react";

const gold = "var(--brand, #c9a83a)";
const goldDark = "var(--brand-dark, #b79832)";

type FilterOption = { key: string; label: string; color?: string; count?: number };

function PillGroup({ icon, label, options, value, onChange, wrap = false, dark = false }: {
  icon: ReactNode;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (v: string) => void;
  /** Allow the pill row to wrap to multiple lines when content overflows.
   *  Used by the Profile filter where ICP names can be long ("Pathway
   *  Invoice Finance — Construction"). */
  wrap?: boolean;
  /** Use the dark-on-dark color palette (LeadFilterBar premium look). */
  dark?: boolean;
}) {
  const labelColor    = dark ? "color-mix(in srgb, #F5F2E8 70%, transparent)" : C.textMuted;
  const labelIcon     = dark ? "color-mix(in srgb, #F5F2E8 55%, transparent)" : C.textDim;
  const groupBg       = dark ? "rgba(255,255,255,0.04)" : C.bg;
  const groupBorder   = dark ? "color-mix(in srgb, #c9a83a 16%, #1d1f29)" : C.border;
  const inactiveColor = dark ? "color-mix(in srgb, #F5F2E8 75%, transparent)" : C.textMuted;
  return (
    <div className={wrap ? "flex items-start gap-2 flex-wrap min-w-0" : "flex items-center gap-2"}>
      <div className="flex items-center gap-1.5 shrink-0 pt-1">
        <span style={{ color: labelIcon }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor, letterSpacing: "0.08em" }}>{label}</span>
      </div>
      <div className={`${wrap ? "flex flex-wrap" : "flex items-center"} gap-0.5 rounded-lg p-0.5 border`} style={{ backgroundColor: groupBg, borderColor: groupBorder }}>
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
                  ? (dark ? `color-mix(in srgb, ${accent} 22%, transparent)` : `color-mix(in srgb, ${accent} 14%, ${C.card})`)
                  : "transparent",
                color: isActive ? accent : inactiveColor,
                border: isActive
                  ? `1px solid color-mix(in srgb, ${accent} ${dark ? 50 : 35}%, transparent)`
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

  // Premium dark+gold treatment for the filter surface (boss feedback
  // 2026-05-28: "negro con toques dorados, que sea lindo"). Always dark
  // regardless of theme so the bar feels like a deliberate operator
  // surface, distinct from the surrounding light cards. Background uses
  // a near-black with a faint gold radial gradient on the top edge.
  const darkBg = "#0F0F14";
  const darkBgElevated = "#171821";
  const darkBorder = "color-mix(in srgb, #c9a83a 16%, #1d1f29)";
  const darkBorderHover = "color-mix(in srgb, #c9a83a 32%, #1d1f29)";
  const lightOnDark = "#F5F2E8";
  const dimOnDark = "color-mix(in srgb, #F5F2E8 55%, transparent)";
  return (
    <div
      className="rounded-2xl border mb-4 overflow-hidden relative"
      style={{
        backgroundColor: darkBg,
        borderColor: darkBorder,
        boxShadow: "0 4px 18px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in srgb, #c9a83a 12%, transparent)",
      }}
    >
      {/* Gold gradient strip across the top */}
      <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)`, opacity: 0.85 }} />
      {/* Soft gold radial in the corner for the "premium" depth */}
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 22%, transparent) 0%, transparent 70%)`, opacity: 0.5 }} />

      {/* Search row */}
      <div className="px-4 py-3 flex items-center gap-3 border-b relative" style={{ borderColor: darkBorder }}>
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2 flex-1 transition-[border-color,box-shadow]"
          style={{
            borderColor: filters.search ? `color-mix(in srgb, ${gold} 55%, ${darkBorder})` : darkBorder,
            backgroundColor: darkBgElevated,
            boxShadow: filters.search ? `0 0 0 3px color-mix(in srgb, ${gold} 12%, transparent)` : "none",
          }}
        >
          <Search size={13} style={{ color: filters.search ? gold : dimOnDark }} />
          <input
            type="text"
            value={filters.search}
            onChange={e => set("search", e.target.value)}
            placeholder="Search by name, company, email…"
            className="bg-transparent text-[12px] outline-none flex-1 placeholder:font-normal placeholder:text-[12px]"
            style={{ color: lightOnDark, ["::placeholder" as any]: { color: dimOnDark } }}
          />
          {filters.search && (
            <button onClick={() => set("search", "")} className="rounded p-0.5 hover:bg-white/5 transition-colors">
              <X size={11} style={{ color: dimOnDark }} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md border transition-[border-color,background-color]"
          style={{
            borderColor: hasActiveFilter ? darkBorderHover : darkBorder,
            backgroundColor: hasActiveFilter ? `color-mix(in srgb, ${gold} 12%, ${darkBgElevated})` : darkBgElevated,
          }}
          title={expanded ? "Hide filters" : "Show filters"}
        >
          <SlidersHorizontal size={12} style={{ color: hasActiveFilter ? gold : dimOnDark }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: hasActiveFilter ? gold : dimOnDark, letterSpacing: "0.08em" }}>
            Filters
          </span>
          {activeCount > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: gold, color: "#0F0F14", lineHeight: 1 }}>
              {activeCount}
            </span>
          )}
          <ChevronDown
            size={11}
            style={{
              color: hasActiveFilter ? gold : dimOnDark,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          />
        </button>

        {hasActiveFilter && (
          <button
            onClick={() => onChange({ search: "", score: "all", campaign: "all", reply: "all", profile: "all", role: "all", industry: "all" })}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors hover:bg-white/[0.04]"
            style={{ color: gold, letterSpacing: "0.06em" }}
          >
            Clear
          </button>
        )}

        <span className="text-[11px] font-bold tabular-nums px-2.5 py-1 rounded-md" style={{ backgroundColor: darkBgElevated, color: gold, border: `1px solid ${darkBorder}` }}>
          {resultCount === totalCount ? `${totalCount}` : `${resultCount} / ${totalCount}`}
        </span>
      </div>

      {/* Filter pills row — Score / Campaign / Reply duplicate the chip row
          on /leads, so we let the parent hide them via `showStatusPills`.
          Lead Miner ticket detail still renders this row (no chip row
          upstream) so the seller can slice by score / reply / campaign. */}
      {showStatusPills && (
      <div className="px-4 py-3 flex items-center gap-4 flex-wrap relative" style={{ backgroundColor: "rgba(255,255,255,0.02)", borderTop: `1px solid ${darkBorder}` }}>
        <PillGroup
          dark
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
            dark
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
          dark
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
      )}

      {(showProfileFilter && profileNames && profileNames.length > 1)
        || (roleOptions && roleOptions.length > 1)
        || (industryOptions && industryOptions.length > 1) ? (
        <div className="px-4 py-3 border-t flex items-center gap-4 flex-wrap relative" style={{ borderColor: darkBorder, backgroundColor: "rgba(255,255,255,0.02)" }}>
          {showProfileFilter && profileNames && profileNames.length > 1 && (
            <FacetDropdown
              dark
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
              dark
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
              dark
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
  icon, label, value, onChange, options, allLabel, dropdownThreshold = 5, dark = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
  dropdownThreshold?: number;
  dark?: boolean;
}) {
  const labelColor    = dark ? "color-mix(in srgb, #F5F2E8 70%, transparent)" : C.textMuted;
  const labelIcon     = dark ? "color-mix(in srgb, #F5F2E8 55%, transparent)" : C.textDim;
  const bgIdle        = dark ? "rgba(255,255,255,0.04)" : C.bg;
  const bgActive      = dark ? `color-mix(in srgb, ${gold} 14%, rgba(255,255,255,0.04))` : `color-mix(in srgb, ${goldDark} 8%, ${C.bg})`;
  const borderIdle    = dark ? "color-mix(in srgb, #c9a83a 16%, #1d1f29)" : C.border;
  const borderActive  = dark ? `color-mix(in srgb, ${gold} 48%, #1d1f29)` : `color-mix(in srgb, ${goldDark} 32%, ${C.border})`;
  const idleText      = dark ? "color-mix(in srgb, #F5F2E8 85%, transparent)" : C.textBody;
  if (options.length > dropdownThreshold) {
    return (
      <div className="flex items-center gap-2">
        <span style={{ color: labelIcon }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor, letterSpacing: "0.08em" }}>{label}</span>
        <div
          className="flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 py-1"
          style={{
            backgroundColor: value !== "all" ? bgActive : bgIdle,
            borderColor: value !== "all" ? borderActive : borderIdle,
          }}
        >
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="bg-transparent text-[11px] font-semibold outline-none appearance-none pr-1"
            style={{ color: value !== "all" ? gold : idleText, maxWidth: 220 }}
          >
            <option value="all">{allLabel}</option>
            {options.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <ChevronDown size={11} style={{ color: value !== "all" ? gold : labelIcon }} />
        </div>
        {value !== "all" && (
          <button
            onClick={() => onChange("all")}
            className="rounded p-0.5 hover:bg-white/[0.04] transition-colors"
            title={`Clear ${label} filter`}
          >
            <X size={11} style={{ color: labelIcon }} />
          </button>
        )}
      </div>
    );
  }
  return (
    <PillGroup
      dark={dark}
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
