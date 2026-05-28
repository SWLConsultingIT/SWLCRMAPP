"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import {
  ArrowLeft, Star, Clock, ChevronRight, ChevronDown, ChevronUp, Megaphone,
  PlayCircle, CheckCircle, PauseCircle, XCircle,
  Users as UsersIcon, UserPlus, Share2, Mail, Phone, Trophy, ThumbsDown, MessageSquare, Percent,
  Square, CheckSquare, Plus, X,
} from "lucide-react";
import { LeadFilterBar, type LeadFilterState } from "@/components/LeadFilters";

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

const statusMeta: Record<string, { color: string; bg: string; icon: typeof PlayCircle; label: string }> = {
  active:    { color: C.green,     bg: C.greenLight, icon: PlayCircle,  label: "Active" },
  paused:    { color: "#D97706",   bg: "#FFFBEB",    icon: PauseCircle, label: "Paused" },
  completed: { color: C.textMuted, bg: C.surface,    icon: CheckCircle, label: "Completed" },
  failed:    { color: C.red,       bg: C.redLight,   icon: XCircle,     label: "Failed" },
};

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT",     color: C.hot,     bg: C.hotBg };
  if (score && score >= 50)              return { label: "WARM",    color: C.warm,    bg: C.warmBg };
  return                                        { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Campaign Card ────────────────────────────────────────────────────────────
function CampaignCard({ camp }: { camp: CampaignGroup }) {
  const active    = camp.statuses.active ?? 0;
  const paused    = camp.statuses.paused ?? 0;
  const completed = camp.statuses.completed ?? 0;
  const groupStatus = active > 0 ? "active" : paused > 0 ? "paused" : completed > 0 ? "completed" : "failed";
  const st = statusMeta[groupStatus] ?? statusMeta.active;
  const StIcon = st.icon;
  const responseRate = camp.totalLeads > 0 ? Math.round((camp.totalReplies / camp.totalLeads) * 100) : 0;

  return (
    <Link
      href={`/campaigns/${camp.firstId}/overview`}
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
          <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: gold }}>Outreach Flow</span>
          <div className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: st.bg }}>
            <StIcon size={10} style={{ color: st.color }} />
            <span className="text-[10px] font-semibold" style={{ color: st.color }}>{st.label}</span>
          </div>
        </div>

        <h3 className="text-sm font-bold mb-2 group-hover/card:underline" style={{ color: C.textPrimary }}>
          {camp.name}
        </h3>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: "Leads", value: camp.totalLeads, color: C.textBody },
            { label: "Replies", value: camp.totalReplies, color: C.blue },
            { label: "Positive", value: camp.positiveCount, color: C.green },
          ].map(s => (
            <div key={s.label} className="text-center rounded-lg py-1.5" style={{ backgroundColor: C.bg }}>
              <p className="text-base font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[9px] font-semibold uppercase" style={{ color: C.textDim }}>{s.label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[10px]" style={{ color: C.textDim }}>
          <span>{camp.totalSteps} steps</span>
          {responseRate > 0 && <span style={{ color: C.blue }}>{responseRate}% response rate</span>}
          {camp.lastActivity && <span><Clock size={9} className="inline mr-0.5" />{timeAgo(camp.lastActivity)}</span>}
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
function UpdatesTab({ updates }: { updates: TicketUpdate[] }) {
  if (updates.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>No campaign-request activity in the last 2 weeks.</p>
      </div>
    );
  }
  const statusMeta: Record<TicketUpdate["status"], { color: string; bg: string; label: string }> = {
    approved:       { color: C.green,    bg: C.greenLight, label: "Approved" },
    rejected:       { color: C.red,      bg: C.redLight,   label: "Rejected" },
    pending_review: { color: "#D97706",  bg: "#FFFBEB",    label: "Pending review" },
  };
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {updates.map((u, i) => {
        const st = statusMeta[u.status];
        return (
          <div key={u.id} className="flex items-center gap-4 px-5 py-3"
            style={{ borderBottom: i < updates.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0"
              style={{ backgroundColor: st.bg, color: st.color }}>
              {st.label}
            </span>
            <span className="text-sm font-semibold flex-1 truncate" style={{ color: C.textBody }}>{u.name}</span>
            {u.targetLeadsCount != null && (
              <span className="text-[11px] tabular-nums shrink-0" style={{ color: C.textMuted }}>
                {u.targetLeadsCount} lead{u.targetLeadsCount === 1 ? "" : "s"}
              </span>
            )}
            <span className="text-[11px] shrink-0" style={{ color: C.textDim }}>{timeAgo(u.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Outreach Flows Tab ───────────────────────────────────────────────────────
function OutreachFlowsTab({ campaigns }: { campaigns: CampaignGroup[] }) {
  const [pastOpen, setPastOpen] = useState(false);

  const activeCamps = campaigns.filter(c => (c.statuses.active ?? 0) > 0 || (c.statuses.paused ?? 0) > 0);
  const pastCamps   = campaigns.filter(c => (c.statuses.active ?? 0) === 0 && (c.statuses.paused ?? 0) === 0);

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>No outreach flows for this profile yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active / Paused flows */}
      {activeCamps.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeCamps.map(c => <CampaignCard key={c.firstId} camp={c} />)}
        </div>
      )}

      {activeCamps.length === 0 && pastCamps.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pastCamps.map(c => <CampaignCard key={c.firstId} camp={c} />)}
        </div>
      )}

      {/* Past Flows — collapsible compact list */}
      {activeCamps.length > 0 && pastCamps.length > 0 && (
        <div>
          <button
            onClick={() => setPastOpen(o => !o)}
            className="flex items-center gap-2 mb-3 group"
          >
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
              Past Flows ({pastCamps.length})
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
                return (
                  <Link
                    key={c.firstId}
                    href={`/campaigns/${c.firstId}/overview`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-black/[0.015] transition-colors"
                    style={{ borderBottom: i < pastCamps.length - 1 ? `1px solid ${C.border}` : "none" }}
                  >
                    <div className="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-md" style={{ backgroundColor: st.bg }}>
                      <StIcon size={10} style={{ color: st.color }} />
                      <span className="text-[10px] font-semibold" style={{ color: st.color }}>{st.label}</span>
                    </div>
                    <span className="text-sm font-semibold flex-1 truncate" style={{ color: C.textBody }}>{c.name}</span>
                    <div className="flex items-center gap-4 shrink-0 text-xs" style={{ color: C.textMuted }}>
                      <span>{c.totalLeads} leads</span>
                      <span>{c.totalReplies} replies</span>
                      {responseRate > 0 && <span style={{ color: C.blue }}>{responseRate}% resp.</span>}
                      {c.lastActivity && <span>{timeAgo(c.lastActivity)}</span>}
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
}) {
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<LeadFilterState>({ search: "", score: "all", campaign: "all", reply: "all", profile: "all", role: "all", industry: "all" });

  const filtered = leads.filter(l => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!`${l.first_name} ${l.last_name} ${l.company} ${l.email}`.toLowerCase().includes(q)) return false;
    }
    if (filters.score === "hot" && !(l.is_priority || (l.score && l.score >= 80))) return false;
    if (filters.score === "warm" && !(l.score && l.score >= 50 && l.score < 80 && !l.is_priority)) return false;
    if (filters.score === "nurture" && !(!l.score || l.score < 50) && !l.is_priority) return false;
    if (filters.campaign === "yes" && !l.has_campaign) return false;
    if (filters.campaign === "no" && l.has_campaign) return false;
    if (filters.reply === "replied" && !(l.reply_count > 0)) return false;
    if (filters.reply === "positive" && !l.has_positive) return false;
    if (filters.reply === "none" && l.reply_count > 0) return false;
    return true;
  });

  const visible = filtered.slice(0, showCount);
  const hasMore = showCount < filtered.length;
  const filteredIds = filtered.map(l => l.id);
  const allFilteredSelected = selectable && selected && filteredIds.length > 0 && filteredIds.every(id => selected.has(id));

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>No leads in this profile</p>
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
                    title={allFilteredSelected ? "Clear selection" : `Select all ${filteredIds.length}`}
                  >
                    {allFilteredSelected
                      ? <CheckSquare size={14} style={{ color: gold }} />
                      : <Square size={14} style={{ color: C.textDim }} />}
                  </button>
                </th>
              )}
              {["Lead", "Company", "Role", "Score", "Campaign", "Reply", ""].map(h => (
                <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={selectable ? 8 : 7} className="px-4 py-10 text-center text-sm" style={{ color: C.textDim }}>No leads match your filters</td></tr>
            ) : visible.map(lead => {
              const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
              const badge = scoreBadge(lead.score, lead.is_priority);
              const hasReply = lead.reply_count > 0;
              const replyColor = lead.has_positive ? C.green : hasReply ? "#D97706" : C.textDim;
              const replyLabel = lead.has_positive ? "Positive" : hasReply ? "Replied" : "—";
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
                        aria-label={isSelected ? "Unselect lead" : "Select lead"}
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
                      </div>
                      {lead.is_priority && <Star size={10} fill={gold} stroke={gold} className="shrink-0" />}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs truncate block max-w-[140px]" style={{ color: C.textMuted }}>{lead.company ?? "—"}</span></td>
                  <td className="px-4 py-3"><span className="text-xs truncate block max-w-[140px]" style={{ color: C.textMuted }}>{lead.role ?? "—"}</span></td>
                  <td className="px-4 py-3">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded inline-block" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    {lead.has_campaign && campSt ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: campSt.bg, color: campSt.color }}>{campSt.label}</span>
                    ) : lead.has_campaign ? (
                      <span className="text-[10px]" style={{ color: C.textMuted }}>{lead.campaign_name ?? "Yes"}</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>No Campaign</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] font-semibold" style={{ color: replyColor }}>{replyLabel}</span></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/leads/${lead.id}`} className="text-[10px] font-medium hover:underline" style={{ color: gold }}>View</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore && (
          <div className="border-t px-4 py-2.5 text-center" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <button onClick={() => setShowCount(c => c + PAGE_SIZE)} className="text-xs font-medium hover:underline" style={{ color: gold }}>
              Show more ({filtered.length - showCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add to existing campaign modal ─────────────────────────────────────────
function AddToExistingModal({
  campaigns, leadIds, onClose, onAdded,
}: {
  campaigns: CampaignGroup[];
  leadIds: string[];
  onClose: () => void;
  onAdded: () => void;
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
        setError(json.error ?? "Failed to add leads");
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
            <h3 className="text-base font-bold" style={{ color: C.textPrimary }}>Add to existing flow</h3>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
              {leadIds.length} {leadIds.length === 1 ? "lead" : "leads"} will be attached to the selected flow.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/[0.04]">
            <X size={14} style={{ color: C.textDim }} />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-[50vh] overflow-y-auto">
          {targets.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: C.textMuted }}>
              No active flows in this ticket yet. Use &ldquo;Create new flow&rdquo; instead.
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
                  {c.totalLeads} leads · {c.channels.join(" + ")} · {c.totalSteps} steps
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
            Cancel
          </button>
          <button onClick={submit}
            disabled={!pickedId || busy || targets.length === 0}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
            style={{ backgroundColor: gold, color: "#1A1A2E" }}>
            {busy ? "Adding…" : `Add ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function TicketDetailClient({ profileId, ticketName, campaigns, leads, metrics, updates }: Props) {
  const router = useRouter();
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

  const tabs = [
    { label: "Leads",          count: totalLeads,     color: C.blue },
    { label: "Outreach Flows", count: totalCamps,     color: gold },
    { label: "Updates",        count: updates.length, color: C.green },
  ];

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-5" style={{ color: C.textMuted }}>
        <Link href="/leads" className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> Leads &amp; Campaigns
        </Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{ticketName}</span>
      </div>

      {/* Header */}
      <div className="rounded-xl border mb-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6 pb-4">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Lead Miner Profile</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{ticketName}</h1>
        </div>

        {/* Header stats — two rows: pipeline state (top) + channel activity (bottom).
            Boss feedback 2026-05-27: surface per-channel counts + win/loss
            metrics so the ticket reads at a glance without expanding any
            campaign card. */}
        <div className="border-t grid grid-cols-5 divide-x" style={{ borderColor: C.border }}>
          {[
            { icon: UsersIcon, label: "Leads",        value: metrics.totalLeads,     color: C.textBody },
            { icon: UserPlus,  label: "Unassigned",   value: metrics.unassignedCount, color: metrics.unassignedCount > 0 ? "#92400E" : C.textMuted },
            { icon: Megaphone, label: "Flows",        value: totalCamps,             color: gold },
            { icon: Trophy,    label: "Won",          value: metrics.won,            color: C.green },
            { icon: ThumbsDown,label: "Lost",         value: metrics.lost,           color: C.red },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="px-5 py-3 flex items-center gap-3">
                <Icon size={14} style={{ color: s.color }} />
                <div>
                  <p className="text-xl font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t grid grid-cols-6 divide-x" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          {[
            { icon: Share2,        label: "LinkedIn Invites",  value: metrics.linkedinInvitesSent,   color: "#0A66C2" },
            { icon: MessageSquare, label: "LinkedIn Messages", value: metrics.linkedinMessagesSent,  color: "#0A66C2" },
            { icon: Mail,          label: "Emails Sent",       value: metrics.emailsSent,            color: "#7C3AED" },
            { icon: Phone,         label: "Calls Made",        value: metrics.callsMade,             color: "#F97316" },
            { icon: Percent,       label: "Reply Rate",        value: `${metrics.replyRate}%`,       color: metrics.replyRate >= 10 ? C.green : C.textBody },
            { icon: Percent,       label: "Win Rate",          value: `${metrics.winRate}%`,         color: metrics.winRate >= 20 ? C.green : C.textBody },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="px-4 py-2.5 flex items-center gap-2.5">
                <Icon size={12} style={{ color: s.color }} />
                <div className="min-w-0">
                  <p className="text-sm font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider truncate" style={{ color: C.textMuted }}>{s.label}</p>
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
              {metrics.unassignedCount} {metrics.unassignedCount === 1 ? "lead is" : "leads are"} in this ICP but not assigned to any flow
            </p>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
              These leads aren&apos;t receiving any outreach. Add them to an existing flow or create a new one.
            </p>
          </div>
          <button
            onClick={() => { setTab(0); setLeadsSub("unassigned"); }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#92400E", color: "#fff" }}
          >
            Review unassigned →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-[opacity,transform,box-shadow,background-color,border-color] relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `${t.color}15` : C.surface, color: isActive ? t.color : C.textDim }}>
                  {t.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
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
              { key: "unassigned" as const,    label: "Unassigned",    count: unassignedLeads.length,   color: "#92400E" },
              { key: "with_campaign" as const, label: "With Campaign", count: withCampaignLeads.length, color: C.green },
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
                {selected.size} selected
              </span>
              <button onClick={clearSelection}
                className="text-[11px] font-semibold hover:underline" style={{ color: C.textMuted }}>
                Clear
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setShowAddExisting(true)}
                disabled={campaigns.filter(c => (c.statuses.active ?? 0) + (c.statuses.paused ?? 0) > 0).length === 0}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-[background-color,opacity] hover:bg-black/[0.03] disabled:opacity-40"
                style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
                title={campaigns.filter(c => (c.statuses.active ?? 0) + (c.statuses.paused ?? 0) > 0).length === 0 ? "No active flow in this ticket yet" : ""}
              >
                <Plus size={11} /> Add to existing flow
              </button>
              <button
                onClick={createNewFlow}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: gold, color: "#1A1A2E" }}
              >
                <Megaphone size={11} /> Create new flow
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
            />
          )}
          {leadsSub === "with_campaign" && <LeadsTable leads={withCampaignLeads} />}
        </div>
      )}

      {/* Tab 1: Outreach Flows */}
      {tab === 1 && <OutreachFlowsTab campaigns={campaigns} />}

      {/* Tab 2: Updates — campaign-request activity scoped to this ICP. */}
      {tab === 2 && <UpdatesTab updates={updates} />}

      {showAddExisting && (
        <AddToExistingModal
          campaigns={campaigns}
          leadIds={Array.from(selected)}
          onClose={() => setShowAddExisting(false)}
          onAdded={() => { setShowAddExisting(false); clearSelection(); router.refresh(); }}
        />
      )}
    </div>
  );
}
