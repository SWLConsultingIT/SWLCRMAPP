"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, CheckSquare, Building2, Globe, Briefcase, MapPin, Megaphone, Send } from "lucide-react";
import { C, N } from "@/lib/design";
import { LeadFilterBar, emptyLeadFilterState, type LeadFilterState } from "@/components/LeadFilters";
import AddToFlowModalIcpScoped from "@/components/AddToFlowModalIcpScoped";

const gold = "var(--brand, #c9a83a)";

type HistoryKey = "all" | "new" | "renurture" | "lost" | "won";

function HistoryPills({ counts, total, active, onChange }: {
  counts: { new: number; renurture: number; lost: number; won: number };
  total: number;
  active: HistoryKey;
  onChange: (v: HistoryKey) => void;
}) {
  type PillDef = { key: HistoryKey; label: string; count: number; color: string; bg: string; border: string };
  const pills: PillDef[] = ([
    { key: "all"       as HistoryKey, label: "All",        count: total,            color: "#6B7280", bg: "#F3F4F6",                   border: "#D1D5DB" },
    { key: "new"       as HistoryKey, label: "New",        count: counts.new,       color: "#2563EB", bg: "rgba(37,99,235,0.08)",       border: "rgba(37,99,235,0.30)" },
    { key: "renurture" as HistoryKey, label: "Re-nurture", count: counts.renurture, color: "#D97706", bg: "rgba(217,119,6,0.09)",       border: "rgba(217,119,6,0.35)" },
    { key: "lost"      as HistoryKey, label: "Lost",       count: counts.lost,      color: "#DC2626", bg: "rgba(220,38,38,0.08)",       border: "rgba(220,38,38,0.30)" },
    { key: "won"       as HistoryKey, label: "Won",        count: counts.won,       color: "#16A34A", bg: "rgba(22,163,74,0.08)",       border: "rgba(22,163,74,0.30)" },
  ] as PillDef[]).filter(p => p.key === "all" || p.count > 0);

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {pills.map(p => {
        const isActive = active === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              border: `1.5px solid ${isActive ? p.color : p.border}`,
              backgroundColor: isActive ? p.color : p.bg,
              color: isActive ? "#fff" : p.color,
            }}
          >
            {p.label}
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              backgroundColor: isActive ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.06)",
              borderRadius: 999,
              padding: "0 5px",
            }}>
              {p.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
  history: "new" | "renurture" | "lost" | "won";
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
  const [historyFilter, setHistoryFilter] = useState<"all" | "new" | "renurture" | "lost" | "won">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddToFlow, setShowAddToFlow] = useState(false);
  // Anchor for shift-click range selection (boss 2026-06-08: "selecting
  // multiple leads and not all easily"). Indexes into the sorted `filtered`.
  const [lastIdx, setLastIdx] = useState<number | null>(null);

  // Filter options derived from the cohort. Industry / Country / Company
  // / Role read straight off the picker rows so the dropdowns only show
  // values the seller can actually pick.
  const roleOptions     = Array.from(new Set(leads.map(l => l.role).filter(Boolean) as string[])).sort();
  const industryOptions = Array.from(new Set(leads.map(l => l.industry).filter(Boolean) as string[])).sort();
  const countryOptions  = Array.from(new Set(leads.map(l => l.country).filter(Boolean) as string[])).sort();
  const companyOptions  = Array.from(new Set(leads.map(l => l.company_name).filter(Boolean) as string[])).sort();

  const historyCounts = {
    new:      leads.filter(l => l.history === "new").length,
    renurture: leads.filter(l => l.history === "renurture").length,
    lost:     leads.filter(l => l.history === "lost").length,
    won:      leads.filter(l => l.history === "won").length,
  };

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
    // Role exclude (boss 2026-06-08): all roles in by default, untick to drop.
    if (filters.roleExclude.length > 0 && l.role && filters.roleExclude.includes(l.role)) return false;
    if (filters.industry.length > 0 && (!l.industry || !filters.industry.includes(l.industry))) return false;
    if (filters.country.length > 0 && (!l.country || !filters.country.includes(l.country))) return false;
    if (filters.company.length > 0 && (!l.company_name || !filters.company.includes(l.company_name))) return false;
    if (filters.score.length > 0) {
      const s = l.lead_score ?? 0;
      const band = s >= 80 ? "hot" : s >= 50 ? "warm" : "nurture";
      if (!filters.score.includes(band)) return false;
    }
    if (historyFilter !== "all" && l.history !== historyFilter) return false;
    return true;
  })
    // Alphabetical by name (boss 2026-06-08) so the list is scannable.
    .sort((a, b) =>
      `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim().toLowerCase()
        .localeCompare(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim().toLowerCase()),
    );

  const allFilteredSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));

  // Click toggles one; shift-click selects the contiguous range from the last
  // clicked row (standard list-multiselect, over the sorted `filtered`).
  function toggle(id: string, idx?: number, shift?: boolean) {
    if (shift && lastIdx !== null && idx !== undefined) {
      const [a, b] = [Math.min(lastIdx, idx), Math.max(lastIdx, idx)];
      const n = new Set(selected);
      for (let i = a; i <= b; i++) if (filtered[i]) n.add(filtered[i].id);
      setSelected(n);
      setLastIdx(idx);
      return;
    }
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
    if (idx !== undefined) setLastIdx(idx);
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
    if (ids.length === 0) return;
    router.push(`/campaigns/new/${profileId}?leads=${ids.join(",")}`);
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
                : "Pick the leads you want to enrol. Once selected, you can create a new flow with them or add them to an existing flow for this ICP."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/campaigns"
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
              style={{
                color: "color-mix(in srgb, white 80%, transparent)",
                border: `1px solid color-mix(in srgb, white 20%, transparent)`,
              }}
            >
              Cancel
            </Link>
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
            roleExcludeMode
          />

          {/* History filter pills */}
          <HistoryPills
            counts={historyCounts}
            total={leads.length}
            active={historyFilter}
            onChange={setHistoryFilter}
          />

          <div
            className="rounded-2xl border overflow-hidden"
            style={{
              backgroundColor: C.card,
              borderColor: `color-mix(in srgb, ${gold} 16%, ${C.border})`,
              boxShadow: `0 1px 3px rgba(0,0,0,0.05), 0 0 0 1px color-mix(in srgb, ${gold} 6%, transparent)`,
            }}
          >
            {/* List toolbar — select-all on the left, selection counter
                on the right. Sits over a faint gold tint so the rows
                underneath read as a distinct content surface. */}
            <div
              className="px-5 py-3.5 border-b flex items-center justify-between flex-wrap gap-3"
              style={{
                borderColor: `color-mix(in srgb, ${gold} 12%, ${C.border})`,
                background: `linear-gradient(180deg, color-mix(in srgb, ${gold} 5%, ${C.bg}) 0%, ${C.bg} 100%)`,
              }}
            >
              <button
                type="button"
                onClick={toggleAllFiltered}
                className="inline-flex items-center gap-2.5 text-[12.5px] font-semibold transition-opacity hover:opacity-80"
                style={{ color: C.textPrimary }}
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-md"
                  style={{
                    backgroundColor: allFilteredSelected ? gold : "transparent",
                    border: `1.5px solid ${allFilteredSelected ? gold : C.border}`,
                  }}
                >
                  {allFilteredSelected && <CheckSquare size={11} style={{ color: N.ink }} strokeWidth={3} />}
                </span>
                {allFilteredSelected ? "Deselect all" : "Select all"}
                <span className="text-[11px] font-medium" style={{ color: C.textMuted }}>
                  ({filtered.length === leads.length ? leads.length : `${filtered.length} of ${leads.length}`})
                </span>
              </button>
              <span className="hidden lg:inline text-[10.5px]" style={{ color: C.textDim }}>
                Tip: shift-click to select a range
              </span>
              <div className="flex items-center gap-3 text-[12px]" style={{ color: C.textBody }}>
                <span className="inline-flex items-center gap-1.5">
                  <Users size={13} style={{ color: gold }} />
                  <span>
                    <span className="text-[15px] font-bold tabular-nums" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{selected.size}</span>
                    <span className="ml-1" style={{ color: C.textMuted }}>selected</span>
                  </span>
                </span>
                {selected.size > 0 && (
                  <>
                    <span className="h-3.5 w-px" style={{ backgroundColor: C.border }} />
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="text-[11.5px] font-medium hover:underline"
                      style={{ color: C.textDim }}
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="divide-y max-h-[640px] overflow-y-auto" style={{ borderColor: C.border }}>
              {filtered.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-[13px] font-medium" style={{ color: C.textBody }}>
                    No leads match the current filters.
                  </p>
                  <p className="text-[11.5px] mt-1" style={{ color: C.textDim }}>
                    Clear a facet above to widen the cohort.
                  </p>
                </div>
              ) : filtered.map((l, idx) => {
                const checked = selected.has(l.id);
                const nm = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unknown";
                const initials = `${l.first_name?.[0] ?? ""}${l.last_name?.[0] ?? ""}`.toUpperCase() || "··";
                const scoreBand: "hot" | "warm" | "nurture" = l.lead_score != null && l.lead_score >= 80
                  ? "hot" : l.lead_score != null && l.lead_score >= 50 ? "warm" : "nurture";
                const scoreMeta = {
                  hot:     { color: "#DC2626", bg: "rgba(220,38,38,0.10)", border: "rgba(220,38,38,0.25)" },
                  warm:    { color: "#D97706", bg: "rgba(217,119,6,0.10)", border: "rgba(217,119,6,0.25)" },
                  nurture: { color: "#64748B", bg: "rgba(148,163,184,0.14)", border: "rgba(148,163,184,0.28)" },
                }[scoreBand];
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={(e) => toggle(l.id, idx, e.shiftKey)}
                    className="w-full flex items-center gap-3.5 px-5 py-3 text-left transition-[background-color,box-shadow,border-color] hover:bg-gray-50 group"
                    style={{
                      backgroundColor: checked ? `color-mix(in srgb, ${gold} 5%, transparent)` : "transparent",
                      boxShadow: checked
                        ? `inset 3px 0 0 ${gold}, inset 0 -1px 0 color-mix(in srgb, ${gold} 12%, transparent)`
                        : "inset 3px 0 0 transparent",
                    }}
                  >
                    {/* Checkbox — bigger, gold when checked */}
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-colors"
                      style={{
                        backgroundColor: checked ? gold : "transparent",
                        border: `1.5px solid ${checked ? gold : C.border}`,
                      }}
                    >
                      {checked && <CheckSquare size={11} style={{ color: N.ink }} strokeWidth={3} />}
                    </span>

                    {/* Avatar with initials — soft gold tint to anchor the row */}
                    <span
                      className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-[11.5px] font-bold uppercase shrink-0 tabular-nums"
                      style={{
                        background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 18%, transparent) 0%, color-mix(in srgb, ${gold} 8%, transparent) 100%)`,
                        color: gold,
                        border: `1px solid color-mix(in srgb, ${gold} 28%, transparent)`,
                        fontFamily: "var(--font-outfit), system-ui, sans-serif",
                      }}
                      aria-hidden
                    >
                      {initials}
                    </span>

                    {/* Identity + role + company */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold leading-tight"
                        style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                        {nm}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[11.5px] min-w-0" style={{ color: C.textMuted }}>
                        {l.role && (
                          <span className="inline-flex items-center gap-1 truncate" title={l.role}>
                            <Briefcase size={10} style={{ color: C.textDim }} />
                            <span className="truncate">{l.role}</span>
                          </span>
                        )}
                        {l.role && l.company_name && (
                          <span className="opacity-50" style={{ color: C.textDim }}>·</span>
                        )}
                        {l.company_name && (
                          <span className="inline-flex items-center gap-1 truncate" title={l.company_name}>
                            <Building2 size={10} style={{ color: C.textDim }} />
                            <span className="truncate" style={{ color: C.textBody, fontWeight: 500 }}>{l.company_name}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right-side chip cluster — country, industry, history badge, score */}
                    <div className="hidden md:flex items-center gap-1.5 shrink-0">
                      {l.country && (
                        <span
                          className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md"
                          style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
                          title={l.country}
                        >
                          <MapPin size={9} style={{ color: C.textDim }} />
                          {l.country}
                        </span>
                      )}
                      {l.industry && (
                        <span
                          className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md max-w-[170px] truncate"
                          style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
                          title={l.industry}
                        >
                          <Globe size={9} style={{ color: C.textDim }} />
                          <span className="truncate">{l.industry}</span>
                        </span>
                      )}
                    </div>
                    {l.history !== "new" && (() => {
                      const hMeta = {
                        renurture: { label: "Re-nurture", color: "#D97706", bg: "rgba(217,119,6,0.10)", border: "rgba(217,119,6,0.28)" },
                        lost:      { label: "Lost",       color: "#DC2626", bg: "rgba(220,38,38,0.10)", border: "rgba(220,38,38,0.22)" },
                        won:       { label: "Won",        color: "#16A34A", bg: "rgba(22,163,74,0.10)", border: "rgba(22,163,74,0.22)" },
                      }[l.history];
                      return (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
                          style={{ backgroundColor: hMeta.bg, color: hMeta.color, border: `1px solid ${hMeta.border}` }}
                        >
                          {hMeta.label}
                        </span>
                      );
                    })()}
                    {l.lead_score != null && (
                      <span
                        className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md shrink-0"
                        style={{
                          backgroundColor: scoreMeta.bg,
                          color: scoreMeta.color,
                          border: `1px solid ${scoreMeta.border}`,
                          fontFamily: "var(--font-outfit), system-ui, sans-serif",
                        }}
                      >
                        {l.lead_score}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Floating selection bar — appears when at least one lead is picked.
          Matches the /leads bulk bar: two primary actions (Add to existing
          flow / Create new flow) instead of a single Continue button so the
          seller can pick either path without leaving the page. ICP is fixed
          (profileId) so the one-ICP-per-campaign LAW is automatically
          satisfied for the modal too. */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl px-3 py-2.5 pl-5 flex-wrap"
          style={{
            background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
            border: `1px solid color-mix(in srgb, ${gold} 36%, ${N.hairline})`,
            boxShadow: `0 18px 48px -12px rgba(0,0,0,0.45), 0 0 0 1px color-mix(in srgb, ${gold} 14%, transparent)`,
            animation: "pick-bar-rise 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* gold hairline on top */}
          <span aria-hidden className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 50%, transparent 100%)`, opacity: 0.55 }} />
          <span className="inline-flex items-center gap-2 text-[13px]">
            <Users size={14} style={{ color: gold }} />
            <span style={{ color: "white", fontWeight: 600 }}>
              <span className="text-[16px] tabular-nums" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {selected.size}
              </span>
              <span className="ml-1.5" style={{ color: "color-mix(in srgb, white 75%, transparent)" }}>
                lead{selected.size === 1 ? "" : "s"} selected
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-[11.5px] font-medium px-2 py-1 rounded-md transition-opacity hover:opacity-80"
            style={{
              color: "color-mix(in srgb, white 65%, transparent)",
              border: `1px solid color-mix(in srgb, white 18%, transparent)`,
            }}
          >
            Clear
          </button>
          <span className="h-6 w-px" style={{ backgroundColor: "color-mix(in srgb, white 14%, transparent)" }} />
          {/* Secondary CTA — Add to existing flow (same ICP only). */}
          <button
            type="button"
            onClick={() => setShowAddToFlow(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-bold whitespace-nowrap transition-opacity hover:opacity-90"
            style={{
              background: "rgba(255,255,255,0.08)",
              color: gold,
              border: `1px solid color-mix(in srgb, ${gold} 45%, transparent)`,
            }}
          >
            <Megaphone size={13} /> Add to existing flow
          </button>
          {/* Primary CTA — Create new flow (continues to the wizard with
              the picked leads in the query string). */}
          <button
            type="button"
            onClick={continueToWizard}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-bold whitespace-nowrap transition-[opacity,transform] hover:opacity-90 hover:-translate-y-0.5"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
              color: N.ink,
              boxShadow: `0 6px 18px color-mix(in srgb, ${gold} 38%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
            }}
          >
            <Send size={13} /> Create new flow
          </button>
          <style>{`@keyframes pick-bar-rise { from { transform: translate(-50%, 18px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }`}</style>
        </div>
      )}

      {showAddToFlow && (
        <AddToFlowModalIcpScoped
          leadIds={Array.from(selected)}
          icpProfileId={profileId}
          onClose={() => setShowAddToFlow(false)}
          onAdded={() => {
            setShowAddToFlow(false);
            setSelected(new Set());
            // After adding to an existing flow, send the seller back to
            // /campaigns where they can see the flow they just topped up.
            router.push("/campaigns");
          }}
        />
      )}
    </div>
  );
}
