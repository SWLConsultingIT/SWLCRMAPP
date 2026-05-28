"use client";

// Results · ICP → Campaign accordion (boss 2026-05-28 r5).
//
// Earlier this page reused WonView / LostLeadsView / RenurturingView from
// LeadsCampaignsClient — flat 2-col card grids that lost the ICP +
// Campaign provenance the boss needs. The new layout groups every lead
// under its Lead Miner Profile, then under the campaign it ran on, so a
// "Won" tab reads as:
//
//   ┌─ Industrial Energy — Italian Food Manufacturing (3 wins) ──────┐
//   │  ▸ Q2 2026 — Industrial Solar Audit (2)                        │
//   │  ▸ Q1 2026 — Storage Retrofit Outreach (1)                     │
//   └─────────────────────────────────────────────────────────────────┘
//
// Each lead is a full-width horizontal row (avatar · name/role/company ·
// outcome stats · View link). Lost retains its bulk Recover/Delete
// toolbar with a floating action bar that aggregates selection across
// the accordion sections.

import { useMemo, useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import {
  Trophy, X, RefreshCw, Search, ChevronRight, Target,
  Star, CheckSquare, Square, Trash2, Flame, MessageCircle,
} from "lucide-react";
import type { LostLead, RenurturingLead } from "@/components/LeadsCampaignsClient";
import type { OpportunityLead } from "@/components/OpportunitiesTable";

const gold = "var(--brand, #c9a83a)";

type Tab = "won" | "lost" | "renurture";

type Props = {
  wonLeads: OpportunityLead[];
  lostLeads: LostLead[];
  renurturingLeads: RenurturingLead[];
};

type Tr = (key: string, vars?: Record<string, string | number>) => string;

// Generic ICP → Campaign grouping. Each lead exposes profile_name +
// the campaign name field varies by lead type, so the caller picks.
function groupByIcpCampaign<L>(
  leads: L[],
  getIcp: (l: L) => string | null | undefined,
  getCampaign: (l: L) => string | null | undefined,
  t: Tr,
) {
  const noIcp = t("results.section.noIcp");
  const noCamp = t("results.section.noCampaign");
  const icpMap = new Map<string, { icp: string; campaigns: Map<string, L[]> }>();
  for (const lead of leads) {
    const icpKey = (getIcp(lead) ?? "").trim() || noIcp;
    const campKey = (getCampaign(lead) ?? "").trim() || noCamp;
    let icpBucket = icpMap.get(icpKey);
    if (!icpBucket) { icpBucket = { icp: icpKey, campaigns: new Map() }; icpMap.set(icpKey, icpBucket); }
    let campBucket = icpBucket.campaigns.get(campKey);
    if (!campBucket) { campBucket = []; icpBucket.campaigns.set(campKey, campBucket); }
    campBucket.push(lead);
  }
  // Sort ICPs by total lead count desc, then alpha; same for campaigns.
  return Array.from(icpMap.values())
    .map(g => ({
      icp: g.icp,
      total: Array.from(g.campaigns.values()).reduce((s, arr) => s + arr.length, 0),
      campaigns: Array.from(g.campaigns.entries())
        .map(([name, leads]) => ({ name, leads }))
        .sort((a, b) => b.leads.length - a.leads.length || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.total - a.total || a.icp.localeCompare(b.icp));
}

// ── Horizontal lead rows ──────────────────────────────────────────────

function Avatar({ name, color, company }: { name: string; color: string; company: string | null | undefined }) {
  const seed = company ?? name;
  const initial = (seed?.[0] ?? "?").toUpperCase();
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 72%, white))`, color: "#fff" }}>
      {initial}
    </div>
  );
}

function WonRow({ lead, t }: { lead: OpportunityLead; t: Tr }) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("results.row.unknown");
  return (
    <Link href={`/opportunities/${lead.id}`}
      className="flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md"
      style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.green }}>
      <Avatar name={name} color={C.green} company={lead.company} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-bold truncate" style={{ color: C.textPrimary }}>{name}</span>
          {lead.is_priority && <Star size={10} fill={gold} stroke={gold} className="shrink-0" />}
        </div>
        <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
          {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
        </p>
      </div>
      {lead.win_text && (
        <div className="hidden md:block max-w-xs min-w-0">
          <p className="text-[11px] italic truncate" style={{ color: C.textBody }}>“{lead.win_text}”</p>
        </div>
      )}
      <div className="flex items-center gap-3 shrink-0 text-right">
        {lead.days_to_convert != null && (
          <span className="text-[10px] tabular-nums px-2 py-0.5 rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
            {t("results.won.daysToConvert", { n: lead.days_to_convert })}
          </span>
        )}
        {lead.transferred ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: C.greenLight, color: C.green }}>
            <Trophy size={9} /> {t("results.won.inCrm")}
          </span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
            {t("results.won.pendingTransfer")}
          </span>
        )}
        <ChevronRight size={14} style={{ color: C.textDim }} />
      </div>
    </Link>
  );
}

function LostRow({ lead, t, selected, onToggle }: {
  lead: LostLead;
  t: Tr;
  selected: boolean;
  onToggle: (id: string, shift: boolean) => void;
}) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("results.row.unknown");
  const isNegative = lead.reason === "negative";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-shadow hover:shadow-md group/row"
      style={{
        backgroundColor: C.card,
        borderColor: selected ? C.red : C.border,
        borderLeftWidth: 3,
        borderLeftColor: isNegative ? C.red : C.textDim,
        boxShadow: selected ? `0 0 0 2px color-mix(in srgb, ${C.red} 40%, transparent)` : undefined,
      }}>
      <button
        onClick={e => onToggle(lead.id, e.shiftKey)}
        className="w-5 h-5 inline-flex items-center justify-center shrink-0 transition-opacity opacity-50 hover:opacity-100 group-hover/row:opacity-100"
        style={{ color: selected ? C.red : C.textDim, opacity: selected ? 1 : undefined }}
        aria-label="Select lead"
      >
        {selected ? <CheckSquare size={14} /> : <Square size={14} />}
      </button>
      <Avatar name={name} color={gold} company={lead.company} />
      <Link href={`/leads/lost/${lead.id}`} className="flex-1 min-w-0 group">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-bold truncate group-hover:underline" style={{ color: C.textPrimary }}>{name}</span>
          {lead.is_priority && <Star size={10} fill={gold} stroke={gold} className="shrink-0" />}
        </div>
        <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
          {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
        </p>
      </Link>
      {lead.reply_text && (
        <div className="hidden md:block max-w-xs min-w-0">
          <p className="text-[11px] italic truncate" style={{ color: C.red }}>“{lead.reply_text}”</p>
        </div>
      )}
      <div className="flex items-center gap-3 shrink-0 text-right">
        <span className="text-[10px] tabular-nums" style={{ color: C.textDim }}>
          {t("results.lost.stepsLine", {
            done: lead.steps_completed,
            total: lead.steps_total,
            channels: lead.channels.join(", ") || "—",
          })}
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0" style={{
          backgroundColor: isNegative ? C.redLight : C.surface,
          color: isNegative ? C.red : C.textMuted,
        }}>
          {isNegative ? t("results.lost.negativeReply") : t("results.lost.noReply")}
        </span>
        <ChevronRight size={14} style={{ color: C.textDim }} />
      </div>
    </div>
  );
}

function RenurtureRow({ lead, t }: { lead: RenurturingLead; t: Tr }) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("results.row.unknown");
  const isPending = lead.new_campaign_status === "pending_review";
  const statusColor = isPending ? "#D97706"
    : lead.new_campaign_status === "cancelled" ? C.red
    : lead.new_campaign_status === "paused" ? "#D97706" : C.green;
  return (
    <Link href={`/leads/lost/${lead.id}`}
      className="flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md"
      style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.green }}>
      <Avatar name={name} color={C.green} company={lead.company} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-bold truncate" style={{ color: C.textPrimary }}>{name}</span>
          {lead.is_priority && <Star size={10} fill={gold} stroke={gold} className="shrink-0" />}
        </div>
        <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
          {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
        </p>
      </div>
      {lead.new_campaign_name && (
        <div className="hidden md:flex flex-col items-end min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>{t("results.renurture.newCampaign")}</span>
          <span className="text-[11px] font-semibold truncate" style={{ color: C.textBody }}>{lead.new_campaign_name}</span>
        </div>
      )}
      <div className="flex items-center gap-3 shrink-0">
        {lead.new_campaign_step != null && lead.new_campaign_total_steps != null && !isPending && (
          <span className="text-[10px] tabular-nums" style={{ color: C.textDim }}>
            {t("results.renurture.stepsLine", {
              step: lead.new_campaign_step,
              total: lead.new_campaign_total_steps,
              status: lead.new_campaign_status ?? "",
            })}
          </span>
        )}
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{
          backgroundColor: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
          color: statusColor,
        }}>
          {isPending ? t("results.renurture.dormant") : (lead.new_campaign_status ?? "—")}
        </span>
        <ChevronRight size={14} style={{ color: C.textDim }} />
      </div>
    </Link>
  );
}

// ── Accordion frame ───────────────────────────────────────────────────

function Section<L>({
  group, renderRow, t,
}: {
  group: { icp: string; total: number; campaigns: Array<{ name: string; leads: L[] }> };
  renderRow: (lead: L) => React.ReactNode;
  t: Tr;
}) {
  return (
    <details open className="rounded-2xl border overflow-hidden mb-3"
      style={{ borderColor: C.border, backgroundColor: C.card }}>
      <summary className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-black/[0.02] transition-colors">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
            boxShadow: `0 3px 10px color-mix(in srgb, ${gold} 25%, transparent)`,
          }}>
          <Target size={14} style={{ color: "#fff" }} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: gold }}>
            {t("results.section.eyebrow")}
          </p>
          <p className="text-[15px] font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {group.icp}
            <span className="ml-2 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md align-middle"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {group.total} {group.total === 1 ? t("results.section.lead") : t("results.section.leads")}
            </span>
          </p>
        </div>
        <ChevronRight size={16} className="acc-chevron shrink-0" style={{ color: C.textMuted }} />
      </summary>
      <div className="p-3 space-y-3 border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        {group.campaigns.map(camp => (
          <div key={camp.name}>
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle size={11} style={{ color: gold }} />
              <span className="text-[11px] font-bold" style={{ color: C.textPrimary }}>{camp.name}</span>
              <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md" style={{ backgroundColor: C.surface, color: C.textMuted }}>
                {camp.leads.length}
              </span>
            </div>
            <div className="space-y-2">
              {camp.leads.map(lead => renderRow(lead))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

// ── Main client ───────────────────────────────────────────────────────

export default function ResultsClient({ wonLeads, lostLeads, renurturingLeads }: Props) {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>(
    wonLeads.length > 0 ? "won" : lostLeads.length > 0 ? "lost" : "renurture",
  );
  const [search, setSearch] = useState("");

  // Lost-tab selection state (persists across ICP/campaign groupings).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recovering, setRecovering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const wonFiltered = useMemo(() => {
    if (!search) return wonLeads;
    const q = search.toLowerCase();
    return wonLeads.filter(l => `${l.first_name ?? ""} ${l.last_name ?? ""} ${l.company ?? ""} ${l.campaign_name ?? ""} ${l.profile_name ?? ""}`.toLowerCase().includes(q));
  }, [wonLeads, search]);

  const lostFiltered = useMemo(() => {
    if (!search) return lostLeads;
    const q = search.toLowerCase();
    return lostLeads.filter(l => `${l.first_name ?? ""} ${l.last_name ?? ""} ${l.company ?? ""} ${l.campaign_name ?? ""} ${l.profile_name ?? ""}`.toLowerCase().includes(q));
  }, [lostLeads, search]);

  const renurFiltered = useMemo(() => {
    if (!search) return renurturingLeads;
    const q = search.toLowerCase();
    return renurturingLeads.filter(l => `${l.first_name ?? ""} ${l.last_name ?? ""} ${l.company ?? ""} ${l.new_campaign_name ?? ""} ${l.profile_name ?? ""}`.toLowerCase().includes(q));
  }, [renurturingLeads, search]);

  const wonGroups   = useMemo(() => groupByIcpCampaign(wonFiltered,   l => l.profile_name, l => l.campaign_name,     t), [wonFiltered, t]);
  const lostGroups  = useMemo(() => groupByIcpCampaign(lostFiltered,  l => l.profile_name, l => l.campaign_name,     t), [lostFiltered, t]);
  const renurGroups = useMemo(() => groupByIcpCampaign(renurFiltered, l => l.profile_name, l => l.new_campaign_name, t), [renurFiltered, t]);

  const lostAllIds = useMemo(() => lostFiltered.map(l => l.id), [lostFiltered]);

  function toggleLostSelect(id: string, shift: boolean) {
    if (shift && lastSelectedId && lastSelectedId !== id) {
      const from = lostAllIds.indexOf(lastSelectedId);
      const to = lostAllIds.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [a, b] = from < to ? [from, to] : [to, from];
        const range = lostAllIds.slice(a, b + 1);
        setSelected(prev => {
          const next = new Set(prev);
          const allOn = range.every(x => next.has(x));
          range.forEach(x => allOn ? next.delete(x) : next.add(x));
          return next;
        });
        setLastSelectedId(id);
        return;
      }
    }
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setLastSelectedId(id);
  }

  function selectAllLost() {
    setSelected(new Set(lostAllIds));
  }

  function clearLostSelection() {
    setSelected(new Set());
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} lead${ids.length > 1 ? "s" : ""} permanently? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/leads/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
        window.alert(`Delete failed: ${error}`);
      }
      window.location.reload();
    } finally {
      setDeleting(false);
    }
  }

  async function recoverSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Recover ${ids.length} lead${ids.length > 1 ? "s" : ""}? Their finished campaigns will be archived and the lead becomes contactable again.`)) return;
    setRecovering(true);
    try {
      const res = await fetch("/api/leads/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Recover failed" }));
        window.alert(`Recover failed: ${error}`);
      }
      window.location.reload();
    } finally {
      setRecovering(false);
    }
  }

  const tabs = [
    { key: "won"       as const, label: t("results.tab.won"),       count: wonLeads.length,         color: C.green, icon: Trophy },
    { key: "lost"      as const, label: t("results.tab.lost"),      count: lostLeads.length,        color: C.red,   icon: X },
    { key: "renurture" as const, label: t("results.tab.renurture"), count: renurturingLeads.length, color: gold,    icon: RefreshCw },
  ];

  const searchPlaceholder = tab === "won" ? t("results.search.won") : tab === "lost" ? t("results.search.lost") : t("results.search.renurture");

  return (
    <div className="w-full">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-4" style={{ borderColor: C.border }}>
        {tabs.map(tab2 => {
          const isActive = tab === tab2.key;
          const Icon = tab2.icon;
          return (
            <button
              key={tab2.key}
              onClick={() => { setTab(tab2.key); setSelected(new Set()); }}
              className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-[color,background-color] relative whitespace-nowrap"
              style={{
                color: isActive ? tab2.color : C.textMuted,
                backgroundColor: isActive ? `color-mix(in srgb, ${tab2.color} 6%, transparent)` : "transparent",
              }}
            >
              <Icon size={13} />
              {tab2.label}
              {tab2.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{
                  backgroundColor: isActive ? `color-mix(in srgb, ${tab2.color} 15%, transparent)` : C.cardHov,
                  color: isActive ? tab2.color : C.textDim,
                }}>
                  {tab2.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: tab2.color }} />}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 mb-4 rounded-lg border px-3 py-1.5 max-w-md"
        style={{ borderColor: C.border, backgroundColor: C.card }}>
        <Search size={14} style={{ color: C.textDim }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="bg-transparent text-sm outline-none flex-1"
          style={{ color: C.textPrimary }}
        />
        {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
      </div>

      {/* Hide native <details> marker */}
      <style>{`
        .results-acc summary { list-style: none; }
        .results-acc summary::-webkit-details-marker { display: none; }
        .results-acc details[open] > summary .acc-chevron { transform: rotate(90deg); }
        .results-acc .acc-chevron { transition: transform 0.18s ease; }
      `}</style>

      <div className="results-acc">
        {tab === "won" && (
          wonGroups.length === 0 ? (
            <EmptyState icon={Trophy} title={t("results.empty.won.title")} desc={t("results.empty.won.desc")} />
          ) : wonGroups.map(g => (
            <Section key={g.icp} group={g} t={t} renderRow={lead => <WonRow key={lead.id} lead={lead} t={t} />} />
          ))
        )}

        {tab === "lost" && (
          lostGroups.length === 0 ? (
            <EmptyState icon={X} title={t("results.empty.lost.title")} desc={t("results.empty.lost.desc")} />
          ) : lostGroups.map(g => (
            <Section key={g.icp} group={g} t={t} renderRow={lead => (
              <LostRow key={lead.id} lead={lead} t={t} selected={selected.has(lead.id)} onToggle={toggleLostSelect} />
            )} />
          ))
        )}

        {tab === "renurture" && (
          renurGroups.length === 0 ? (
            <EmptyState icon={RefreshCw} title={t("results.empty.renurture.title")} desc={t("results.empty.renurture.desc")} />
          ) : renurGroups.map(g => (
            <Section key={g.icp} group={g} t={t} renderRow={lead => <RenurtureRow key={lead.id} lead={lead} t={t} />} />
          ))
        )}
      </div>

      {/* Lost bulk-action floating bar — only when items selected */}
      {tab === "lost" && selected.size > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none" style={{ bottom: 24 }}>
          <div className="pointer-events-auto rounded-2xl border flex items-center gap-3 px-4 py-3 shadow-2xl"
            style={{
              background: "linear-gradient(135deg, #0B0F1A 0%, #111827 60%, #0B0F1A 100%)",
              borderColor: `color-mix(in srgb, ${gold} 38%, transparent)`,
              boxShadow: `0 24px 64px -12px rgba(11,15,26,0.6), 0 0 0 1px color-mix(in srgb, ${gold} 26%, transparent)`,
            }}>
            <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1505" }}>
              <Flame size={15} />
            </span>
            <p className="text-[13px] font-bold leading-tight" style={{ color: "#fff", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {selected.size} {selected.size === 1 ? t("results.section.lead") : t("results.section.leads")}
            </p>
            <button onClick={selectAllLost} disabled={recovering || deleting}
              className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-white/[0.06]"
              style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.18)" }}>
              {t("results.lost.selectAll")}
            </button>
            <button onClick={recoverSelected} disabled={recovering || deleting}
              className="text-[12.5px] font-bold px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 75%, white))`, color: "#1A1505", boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 38%, transparent)` }}>
              <RefreshCw size={13} className={recovering ? "animate-spin" : ""} />
              {recovering ? t("results.lost.bulkRecovering") : t("results.lost.recoverN", { n: selected.size })}
            </button>
            <button onClick={deleteSelected} disabled={recovering || deleting}
              className="text-[12px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #DC2626, #B91C1C)", color: "#fff", boxShadow: "0 4px 14px rgba(220,38,38,0.35)" }}>
              <Trash2 size={12} />
              {deleting ? t("results.lost.bulkDeleting") : t("results.lost.deleteN", { n: selected.size })}
            </button>
            <button onClick={clearLostSelection} disabled={recovering || deleting}
              className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-white/[0.06]"
              style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.18)" }}>
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, desc }: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <Icon size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
      <p className="text-sm font-medium" style={{ color: C.textBody }}>{title}</p>
      <p className="text-xs mt-1" style={{ color: C.textMuted }}>{desc}</p>
    </div>
  );
}
