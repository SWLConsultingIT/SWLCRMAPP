"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Users, CheckSquare, Square } from "lucide-react";
import { C, N } from "@/lib/design";
import { LeadFilterBar, emptyLeadFilterState, type LeadFilterState } from "@/components/LeadFilters";

const gold = "var(--brand, #c9a83a)";

export type PickableLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  role: string | null;
  lead_score: number | null;
  industry: string | null;
  country: string | null;
  allow_linkedin: boolean;
  allow_email: boolean;
  allow_call: boolean;
};

export default function PickLeadsClient({
  profileId, profileName, leads,
}: {
  profileId: string;
  profileName: string;
  leads: PickableLead[];
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<LeadFilterState>(emptyLeadFilterState());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filter options derived from the cohort. Industry / Country / Company
  // / Role read straight off the picker rows so the dropdowns only show
  // values the seller can actually pick.
  const roleOptions     = Array.from(new Set(leads.map(l => l.role).filter(Boolean) as string[])).sort();
  const industryOptions = Array.from(new Set(leads.map(l => l.industry).filter(Boolean) as string[])).sort();
  const countryOptions  = Array.from(new Set(leads.map(l => l.country).filter(Boolean) as string[])).sort();
  const companyOptions  = Array.from(new Set(leads.map(l => l.company_name).filter(Boolean) as string[])).sort();

  // Apply the filter bar state. Same predicates as the campaign /add-leads
  // tab so behavior is consistent across the two pickers.
  const filtered = leads.filter(l => {
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      const nm = `${l.first_name ?? ""} ${l.last_name ?? ""}`.toLowerCase();
      const co = (l.company_name ?? "").toLowerCase();
      if (!nm.includes(q) && !co.includes(q)) return false;
    }
    if (filters.role.length > 0 && (!l.role || !filters.role.includes(l.role))) return false;
    if (filters.industry.length > 0 && (!l.industry || !filters.industry.includes(l.industry))) return false;
    if (filters.country.length > 0 && (!l.country || !filters.country.includes(l.country))) return false;
    if (filters.company.length > 0 && (!l.company_name || !filters.company.includes(l.company_name))) return false;
    if (filters.score.length > 0) {
      const s = l.lead_score ?? 0;
      const band = s >= 80 ? "hot" : s >= 50 ? "warm" : "nurture";
      if (!filters.score.includes(band)) return false;
    }
    return true;
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));

  function toggle(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  }
  function toggleAllFiltered() {
    const n = new Set(selected);
    if (allFilteredSelected) filtered.forEach(l => n.delete(l.id));
    else filtered.forEach(l => n.add(l.id));
    setSelected(n);
  }
  function clearSelection() { setSelected(new Set()); }

  function continueToWizard() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      // "Use all eligible" path — no ?leads param means the wizard treats
      // every same-ICP lead as the cohort.
      router.push(`/campaigns/new/${profileId}`);
    } else {
      router.push(`/campaigns/new/${profileId}?leads=${ids.join(",")}`);
    }
  }

  return (
    <div>
      {/* Branded header — same navy + gold language as the Lead Miner
          section header on /campaigns so the seller knows they're still
          inside the flow-creation context for this ICP. */}
      <header
        className="relative rounded-2xl overflow-hidden px-6 py-5 mb-5"
        style={{
          background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
          border: `1px solid color-mix(in srgb, ${gold} 28%, ${N.hairline})`,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 22%, transparent), 0 14px 32px -18px ${N.ink}`,
        }}
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${gold} 50%, transparent) 50%, transparent 100%)` }} />
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: gold }}>
              New outreach flow · {profileName}
            </p>
            <h1
              className="text-[24px] sm:text-[28px] font-semibold leading-tight mt-1.5"
              style={{
                color: "white",
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                letterSpacing: "-0.02em",
              }}
            >
              Select the leads for this flow
            </h1>
            <p className="text-[13px] mt-2 max-w-[640px]" style={{ color: "color-mix(in srgb, white 65%, transparent)" }}>
              {leads.length === 0
                ? "No eligible leads for this ICP — every lead is already in an active or paused flow."
                : "Pick the leads you want to enrol. Filter by industry, country, company, role or score. Continue without selecting any to use every eligible lead in this ICP."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/campaigns"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
              style={{
                color: "color-mix(in srgb, white 80%, transparent)",
                border: `1px solid color-mix(in srgb, white 20%, transparent)`,
              }}
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={continueToWizard}
              disabled={leads.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
              style={{
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
                color: N.ink,
                boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 34%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
              }}
            >
              Continue
              {selected.size > 0 && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                  style={{ backgroundColor: N.ink, color: gold }}>
                  {selected.size}
                </span>
              )}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      {leads.length === 0 ? null : (
        <>
          <LeadFilterBar
            filters={filters}
            onChange={setFilters}
            resultCount={filtered.length}
            totalCount={leads.length}
            roleOptions={roleOptions}
            industryOptions={industryOptions}
            countryOptions={countryOptions}
            companyOptions={companyOptions}
            showCampaignFilter={false}
            showProfileFilter={false}
            showStatusPills={false}
          />

          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="px-5 py-3 border-b flex items-center justify-between flex-wrap gap-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <button
                type="button"
                onClick={toggleAllFiltered}
                className="inline-flex items-center gap-2 text-[12px] font-semibold transition-opacity hover:opacity-80"
                style={{ color: C.textBody }}
              >
                {allFilteredSelected
                  ? <CheckSquare size={14} style={{ color: gold }} />
                  : <Square size={14} style={{ color: C.textDim }} />}
                {allFilteredSelected ? "Deselect all" : "Select all"}
                <span className="text-[11px]" style={{ color: C.textMuted }}>
                  ({filtered.length === leads.length ? leads.length : `${filtered.length} of ${leads.length}`})
                </span>
              </button>
              <div className="flex items-center gap-2 text-[11.5px]" style={{ color: C.textMuted }}>
                <Users size={12} />
                <span>
                  <span className="font-bold" style={{ color: gold }}>{selected.size}</span> selected
                </span>
                {selected.size > 0 && (
                  <button type="button" onClick={clearSelection} className="ml-2 text-[11px] underline" style={{ color: C.textDim }}>
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="divide-y max-h-[640px] overflow-y-auto" style={{ borderColor: C.border }}>
              {filtered.length === 0 ? (
                <p className="px-5 py-10 text-center text-[12.5px]" style={{ color: C.textDim }}>
                  No leads match the current filters.
                </p>
              ) : filtered.map(l => {
                const checked = selected.has(l.id);
                const nm = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unknown";
                const sub = [l.role, l.company_name, l.country].filter(Boolean).join(" · ");
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggle(l.id)}
                    className="w-full flex items-center gap-4 px-5 py-2.5 text-left transition-colors hover:bg-gray-50"
                    style={{ backgroundColor: checked ? `color-mix(in srgb, ${gold} 4%, transparent)` : "transparent" }}
                  >
                    {checked
                      ? <CheckSquare size={14} style={{ color: gold }} />
                      : <Square size={14} style={{ color: C.textDim }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{nm}</p>
                      {sub && (
                        <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{sub}</p>
                      )}
                    </div>
                    {l.lead_score != null && (
                      <span
                        className="text-[10.5px] font-bold tabular-nums px-2 py-0.5 rounded-md shrink-0"
                        style={{
                          backgroundColor: l.lead_score >= 80 ? "rgba(220,38,38,0.10)"
                            : l.lead_score >= 50 ? "rgba(217,119,6,0.10)"
                            : "rgba(148,163,184,0.18)",
                          color: l.lead_score >= 80 ? "#DC2626"
                            : l.lead_score >= 50 ? "#D97706"
                            : "#64748B",
                        }}
                      >
                        {l.lead_score}
                      </span>
                    )}
                    {l.industry && (
                      <span className="hidden md:inline text-[10.5px] truncate shrink-0 max-w-[180px]"
                        style={{ color: C.textDim }} title={l.industry}>
                        {l.industry}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
