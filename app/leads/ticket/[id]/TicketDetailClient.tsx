"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import {
  ArrowLeft, Star, Clock, ChevronRight, ChevronDown, ChevronUp, Megaphone,
  PlayCircle, CheckCircle, PauseCircle, XCircle,
  Users as UsersIcon, UserPlus, Share2, Mail, Phone, Trophy, ThumbsDown, MessageSquare, Percent,
  Square, CheckSquare, Plus, X,
} from "lucide-react";
import { LeadFilterBar, emptyLeadFilterState, type LeadFilterState } from "@/components/LeadFilters";

type Tr = (key: string) => string;

const gold = "var(--brand, #c9a83a)";

type LeadInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  status: string | null;
  score: number | null;
  is_priority: boolean;
  channel: string | null;
  reply_count: number;
  has_positive: boolean;
  campaign_name: string | null;
  campaign_status: string | null;
  has_campaign: boolean;
};

type CampaignGroup = {
  name: string;
  firstId: string;
  cohort: "active" | "past";
  channels: string[];
  statuses: Record<string, number>;
  totalLeads: number;
  totalSteps: number;
  totalMsgsSent: number;
  totalReplies: number;
  positiveCount: number;
  lastActivity: string | null;
  avgProgress: number;
  is_renurturing: boolean;
  liInvitesSent: number;
  liMessagesSent: number;
  emailsSent: number;
  acceptRate: number | null;
  acceptedCount: number;
  inviteCohort: number;
  sellers: string[];
};

type TicketMetrics = {
  totalLeads: number;
  unassignedCount: number;
  linkedinInvitesSent: number;
  linkedinMessagesSent: number;
  emailsSent: number;
  callsMade: number;
  won: number;
  lost: number;
  replyRate: number;
  winRate: number;
};

type TicketUpdate = {
  id: string;
  name: string;
  status: "approved" | "rejected" | "pending_review";
  createdAt: string;
  targetLeadsCount: number | null;
};

type Props = {
  profileId: string;
  ticketName: string;
  campaigns: CampaignGroup[];
  leads: LeadInfo[];
  metrics: TicketMetrics;
  updates: TicketUpdate[];
};

// Status meta — `label` field is now resolved via t() at render time.
// `key` is the lookup token for ticket.status.* / ticket.flow.* depending
// on context.
const statusMeta: Record<string, { color: string; bg: string; icon: typeof PlayCircle; key: string }> = {
  active:    { color: C.green,     bg: C.greenLight, icon: PlayCircle,  key: "active" },
  paused:    { color: "#D97706",   bg: "#FFFBEB",    icon: PauseCircle, key: "paused" },
  completed: { color: C.textMuted, bg: C.surface,    icon: CheckCircle, key: "completed" },
  failed:    { color: C.red,       bg: C.redLight,   icon: XCircle,     key: "failed" },
};

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { key: "hot",     color: C.hot,     bg: C.hotBg };
  if (score && score >= 50)              return { key: "warm",    color: C.warm,    bg: C.warmBg };
  return                                        { key: "nurture", color: C.nurture, bg: C.nurtureBg };
}

function timeAgo(iso: string | null, t: Tr) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return t("ticket.time.justNow");
  if (m < 60) return t("ticket.time.minutesAgo").replace("{n}", String(m));
  const h = Math.floor(m / 60);
  if (h < 24) return t("ticket.time.hoursAgo").replace("{n}", String(h));
  return t("ticket.time.daysAgo").replace("{n}", String(Math.floor(h / 24)));
}

