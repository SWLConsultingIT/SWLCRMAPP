"use client";

import { C } from "@/lib/design";
import { Search, X, SlidersHorizontal } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type FilterOption = { key: string; label: string; color?: string; count?: number };

function PillGroup({ label, options, value, onChange }: {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: C.textDim }}>{label}</span>
      <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: C.bg }}>
        {options.map(opt => {
          const isActive = value === opt.key;
          return (
            <button key={opt.key} onClick={() => onChange(opt.key)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={{
                backgroundColor: isActive ? C.card : "transparent",
                color: isActive ? (opt.color ?? gold) : C.textMuted,
                boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}>
              {opt.label}
              {opt.count !== undefined && isActive && opt.key !== "all" && (
                <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: `${opt.color ?? gold}12`, color: opt.color ?? gold }}>{opt.count}</span>
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
};

export function LeadFilterBar({
  filters,
  onChange,
  resultCount,
  totalCount,
  profileNames,
  showCampaignFilter = true,
  showProfileFilter = true,
}: {
  filters: LeadFilterState;
  onChange: (f: LeadFilterState) => void;
  resultCount: number;
  totalCount: number;
  profileNames?: string[];
  showCampaignFilter?: boolean;
  showProfileFilter?: boolean;
}) {
  const set = (key: keyof LeadFilterState, val: string) => onChange({ ...filters, [key]: val });
  const hasActiveFilter = filters.score !== "all" || filters.campaign !== "all" || filters.reply !== "all" || filters.profile !== "all" || filters.search !== "";

  return (
    <div className="rounded-xl border mb-4 overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {/* Search row */}
      <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 flex-1"
          style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input type="text" value={filters.search} onChange={e => set("search", e.target.value)}
            placeholder="Search by name, company, email..." className="bg-transparent text-sm outline-none flex-1" style={{ color: C.textPrimary }} />
          {filters.search && <button onClick={() => set("search", "")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal size={12} style={{ color: C.textDim }} />
          <span className="text-[10px] font-semibold" style={{ color: C.textDim }}>Filters</span>
        </div>
        {hasActiveFilter && (
          <button onClick={() => onChange({ search: "", score: "all", campaign: "all", reply: "all", profile: "all" })}
            className="text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors hover:bg-gray-100"
            style={{ color: C.red }}>
            Clear all
          </button>
        )}
        <span className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full" style={{ backgroundColor: C.bg, color: C.textMuted }}>
          {resultCount === totalCount ? totalCount : `${resultCount} / ${totalCount}`}
        </span>
      </div>

      {/* Filter pills row */}
      <div className="px-4 py-2.5 flex items-center gap-4 flex-wrap">
        <PillGroup label="Score" value={filters.score} onChange={v => set("score", v)} options={[
          { key: "all", label: "All" },
          { key: "hot", label: "Hot", color: C.hot },
          { key: "warm", label: "Warm", color: C.warm },
          { key: "nurture", label: "Nurture", color: C.nurture },
        ]} />

        {showCampaignFilter && (
          <PillGroup label="Campaign" value={filters.campaign} onChange={v => set("campaign", v)} options={[
            { key: "all", label: "All" },
            { key: "yes", label: "Active", color: C.green },
            { key: "no", label: "None", color: "#92400E" },
          ]} />
        )}

        <PillGroup label="Reply" value={filters.reply} onChange={v => set("reply", v)} options={[
          { key: "all", label: "All" },
          { key: "positive", label: "Positive", color: C.green },
          { key: "replied", label: "Replied", color: "#D97706" },
          { key: "none", label: "No Reply" },
        ]} />

        {showProfileFilter && profileNames && profileNames.length > 1 && (
          <PillGroup label="Profile" value={filters.profile} onChange={v => set("profile", v)} options={[
            { key: "all", label: "All" },
            ...profileNames.map(n => ({ key: n, label: n.length > 20 ? n.slice(0, 20) + "..." : n })),
          ]} />
        )}
      </div>
    </div>
  );
}
