"use client";

import { C } from "@/lib/design";
import { Search, X, SlidersHorizontal, Flame, Megaphone, MessageCircle, Target } from "lucide-react";
import type { ReactNode } from "react";

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
  const activeCount =
    (filters.score !== "all" ? 1 : 0) +
    (filters.campaign !== "all" ? 1 : 0) +
    (filters.reply !== "all" ? 1 : 0) +
    (filters.profile !== "all" ? 1 : 0) +
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

        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border"
          style={{
            borderColor: hasActiveFilter ? `color-mix(in srgb, ${goldDark} 30%, ${C.border})` : C.border,
            backgroundColor: hasActiveFilter ? `color-mix(in srgb, ${goldDark} 8%, transparent)` : "transparent",
          }}
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
        </div>

        {hasActiveFilter && (
          <button
            onClick={() => onChange({ search: "", score: "all", campaign: "all", reply: "all", profile: "all" })}
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

      {showProfileFilter && profileNames && profileNames.length > 1 && (
        <div className="px-4 py-2.5 border-t flex items-start gap-3 flex-wrap" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <PillGroup
            icon={<Target size={11} />}
            label="Profile"
            value={filters.profile}
            onChange={v => set("profile", v)}
            wrap
            options={[
              { key: "all", label: "All" },
              // No truncation — long ICP names like "Pathway Invoice
              // Finance — Construction" used to all collapse to the same
              // "Pathway Invoice Financ…" string and become indistinguishable.
              // PillGroup wraps to multiple lines when names don't fit on one.
              ...profileNames.map(n => ({ key: n, label: n })),
            ]}
          />
        </div>
      )}
    </div>
  );
}