// ─── Campaign Card ────────────────────────────────────────────────────────────
function CampaignCard({ camp, t, locale }: { camp: CampaignGroup; t: Tr; locale: "en" | "es" }) {
  const active    = camp.statuses.active ?? 0;
  const paused    = camp.statuses.paused ?? 0;
  const completed = camp.statuses.completed ?? 0;
  const groupStatus = active > 0 ? "active" : paused > 0 ? "paused" : completed > 0 ? "completed" : "failed";
  const st = statusMeta[groupStatus] ?? statusMeta.active;
  const StIcon = st.icon;
  const responseRate = camp.totalLeads > 0 ? Math.round((camp.totalReplies / camp.totalLeads) * 100) : 0;

  // Channel throughput chips — only the ones with actual activity.
  const throughputChips: { icon: typeof Share2; label: string; value: number; color: string }[] = [];
  if (camp.liInvitesSent > 0)  throughputChips.push({ icon: UserPlus, label: locale === "es" ? "LI Invites" : "LI Invites",   value: camp.liInvitesSent,  color: "#0A66C2" });
  if (camp.liMessagesSent > 0) throughputChips.push({ icon: Share2,   label: locale === "es" ? "LI Msgs"   : "LI Msgs",       value: camp.liMessagesSent, color: "#0A66C2" });
  if (camp.emailsSent > 0)     throughputChips.push({ icon: Mail,     label: locale === "es" ? "Emails"    : "Emails",        value: camp.emailsSent,     color: "#059669" });

  const sellerLine = camp.sellers.length === 0
    ? null
    : camp.sellers.length === 1
      ? camp.sellers[0]
      : (locale === "es" ? `${camp.sellers[0]} +${camp.sellers.length - 1}` : `${camp.sellers[0]} +${camp.sellers.length - 1}`);

  return (
    <Link
      href={`/campaigns/${camp.firstId}`}
      className="rounded-xl border overflow-hidden flex flex-col transition-shadow hover:shadow-md group/card"
      style={{
        backgroundColor: C.card,
        borderColor: camp.is_renurturing ? C.green : C.border,
        borderLeftWidth: camp.is_renurturing ? 3 : 1,
        borderLeftColor: camp.is_renurturing ? C.green : C.border,
      }}
    >
      {camp.is_renurturing && (
        <div className="px-4 pt-2 pb-0 flex items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: C.green }}>Re-nurturing</span>
        </div>
      )}
      <div className="px-4 pt-4 pb-3 flex-1">
        <div className="flex items-center gap-1.5 mb-2">
          <Megaphone size={11} style={{ color: gold }} />
          <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: gold }}>{t("ticket.flow.preTitle")}</span>
          <div className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: st.bg }}>
            <StIcon size={10} style={{ color: st.color }} />
            <span className="text-[10px] font-semibold" style={{ color: st.color }}>{t(`ticket.status.${st.key}`)}</span>
          </div>
        </div>

        <h3 className="text-sm font-bold mb-1.5 group-hover/card:underline" style={{ color: C.textPrimary }}>
          {camp.name}
        </h3>

        {/* Seller + last activity line — was missing before. Boss wanted
            the rep responsible visible on every flow card so coverage
            ownership is clear without opening the campaign. */}
        {(sellerLine || camp.lastActivity) && (
          <div className="flex items-center gap-3 text-[10.5px] mb-2.5" style={{ color: C.textMuted }}>
            {sellerLine && (
              <span className="inline-flex items-center gap-1 truncate" title={camp.sellers.join(", ")}>
                <UsersIcon size={11} style={{ color: C.textDim }} />
                <span className="truncate">{sellerLine}</span>
              </span>
            )}
            {camp.lastActivity && (
              <span className="inline-flex items-center gap-1 shrink-0">
                <Clock size={10} style={{ color: C.textDim }} />
                {timeAgo(camp.lastActivity, t)}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: t("ticket.metrics.leads"),         value: camp.totalLeads,     color: C.textBody },
            { label: t("ticket.flow.replies"),          value: camp.totalReplies,   color: C.blue },
            { label: t("ticket.table.replyPositive"),   value: camp.positiveCount,  color: C.green },
          ].map(s => (
            <div key={s.label} className="text-center rounded-lg py-1.5" style={{ backgroundColor: C.bg }}>
              <p className="text-base font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[9px] font-semibold uppercase" style={{ color: C.textDim }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Channel throughput chips — only render channels with activity */}
        {throughputChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            {throughputChips.map(ch => {
              const ChIcon = ch.icon;
              return (
                <span
                  key={ch.label}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${ch.color} 10%, transparent)`,
                    color: ch.color,
                  }}
                >
                  <ChIcon size={10} />
                  <span className="tabular-nums">{ch.value}</span>
                  <span style={{ color: `color-mix(in srgb, ${ch.color} 80%, ${C.textMuted})` }}>{ch.label}</span>
                </span>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 text-[10px]" style={{ color: C.textDim }}>
          <span>{t("ticket.flow.steps").replace("{n}", String(camp.totalSteps))}</span>
          {camp.acceptRate !== null && (
            <span
              className="font-semibold"
              style={{ color: camp.acceptRate >= 50 ? C.green : camp.acceptRate >= 20 ? gold : C.textMuted }}
              title={locale === "es"
                ? `${camp.acceptedCount} de ${camp.inviteCohort} invites aceptadas`
                : `${camp.acceptedCount} of ${camp.inviteCohort} invites accepted`}
            >
              {locale === "es" ? `${camp.acceptRate}% accept` : `${camp.acceptRate}% accept`}
            </span>
          )}
          {responseRate > 0 && <span style={{ color: C.blue }}>{t("ticket.flow.responseRate").replace("{n}", String(responseRate))}</span>}
        </div>
      </div>

      <div className="px-4 py-2.5 border-t flex items-center gap-2"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
          <div className="h-1.5 rounded-full" style={{ width: `${camp.avgProgress}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} />
        </div>
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{camp.avgProgress}%</span>
        <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0 transition-transform group-hover/card:translate-x-0.5" />
      </div>
    </Link>
  );
}

// ─── Updates Tab ──────────────────────────────────────────────────────────────
// Resolved + pending campaign requests scoped to this ICP. Moved from the
// deprecated /queue Updates tab (boss feedback 2026-05-27) so the audit
// trail lives next to the leads it affects, not in a generic notifications
// feed nobody scrolled past tab 1.
function UpdatesTab({ updates, t }: { updates: TicketUpdate[]; t: Tr }) {
  if (updates.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>{t("ticket.update.empty")}</p>
      </div>
    );
  }
  const updateStatusMeta: Record<TicketUpdate["status"], { color: string; bg: string; key: string }> = {
    approved:       { color: C.green,    bg: C.greenLight, key: "approved" },
    rejected:       { color: C.red,      bg: C.redLight,   key: "rejected" },
    pending_review: { color: "#D97706",  bg: "#FFFBEB",    key: "pendingReview" },
  };
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {updates.map((u, i) => {
        const st = updateStatusMeta[u.status];
        return (
          <div key={u.id} className="flex items-center gap-4 px-5 py-3"
            style={{ borderBottom: i < updates.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0"
              style={{ backgroundColor: st.bg, color: st.color }}>
              {t(`ticket.update.status.${st.key}`)}
            </span>
            <span className="text-sm font-semibold flex-1 truncate" style={{ color: C.textBody }}>{u.name}</span>
            {u.targetLeadsCount != null && (
              <span className="text-[11px] tabular-nums shrink-0" style={{ color: C.textMuted }}>
                {u.targetLeadsCount} {u.targetLeadsCount === 1 ? t("ticket.update.lead") : t("ticket.update.leads")}
              </span>
            )}
            <span className="text-[11px] shrink-0" style={{ color: C.textDim }}>{timeAgo(u.createdAt, t)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Outreach Flows Tab ───────────────────────────────────────────────────────
function OutreachFlowsTab({ campaigns, t, locale }: { campaigns: CampaignGroup[]; t: Tr; locale: "en" | "es" }) {
  // Past Flows defaults to OPEN when there are no active cohorts, so an ICP
  // whose work is entirely historic doesn't look empty.
  const activeCamps = campaigns.filter(c => c.cohort === "active");
  const pastCamps   = campaigns.filter(c => c.cohort === "past");
  const [pastOpen, setPastOpen] = useState(activeCamps.length === 0 && pastCamps.length > 0);

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>{t("ticket.flow.empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active / Paused flows */}
      {activeCamps.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeCamps.map(c => <CampaignCard key={c.firstId} camp={c} t={t} locale={locale} />)}
        </div>
      )}

      {/* Past Flows — collapsible compact list. Always shown when pastCamps
          exists, regardless of whether activeCamps is also present. Fran
          asked for the history to live inside each ICP in Lead Miner. */}
      {pastCamps.length > 0 && (
        <div>
          <button
            onClick={() => setPastOpen(o => !o)}
            className="flex items-center gap-2 mb-3 group"
          >
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
              {t("ticket.flow.past").replace("{n}", String(pastCamps.length))}
            </span>
            {pastOpen
              ? <ChevronUp size={13} style={{ color: C.textDim }} />
              : <ChevronDown size={13} style={{ color: C.textDim }} />}
          </button>

          {pastOpen && (
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
              {pastCamps.map((c, i) => {
                const failed = (c.statuses.failed ?? 0) > 0 && (c.statuses.completed ?? 0) === 0;
                const st = failed ? statusMeta.failed : statusMeta.completed;
                const StIcon = st.icon;
                const responseRate = c.totalLeads > 0 ? Math.round((c.totalReplies / c.totalLeads) * 100) : 0;
                const sellerLabel = c.sellers.length === 0
                  ? null
                  : c.sellers.length === 1 ? c.sellers[0] : `${c.sellers[0]} +${c.sellers.length - 1}`;
                return (
                  <Link
                    key={c.firstId}
                    href={`/campaigns/${c.firstId}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-black/[0.015] transition-colors"
                    style={{ borderBottom: i < pastCamps.length - 1 ? `1px solid ${C.border}` : "none" }}
                  >
                    <div className="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-md" style={{ backgroundColor: st.bg }}>
                      <StIcon size={10} style={{ color: st.color }} />
                      <span className="text-[10px] font-semibold" style={{ color: st.color }}>{t(`ticket.status.${st.key}`)}</span>
                    </div>
                    <span className="text-sm font-semibold flex-1 truncate" style={{ color: C.textBody }}>{c.name}</span>
                    <div className="flex items-center gap-3 shrink-0 text-xs" style={{ color: C.textMuted }}>
                      <span title={t("ticket.flow.leads")}>{c.totalLeads}L</span>
                      <span title={locale === "es" ? "Mensajes enviados" : "Messages sent"} style={{ color: C.textBody }}>{c.totalMsgsSent}m</span>
                      <span title={t("ticket.flow.replies")} style={{ color: c.totalReplies > 0 ? C.blue : C.textDim }}>{c.totalReplies}r</span>
                      {responseRate > 0 && <span style={{ color: C.blue }}>{responseRate}% {t("ticket.flow.respShort")}</span>}
                      {c.channels.length > 0 && (
                        <span className="hidden md:inline-flex items-center gap-1" title={c.channels.join(", ")}>
                          {c.channels.includes("linkedin") && <Share2 size={10} style={{ color: "#0A66C2" }} />}
                          {c.channels.includes("email") && <Mail size={10} style={{ color: "#059669" }} />}
                          {c.channels.includes("call") && <UsersIcon size={10} style={{ color: C.textMuted }} />}
                        </span>
                      )}
                      {sellerLabel && (
                        <span className="hidden lg:inline-flex items-center gap-1 truncate max-w-[10rem]" title={c.sellers.join(", ")}>
                          <UsersIcon size={10} style={{ color: C.textDim }} />
                          <span className="truncate">{sellerLabel}</span>
                        </span>
                      )}
                      {c.lastActivity && <span className="hidden xl:inline">{timeAgo(c.lastActivity, t)}</span>}
                    </div>
                    <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Leads table with filters ────────────────────────────────────────────────
const PAGE_SIZE = 25;

function LeadsTable({
  leads,
  selectable = false,
  selected,
  onToggle,
  onSelectAllFiltered,
  t,
}: {
  leads: LeadInfo[];
  /** When true the table renders a leading checkbox column and rows can be
   *  selected. Used by the Unassigned sub-tab where the seller picks leads
   *  to feed into a new flow or attach to an existing one. */
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  /** Receives the filtered (currently visible) lead IDs so a "select all"
   *  header checkbox can toggle the post-filter set, not the raw input. */
  onSelectAllFiltered?: (ids: string[], allSelected: boolean) => void;
  t: Tr;
}) {
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<LeadFilterState>(emptyLeadFilterState());

  // Same multi-select filter pipeline that AllLeadsTable uses on /leads.
  // Each facet is a string[]; empty array = no filter; non-empty = OR
  // within the facet, AND across facets.
  const filtered = leads.filter(l => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!`${l.first_name} ${l.last_name} ${l.company} ${l.email}`.toLowerCase().includes(q)) return false;
    }
    if (filters.score.length > 0) {
      const isHot     = l.is_priority || (l.score != null && l.score >= 80);
      const isWarm    = !isHot && l.score != null && l.score >= 50;
      const isNurture = !isHot && (l.score == null || l.score < 50);
      const ok =
        (filters.score.includes("hot") && isHot) ||
        (filters.score.includes("warm") && isWarm) ||
        (filters.score.includes("nurture") && isNurture);
      if (!ok) return false;
    }
    if (filters.campaign.length > 0) {
      const ok =
        (filters.campaign.includes("yes") && l.has_campaign) ||
        (filters.campaign.includes("no") && !l.has_campaign);
      if (!ok) return false;
    }
    if (filters.results.length > 0) {
      const isPositive = !!l.has_positive;
      const isNegative = !isPositive && (l.reply_count ?? 0) > 0;
      const ok =
        (filters.results.includes("positive") && isPositive) ||
        (filters.results.includes("negative") && isNegative);
      if (!ok) return false;
    }
    return true;
  });

  const visible = filtered.slice(0, showCount);
  const hasMore = showCount < filtered.length;
  const filteredIds = filtered.map(l => l.id);
  const allFilteredSelected = selectable && selected && filteredIds.length > 0 && filteredIds.every(id => selected.has(id));

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>{t("ticket.table.noLeads")}</p>
      </div>
    );
  }

  return (
    <div>
      <LeadFilterBar
        filters={filters}
        onChange={f => { setFilters(f); setShowCount(PAGE_SIZE); }}
        resultCount={filtered.length}
        totalCount={leads.length}
        showProfileFilter={false}
        showCampaignFilter={!selectable}
      />

      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <table className="w-full text-left">
          <thead>
            <tr style={{ backgroundColor: C.bg }}>
              {selectable && (
                <th className="px-3 py-2.5 w-9">
                  <button
                    onClick={() => onSelectAllFiltered?.(filteredIds, !!allFilteredSelected)}
                    className="flex items-center justify-center rounded p-0.5 transition-colors hover:bg-black/[0.04]"
                    title={allFilteredSelected ? t("ticket.table.clearSelection") : t("ticket.table.selectAll").replace("{n}", String(filteredIds.length))}
                  >
                    {allFilteredSelected
                      ? <CheckSquare size={14} style={{ color: gold }} />
                      : <Square size={14} style={{ color: C.textDim }} />}
                  </button>
                </th>
              )}
              {[
                t("ticket.table.lead"),
                t("ticket.table.score"),
                t("ticket.table.campaign"),
                t("ticket.table.reply"),
                "",
              ].map((h, idx) => (
                <th key={idx} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={selectable ? 6 : 5} className="px-4 py-10 text-center text-sm" style={{ color: C.textDim }}>{t("ticket.table.noMatches")}</td></tr>
            ) : visible.map(lead => {
              const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("ticket.table.unknown");
              const badge = scoreBadge(lead.score, lead.is_priority);
              const hasReply = lead.reply_count > 0;
              const replyColor = lead.has_positive ? C.green : hasReply ? "#D97706" : C.textDim;
              const replyLabel = lead.has_positive ? t("ticket.table.replyPositive") : hasReply ? t("ticket.table.replyReplied") : "—";
              const campSt = lead.campaign_status ? (statusMeta[lead.campaign_status] ?? null) : null;
              const isSelected = selectable && selected?.has(lead.id);

              return (
                <tr key={lead.id} className="border-t transition-colors hover:bg-black/[0.015]"
                  style={{
                    borderColor: C.border,
                    backgroundColor: isSelected ? `color-mix(in srgb, ${gold} 6%, transparent)` : undefined,
                  }}>
                  {selectable && (
                    <td className="px-3 py-3 w-9">
                      <button
                        onClick={() => onToggle?.(lead.id)}
                        className="flex items-center justify-center rounded p-0.5 transition-colors hover:bg-black/[0.04]"
                        aria-label={isSelected ? t("ticket.table.unselectLead") : t("ticket.table.selectLead")}
                      >
                        {isSelected
                          ? <CheckSquare size={14} style={{ color: gold }} />
                          : <Square size={14} style={{ color: C.textDim }} />}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link href={`/leads/${lead.id}`} className="flex items-center gap-2.5 group/row">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                        {((lead.company ?? name)[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold group-hover/row:underline block truncate" style={{ color: C.textPrimary }}>{name}</span>
                        {(lead.role || lead.company) && (
                          <span className="text-[11px] block truncate" style={{ color: C.textMuted }}>
                            {[lead.role, lead.company].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      {lead.is_priority && <Star size={10} fill={gold} stroke={gold} className="shrink-0" />}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded inline-block" style={{ backgroundColor: badge.bg, color: badge.color }}>{t(`ticket.score.${badge.key}`)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {lead.has_campaign && campSt ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: campSt.bg, color: campSt.color }}>{t(`ticket.status.${campSt.key}`)}</span>
                    ) : lead.has_campaign ? (
                      <span className="text-[10px]" style={{ color: C.textMuted }}>{lead.campaign_name ?? ""}</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>{t("ticket.table.noCampaign")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] font-semibold" style={{ color: replyColor }}>{replyLabel}</span></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/leads/${lead.id}`} className="text-[10px] font-medium hover:underline" style={{ color: gold }}>{t("ticket.table.view")}</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore && (
          <div className="border-t px-4 py-2.5 text-center" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <button onClick={() => setShowCount(c => c + PAGE_SIZE)} className="text-xs font-medium hover:underline" style={{ color: gold }}>
              {t("ticket.table.showMoreLink").replace("{n}", String(filtered.length - showCount))}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add to existing campaign modal ─────────────────────────────────────────
function AddToExistingModal({
  campaigns, leadIds, onClose, onAdded, t,
}: {
  campaigns: CampaignGroup[];
  leadIds: string[];
  onClose: () => void;
  onAdded: () => void;
  t: Tr;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only campaigns that have at least one active or paused row are valid
  // attachment targets — adding leads to a completed/failed flow would just
  // re-create dispatch rows out of band. Each CampaignGroup exposes `firstId`
  // as the canonical campaign row to attach against.
  const targets = campaigns.filter(c => (c.statuses.active ?? 0) + (c.statuses.paused ?? 0) > 0);

  async function submit() {
    if (!pickedId || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/campaigns/${pickedId}/add-leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? t("ticket.modal.addToExisting.failed"));
        return;
      }
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: C.border }}>
          <div>
            <h3 className="text-base font-bold" style={{ color: C.textPrimary }}>{t("ticket.modal.addToExisting.title")}</h3>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
              {(leadIds.length === 1 ? t("ticket.modal.addToExisting.subtitleOne") : t("ticket.modal.addToExisting.subtitleMany")).replace("{n}", String(leadIds.length))}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/[0.04]">
            <X size={14} style={{ color: C.textDim }} />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-[50vh] overflow-y-auto">
          {targets.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: C.textMuted }}>
              {t("ticket.modal.addToExisting.empty")}
            </p>
          ) : targets.map(c => {
            const picked = pickedId === c.firstId;
            return (
              <button key={c.firstId}
                onClick={() => setPickedId(c.firstId)}
                className="w-full text-left rounded-xl border px-4 py-3 transition-[border-color,background-color]"
                style={{
                  borderColor: picked ? gold : C.border,
                  backgroundColor: picked ? `color-mix(in srgb, ${gold} 8%, transparent)` : C.bg,
                }}>
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone size={11} style={{ color: gold }} />
                  <span className="text-[13px] font-semibold flex-1 truncate" style={{ color: C.textPrimary }}>{c.name}</span>
                  {picked && <CheckSquare size={13} style={{ color: gold }} />}
                </div>
                <p className="text-[11px]" style={{ color: C.textMuted }}>
                  {c.totalLeads} {t("ticket.flow.leads")} · {c.channels.join(" + ")} · {c.totalSteps} {t("ticket.modal.addToExisting.stepsLabel")}
                </p>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="px-5 py-2 text-[11px]" style={{ color: C.red }}>{error}</div>
        )}

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <button onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
            {t("ticket.modal.addToExisting.cancel")}
          </button>
          <button onClick={submit}
            disabled={!pickedId || busy || targets.length === 0}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
            style={{ backgroundColor: gold, color: "#1A1A2E" }}>
            {busy ? t("ticket.modal.addToExisting.adding") : (leadIds.length === 1 ? t("ticket.modal.addToExisting.addOne") : t("ticket.modal.addToExisting.addMany")).replace("{n}", String(leadIds.length))}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function TicketDetailClient({ profileId, ticketName, campaigns, leads, metrics, updates }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();
  // Boss 2026-05-29: the ticket is reachable from multiple surfaces
  // (/leads Lead Miner card, /dashboard/seller/[id] expand row,
  // SellerScorecard). The breadcrumb always sent the user back to /leads,
  // which felt random when they arrived from the dashboard. Now we honor
  // a `?from=<url>` querystring so the entry point controls the back
  // destination. Whitelist the prefix so a tampered URL can't redirect
  // off-app (only relative paths on this origin).
  const fromParam = searchParams?.get("from") ?? null;
  const backHref = fromParam && fromParam.startsWith("/") ? fromParam : "/leads";
  const backLabel = backHref.startsWith("/dashboard/seller") ? t("ticket.breadcrumb.backSeller")
    : backHref.startsWith("/dashboard") ? t("ticket.breadcrumb.backDashboard")
    : t("ticket.breadcrumb.back");
  const [tab, setTab] = useState(0);
  // Inside the Leads tab the boss wants the seller to split leads by whether
  // they're already in a flow ("With Campaign") vs idle ("Unassigned"). The
  // Unassigned bucket is selectable so they can bulk-create a new flow or
  // attach to an existing one.
  type LeadsSub = "with_campaign" | "unassigned";
  const [leadsSub, setLeadsSub] = useState<LeadsSub>("unassigned");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddExisting, setShowAddExisting] = useState(false);

  const totalLeads    = leads.length;
  const totalCamps    = campaigns.length;

  const withCampaignLeads = useMemo(() => leads.filter(l => l.has_campaign), [leads]);
  const unassignedLeads   = useMemo(() => leads.filter(l => !l.has_campaign), [leads]);

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllFiltered(ids: string[], allSelected: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  function createNewFlow() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    // Reuse the wizard the New Flow tab already routes into. It picks up
    // `?leads=` and pre-selects them inside the profile picker. profileId
    // is the ICP that owns this ticket so the wizard skips the ICP-pick step.
    router.push(`/campaigns/new/${profileId}?leads=${ids.join(",")}`);
  }

  // Updates tab removed 2026-05-28 per user request — the campaign-request
  // approvals feed lives in the Notifications page instead.
  const tabs = [
    { label: t("ticket.tab.leads"), count: totalLeads, color: C.blue },
    { label: t("ticket.tab.flows"), count: totalCamps, color: gold },
  ];

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-5" style={{ color: C.textMuted }}>
        <Link href={backHref} className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> {backLabel}
        </Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{ticketName}</span>
      </div>

      {/* Header — SWL brand identity: navy-ink top with gold typography +
          gold accent rail. Two stat rows underneath read as primary
          outcome metrics (Row 1) and channel activity (Row 2). */}
      <div className="rounded-2xl border overflow-hidden mb-4 relative"
        style={{
          backgroundColor: C.card,
          borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 18%, transparent), 0 12px 32px -16px rgba(11,15,26,0.45)`,
        }}>
        {/* Navy hero band with gold halo */}
        <div className="relative overflow-hidden px-7 py-6"
          style={{
            background: "linear-gradient(135deg, #0B0F1A 0%, #111827 60%, #0B0F1A 100%)",
            borderBottom: `1px solid color-mix(in srgb, ${gold} 28%, transparent)`,
          }}>
          <span aria-hidden className="absolute -top-20 -right-20 w-72 h-72 rounded-full pointer-events-none"
            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 60%)` }} />
          <span aria-hidden className="absolute -bottom-32 -left-12 w-72 h-72 rounded-full pointer-events-none"
            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 8%, transparent) 0%, transparent 70%)` }} />
          <div className="relative flex items-center gap-2 mb-2">
            <span className="inline-block w-1 h-1 rounded-full pulse-dot" style={{ background: gold }} />
            <p className="text-[10.5px] font-bold uppercase tracking-[0.18em]" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {t("ticket.hero.preTitle")}
            </p>
          </div>
          <h1 className="relative text-[28px] font-bold leading-tight"
            style={{ color: "#fff", fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
            {ticketName}
          </h1>
        </div>

        {/* Row 1 — primary outcomes. Each tile gets a colored left rail
            + icon tile so the eye finds the metric type before reading. */}
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: C.border }}>
          {[
            { icon: UsersIcon, label: t("ticket.metrics.leads"),      value: metrics.totalLeads,      color: gold },
            { icon: UserPlus,  label: t("ticket.metrics.unassigned"), value: metrics.unassignedCount, color: metrics.unassignedCount > 0 ? "#92400E" : C.textMuted },
            { icon: Megaphone, label: t("ticket.metrics.flows"),      value: totalCamps,              color: "#7C3AED" },
            { icon: Trophy,    label: t("ticket.metrics.won"),        value: metrics.won,             color: C.green },
            { icon: ThumbsDown,label: t("ticket.metrics.lost"),       value: metrics.lost,            color: C.red },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="px-5 py-4 flex items-center gap-3"
                style={{ borderLeft: `3px solid color-mix(in srgb, ${s.color} 55%, transparent)`, borderColor: C.border }}>
                <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: `color-mix(in srgb, ${s.color} 14%, transparent)`,
                    color: s.color,
                    border: `1px solid color-mix(in srgb, ${s.color} 22%, transparent)`,
                  }}>
                  <Icon size={16} />
                </span>
                <div>
                  <p className="text-[24px] font-bold tabular-nums leading-none tracking-[-0.02em]"
                    style={{ color: s.color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {s.value}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] mt-1" style={{ color: C.textMuted }}>{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Row 2 — channel activity. Tinted gold-on-card background so it
            visually reads as a "secondary band" inside the same hero card. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x"
          style={{
            borderTop: `1px solid color-mix(in srgb, ${gold} 18%, ${C.border})`,
            borderColor: C.border,
            background: `linear-gradient(180deg, color-mix(in srgb, ${gold} 4%, transparent), transparent)`,
          }}>
          {[
            { icon: Share2,        label: t("ticket.metrics.linkedinInvites"),  value: metrics.linkedinInvitesSent,   color: "#0A66C2" },
            { icon: MessageSquare, label: t("ticket.metrics.linkedinMessages"), value: metrics.linkedinMessagesSent,  color: "#0A66C2" },
            { icon: Mail,          label: t("ticket.metrics.emailsSent"),       value: metrics.emailsSent,            color: "#059669" },
            { icon: Phone,         label: t("ticket.metrics.callsMade"),        value: metrics.callsMade,             color: "#EA580C" },
            { icon: Percent,       label: t("ticket.metrics.replyRate"),        value: `${metrics.replyRate}%`,       color: metrics.replyRate >= 10 ? C.green : gold },
            { icon: Percent,       label: t("ticket.metrics.winRate"),          value: `${metrics.winRate}%`,         color: metrics.winRate >= 20 ? C.green : gold },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="px-4 py-3 flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: `color-mix(in srgb, ${s.color} 14%, transparent)`, color: s.color }}>
                  <Icon size={12} />
                </span>
                <div className="min-w-0">
                  <p className="text-[16px] font-bold tabular-nums leading-tight tracking-[-0.01em]"
                    style={{ color: s.color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {s.value}
                  </p>
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] truncate" style={{ color: C.textMuted }}>{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unassigned leads call-to-action — surfaces leads without a flow so
          they're not buried inside the table filter. Click jumps to the
          Leads tab with the "No Campaign" chip pre-applied. */}
      {metrics.unassignedCount > 0 && (
        <div className="mb-6 rounded-xl border p-4 flex items-center gap-4 flex-wrap"
          style={{
            backgroundColor: `color-mix(in srgb, #92400E 6%, ${C.card})`,
            borderColor: `color-mix(in srgb, #92400E 35%, transparent)`,
          }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, #92400E 14%, transparent)`, color: "#92400E" }}>
            <UserPlus size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>
              {(metrics.unassignedCount === 1 ? t("ticket.unassigned.titleOne") : t("ticket.unassigned.titleMany")).replace("{n}", String(metrics.unassignedCount))}
            </p>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
              {t("ticket.unassigned.subtitle")}
            </p>
          </div>
          <button
            onClick={() => { setTab(0); setLeadsSub("unassigned"); }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#92400E", color: "#fff" }}
          >
            {t("ticket.unassigned.review")}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((tab2, i) => {
          const isActive = tab === i;
          return (
            <button key={tab2.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-[opacity,transform,box-shadow,background-color,border-color] relative"
              style={{ color: isActive ? tab2.color : C.textMuted }}>
              {tab2.label}
              {tab2.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `${tab2.color}15` : C.surface, color: isActive ? tab2.color : C.textDim }}>
                  {tab2.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: tab2.color }} />}
            </button>
          );
        })}
      </div>

      {/* Tab 0: Leads — split into With Campaign / Unassigned. The Unassigned
          half is selectable so sellers can bulk-feed leads into a new flow
          or attach them to an existing flow without leaving the page. */}
      {tab === 0 && (
        <div>
          <div className="flex items-center gap-1 mb-4 p-1 rounded-lg border max-w-fit"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            {([
              { key: "unassigned" as const,    label: t("ticket.subtab.unassigned"),   count: unassignedLeads.length,   color: gold },
              { key: "with_campaign" as const, label: t("ticket.subtab.withCampaign"), count: withCampaignLeads.length, color: C.blue },
            ]).map(opt => {
              const isActive = leadsSub === opt.key;
              return (
                <button key={opt.key}
                  onClick={() => { setLeadsSub(opt.key); clearSelection(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-[background-color,color]"
                  style={{
                    backgroundColor: isActive ? opt.color : "transparent",
                    color: isActive ? "#fff" : C.textBody,
                  }}>
                  {opt.label}
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isActive ? "rgba(255,255,255,0.22)" : C.cardHov,
                      color: isActive ? "#fff" : C.textDim,
                    }}>
                    {opt.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Bulk action bar — only shown when in Unassigned and at least
              one lead is selected. Sticky-feeling pill that mirrors the
              pattern used in /queue + /leads (Lost view). */}
          {leadsSub === "unassigned" && selected.size > 0 && (
            <div className="mb-4 rounded-xl border p-3 flex items-center gap-3 flex-wrap"
              style={{
                backgroundColor: `color-mix(in srgb, ${gold} 8%, ${C.card})`,
                borderColor: `color-mix(in srgb, ${gold} 35%, ${C.border})`,
              }}>
              <span className="text-xs font-bold" style={{ color: C.textPrimary }}>
                {t("ticket.bulk.selected").replace("{n}", String(selected.size))}
              </span>
              <button onClick={clearSelection}
                className="text-[11px] font-semibold hover:underline" style={{ color: C.textMuted }}>
                {t("ticket.bulk.clear")}
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setShowAddExisting(true)}
                disabled={campaigns.filter(c => (c.statuses.active ?? 0) + (c.statuses.paused ?? 0) > 0).length === 0}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-[background-color,opacity] hover:bg-black/[0.03] disabled:opacity-40"
                style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
                title={campaigns.filter(c => (c.statuses.active ?? 0) + (c.statuses.paused ?? 0) > 0).length === 0 ? t("ticket.bulk.noActiveFlow") : ""}
              >
                <Plus size={11} /> {t("ticket.bulk.addToExisting")}
              </button>
              <button
                onClick={createNewFlow}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: gold, color: "#1A1A2E" }}
              >
                <Megaphone size={11} /> {t("ticket.bulk.createNewFlow")}
              </button>
            </div>
          )}

          {leadsSub === "unassigned" && (
            <LeadsTable
              leads={unassignedLeads}
              selectable
              selected={selected}
              onToggle={toggleOne}
              onSelectAllFiltered={toggleAllFiltered}
              t={t}
            />
          )}
          {leadsSub === "with_campaign" && <LeadsTable leads={withCampaignLeads} t={t} />}
        </div>
      )}

      {/* Tab 1: Outreach Flows */}
      {tab === 1 && <OutreachFlowsTab campaigns={campaigns} t={t} locale={locale} />}

      {showAddExisting && (
        <AddToExistingModal
          campaigns={campaigns}
          leadIds={Array.from(selected)}
          onClose={() => setShowAddExisting(false)}
          onAdded={() => { setShowAddExisting(false); clearSelection(); router.refresh(); }}
          t={t}
        />
      )}
    </div>
  );
}
