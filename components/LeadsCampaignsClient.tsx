"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Megaphone, ChevronRight, ChevronDown, Share2, Mail, Phone,
  Search, X, CheckCircle, Star, Clock, MessageSquare, Users,
} from "lucide-react";

const gold = "#C9A83A";

type LeadInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  phone: string | null;
  status: string | null;
  score: number | null;
  is_priority: boolean;
  channel: string | null;
  reply_count?: number;
  has_positive?: boolean;
  last_reply?: any;
  created_at?: string;
};

type CampaignEntry = {
  id: string;
  status: string;
  channel: string;
  current_step: number;
  total_steps: number;
  last_step_at: string | null;
  seller: string | null;
  messages_sent: number;
  messages_total: number;
  lead: LeadInfo | null;
};

type CampaignGroup = {
  name: string;
  channel: string;
  status: string;
  created_at: string;
  campaigns: CampaignEntry[];
  statusCounts: Record<string, number>;
};

type Props = {
  campaignGroups: CampaignGroup[];
  uncampaignedGroups: Record<string, { profile_id: string | null; leads: LeadInfo[] }>;
  icpMap: Record<string, { id: string; profile_name: string; target_industries?: string[]; target_roles?: string[] }>;
  totalUncampaigned: number;
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const statusColors: Record<string, { color: string; bg: string }> = {
  active:    { color: C.green,     bg: C.greenLight },
  paused:    { color: "#D97706",   bg: "#FFFBEB" },
  completed: { color: C.textMuted, bg: "#F3F4F6" },
  failed:    { color: C.red,       bg: C.redLight },
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

function getGroupStatus(group: CampaignGroup) {
  const { active = 0, paused = 0, completed = 0 } = group.statusCounts;
  return active > 0 ? "active" : paused > 0 ? "paused" : completed > 0 ? "completed" : "failed";
}

// ─── Ticket Card ───────────────────────────────────────────────────────────────
function TicketCard({ group, targetTab = 0 }: { group: CampaignGroup; targetTab?: number }) {
  const total         = group.campaigns.length;
  const active        = group.statusCounts.active ?? 0;
  const paused        = group.statusCounts.paused ?? 0;
  const completed     = group.statusCounts.completed ?? 0;
  const channels      = [...new Set(group.campaigns.map(c => c.channel))];
  const totalReplies  = group.campaigns.reduce((s, c) => s + (c.lead?.reply_count ?? 0), 0);
  const positiveCount = group.campaigns.filter(c => c.lead?.has_positive).length;
  const avgProgress   = total > 0
    ? Math.round(group.campaigns.reduce((s, c) => s + (c.total_steps > 0 ? c.current_step / c.total_steps : 0), 0) / total * 100)
    : 0;
  const groupStatus = getGroupStatus(group);
  const st          = statusColors[groupStatus];
  const firstCampId = group.campaigns[0]?.id;
  const href = firstCampId
    ? `/leads/ticket/${firstCampId}${targetTab > 0 ? `?t=${targetTab}` : ""}`
    : "#";

  // Find most recent last_step_at across all campaigns
  const lastActivity = group.campaigns
    .map(c => c.last_step_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] ?? null;

  return (
    <Link
      href={href}
      className="rounded-xl border overflow-hidden flex flex-col transition-all hover:shadow-md group"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ borderColor: C.border, backgroundColor: C.bg }}
      >
        <div className="flex items-center gap-2">
          {channels.map(ch => {
            const meta = channelMeta[ch] ?? channelMeta.email;
            const Icon = meta.icon;
            return (
              <span key={ch} className="flex items-center gap-1">
                <Icon size={13} style={{ color: meta.color }} />
                <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
              </span>
            );
          })}
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-md capitalize"
          style={{ backgroundColor: st.bg, color: st.color }}
        >
          {groupStatus}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-4 flex-1">
        <h3
          className="text-sm font-bold mb-1 group-hover:underline"
          style={{ color: C.textPrimary }}
        >
          {group.name}
        </h3>
        <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: C.textMuted }}>
          <span>{total} {total === 1 ? "lead" : "leads"}</span>
          {active > 0    && <><span>·</span><span style={{ color: C.green }}>{active} active</span></>}
          {paused > 0    && <><span>·</span><span style={{ color: "#D97706" }}>{paused} paused</span></>}
          {completed > 0 && <><span>·</span><span>{completed} done</span></>}
        </div>

        {/* Reply indicators */}
        {(totalReplies > 0 || positiveCount > 0) && (
          <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: C.textDim }}>
            {totalReplies > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare size={9} /> {totalReplies} {totalReplies === 1 ? "reply" : "replies"}
              </span>
            )}
            {positiveCount > 0 && (
              <span className="flex items-center gap-1" style={{ color: C.green }}>
                <CheckCircle size={9} /> {positiveCount} positive
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2.5 border-t flex items-center justify-between gap-2"
        style={{ borderColor: C.border, backgroundColor: C.bg }}
      >
        {/* Progress */}
        <div className="flex items-center gap-2 flex-1">
          <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
            <div
              className="h-1 rounded-full"
              style={{ width: `${avgProgress}%`, background: `linear-gradient(90deg, ${gold}, #e8c84a)` }}
            />
          </div>
          <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{avgProgress}%</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lastActivity && (
            <span className="text-[10px] flex items-center gap-0.5" style={{ color: C.textDim }}>
              <Clock size={9} /> {timeAgo(lastActivity)}
            </span>
          )}
          <ChevronRight size={13} style={{ color: C.textDim }} className="transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

// ─── Collapsible Lead Table (for No Campaign tab) ────────────────────────────
const PAGE_SIZE = 20;

function LeadProfileSection({
  profileName,
  profileId,
  leads,
  profile,
  defaultOpen,
}: {
  profileName: string;
  profileId: string | null;
  leads: LeadInfo[];
  profile: { target_industries?: string[]; target_roles?: string[] } | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const visible = leads.slice(0, showCount);
  const hasMore = showCount < leads.length;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      {/* Section header — clickable to expand/collapse */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-black/[0.02]"
        style={{ backgroundColor: C.bg }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {open ? <ChevronDown size={14} style={{ color: C.textDim }} /> : <ChevronRight size={14} style={{ color: C.textDim }} />}
            <Users size={14} style={{ color: gold }} />
          </div>
          <div>
            <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{profileName}</span>
            <span className="text-xs ml-2 tabular-nums" style={{ color: C.textMuted }}>{leads.length} leads</span>
          </div>
          {profile && (
            <span className="text-[10px] hidden sm:inline" style={{ color: C.textDim }}>
              {[...(profile.target_industries ?? []), ...(profile.target_roles ?? [])].slice(0, 3).join(", ")}
            </span>
          )}
        </div>
        <Link
          href={profileId ? `/campaigns/new/${profileId}` : "/campaigns/new"}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 shrink-0"
          style={{ backgroundColor: `${gold}15`, color: gold, border: `1px solid ${gold}30` }}
        >
          <Megaphone size={11} /> Configure all
        </Link>
      </button>

      {/* Collapsed: hidden / Expanded: compact table */}
      {open && (
        <div>
          <div className="border-t" style={{ borderColor: C.border }} />
          <table className="w-full text-left">
            <thead>
              <tr style={{ backgroundColor: C.bg }}>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Lead</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell" style={{ color: C.textMuted }}>Company</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider hidden lg:table-cell" style={{ color: C.textMuted }}>Role</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Score</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider hidden sm:table-cell" style={{ color: C.textMuted }}>Added</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-right" style={{ color: C.textMuted }}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(lead => {
                const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
                const badge = scoreBadge(lead.score, lead.is_priority);
                const ago = timeAgo(lead.created_at ?? null);
                return (
                  <tr
                    key={lead.id}
                    className="border-t transition-colors hover:bg-black/[0.015]"
                    style={{ borderColor: C.border }}
                  >
                    <td className="px-4 py-2.5">
                      <Link href={`/leads/${lead.id}`} className="flex items-center gap-2.5 group/row">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}
                        >
                          {((lead.company ?? name)[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-semibold group-hover/row:underline block truncate" style={{ color: C.textPrimary }}>
                            {name}
                          </span>
                          <span className="text-[10px] truncate block md:hidden" style={{ color: C.textMuted }}>
                            {lead.company ?? "—"}
                          </span>
                        </div>
                        {lead.is_priority && <Star size={10} fill={gold} stroke={gold} className="shrink-0" />}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <span className="text-xs truncate block max-w-[180px]" style={{ color: C.textMuted }}>
                        {lead.company ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      <span className="text-xs truncate block max-w-[180px]" style={{ color: C.textMuted }}>
                        {lead.role ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded inline-block"
                        style={{ backgroundColor: badge.bg, color: badge.color }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <span className="text-[10px]" style={{ color: C.textDim }}>
                        {ago ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-[10px] font-medium hover:underline"
                        style={{ color: gold }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Show more */}
          {hasMore && (
            <div className="border-t px-4 py-2.5 text-center" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <button
                onClick={() => setShowCount(c => c + PAGE_SIZE)}
                className="text-xs font-medium hover:underline"
                style={{ color: gold }}
              >
                Show more ({leads.length - showCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function LeadsCampaignsClient({
  campaignGroups,
  uncampaignedGroups,
  icpMap,
  totalUncampaigned,
}: Props) {
  const [tab, setTab]       = useState(0);
  const [search, setSearch] = useState("");

  // A group is "active" if it has any active or paused campaigns
  const activeGroups = campaignGroups.filter(g =>
    (g.statusCounts.active ?? 0) + (g.statusCounts.paused ?? 0) > 0
  );
  // A group is "completed" if it has any completed or failed campaigns
  // (may overlap with active groups — a ticket can be partially completed)
  const completedGroups = campaignGroups.filter(g =>
    (g.statusCounts.completed ?? 0) + (g.statusCounts.failed ?? 0) > 0
  );

  const filterGroups = (list: CampaignGroup[]) =>
    !search ? list : list.filter(g =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.campaigns.some(c => {
        const l = c.lead;
        if (!l) return false;
        return `${l.first_name} ${l.last_name} ${l.company} ${l.email}`
          .toLowerCase().includes(search.toLowerCase());
      })
    );

  // Flatten uncampaigned leads for search + count
  const allUncampaigned = Object.entries(uncampaignedGroups).flatMap(([, g]) => g.leads);
  const filteredUncampaigned = !search
    ? Object.entries(uncampaignedGroups)
    : Object.entries(uncampaignedGroups).map(([key, g]) => [key, {
        ...g,
        leads: g.leads.filter(l =>
          `${l.first_name} ${l.last_name} ${l.company} ${l.email}`
            .toLowerCase().includes(search.toLowerCase())
        ),
      }] as [string, { profile_id: string | null; leads: LeadInfo[] }])
        .filter(([, g]) => g.leads.length > 0);

  const totalLeads      = campaignGroups.reduce((s, g) => s + g.campaigns.length, 0);
  const positiveReplies = campaignGroups.reduce((s, g) => s + g.campaigns.filter(c => c.lead?.has_positive).length, 0);

  const tabs = [
    { label: "Active",      count: activeGroups.length,    color: gold },
    { label: "Completed",   count: completedGroups.length, color: C.textMuted },
    { label: "No Campaign", count: totalUncampaigned,      color: C.blue },
  ];

  return (
    <div>
      {/* ── Stat bar ─────────────────────────────────── */}
      <div
        className="flex items-center gap-6 mb-6 px-5 py-3 rounded-xl border"
        style={{ backgroundColor: C.card, borderColor: C.border }}
      >
        {[
          { label: "Active Tickets",   value: activeGroups.length,    color: gold },
          { label: "Total Leads",      value: totalLeads,             color: C.textBody },
          { label: "Uncampaigned",     value: totalUncampaigned,      color: C.blue },
          { label: "Positive Replies", value: positiveReplies,        color: C.green },
        ].map((s, i, arr) => (
          <div key={s.label} className="flex items-center gap-4">
            <div>
              <span className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</span>
              <span className="text-xs ml-2 font-medium" style={{ color: C.textMuted }}>{s.label}</span>
            </div>
            {i < arr.length - 1 && <div className="h-5 w-px" style={{ backgroundColor: C.border }} />}
          </div>
        ))}
      </div>

      {/* ── Tabs + search ────────────────────────────── */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          return (
            <button
              key={t.label}
              onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: isActive ? `${t.color}15` : "#F3F4F6",
                    color: isActive ? t.color : C.textDim,
                  }}
                >
                  {t.count}
                </span>
              )}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />
              )}
            </button>
          );
        })}
        <div className="flex-1 flex justify-end">
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 mb-1"
            style={{ borderColor: C.border, backgroundColor: C.card }}
          >
            <Search size={14} style={{ color: C.textDim }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="bg-transparent text-sm outline-none w-40"
              style={{ color: C.textPrimary }}
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X size={12} style={{ color: C.textDim }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab 0: Active ────────────────────────────── */}
      {tab === 0 && (
        filterGroups(activeGroups).length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Megaphone size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No tickets match your search" : "No active campaigns yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filterGroups(activeGroups).map(g => <TicketCard key={g.name} group={g} />)}
          </div>
        )
      )}

      {/* ── Tab 1: Completed ─────────────────────────── */}
      {tab === 1 && (
        filterGroups(completedGroups).length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No completed tickets match your search" : "No completed campaigns yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filterGroups(completedGroups).map(g => <TicketCard key={g.name} group={g} targetTab={1} />)}
          </div>
        )
      )}

      {/* ── Tab 2: No Campaign ───────────────────────── */}
      {tab === 2 && (
        allUncampaigned.length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>All leads have active campaigns</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredUncampaigned.map(([key, group], idx) => {
              const profile = group.profile_id ? icpMap[group.profile_id] : null;
              const profileName = profile?.profile_name ?? "Unassigned";
              return (
                <LeadProfileSection
                  key={key}
                  profileName={profileName}
                  profileId={group.profile_id}
                  leads={group.leads}
                  profile={profile}
                  defaultOpen={idx === 0}
                />
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
