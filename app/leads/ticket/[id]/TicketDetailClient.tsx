"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  ArrowLeft, Star, Clock, ChevronRight, Megaphone,
  PlayCircle, CheckCircle, PauseCircle, XCircle,
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
  status: string | null;
  score: number | null;
  is_priority: boolean;
  channel: string | null;
  reply_count: number;
  has_positive: boolean;
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
};

type Props = {
  ticketName: string;
  campaigns: CampaignGroup[];
  leads: LeadInfo[];
};

const statusMeta: Record<string, { color: string; bg: string; icon: typeof PlayCircle; label: string }> = {
  active:    { color: C.green,     bg: C.greenLight, icon: PlayCircle,  label: "Active" },
  paused:    { color: "#D97706",   bg: "#FFFBEB",    icon: PauseCircle, label: "Paused" },
  completed: { color: C.textMuted, bg: "#F3F4F6",    icon: CheckCircle, label: "Completed" },
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
      href={`/campaigns/${camp.firstId}`}
      className="rounded-xl border overflow-hidden flex flex-col transition-shadow hover:shadow-md group/card"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <div className="px-4 pt-4 pb-3 flex-1">
        {/* Outreach Flow label */}
        <div className="flex items-center gap-1.5 mb-2">
          <Megaphone size={11} style={{ color: gold }} />
          <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: gold }}>Outreach Campaign</span>
          <div className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: st.bg }}>
            <StIcon size={10} style={{ color: st.color }} />
            <span className="text-[10px] font-semibold" style={{ color: st.color }}>{st.label}</span>
          </div>
        </div>

        <h3 className="text-sm font-bold mb-2 group-hover/card:underline" style={{ color: C.textPrimary }}>
          {camp.name}
        </h3>

        {/* Stats grid */}
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

      {/* Progress footer */}
      <div className="px-4 py-2.5 border-t flex items-center gap-2"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
          <div className="h-1.5 rounded-full" style={{ width: `${camp.avgProgress}%`, background: `linear-gradient(90deg, ${gold}, #e8c84a)` }} />
        </div>
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{camp.avgProgress}%</span>
        <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0 transition-transform group-hover/card:translate-x-0.5" />
      </div>
    </Link>
  );
}

// ─── Leads table ──────────────────────────────────────────────────────────────
function LeadsTable({ leads }: { leads: LeadInfo[] }) {
  // Build a map of lead campaigns for the "Campaign" column
  // We don't have lead→campaign mapping here, so we show the profile's campaigns
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>No leads in this profile</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <table className="w-full text-left">
        <thead>
          <tr style={{ backgroundColor: C.bg }}>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Lead</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell" style={{ color: C.textMuted }}>Company</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden lg:table-cell" style={{ color: C.textMuted }}>Role</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Score</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Status</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Reply</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {leads.map(lead => {
            const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
            const badge = scoreBadge(lead.score, lead.is_priority);
            const hasReply = (lead.reply_count ?? 0) > 0;
            const replyColor = lead.has_positive ? C.green : hasReply ? "#D97706" : C.textDim;
            const replyLabel = lead.has_positive ? "Positive" : hasReply ? "Replied" : "Awaiting";

            return (
              <tr key={lead.id} className="border-t transition-colors hover:bg-black/[0.015]" style={{ borderColor: C.border }}>
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="flex items-center gap-2.5 group/row">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                      {((lead.company ?? name)[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold group-hover/row:underline block truncate" style={{ color: C.textPrimary }}>{name}</span>
                      <span className="text-[10px] block truncate md:hidden" style={{ color: C.textMuted }}>{lead.company ?? "—"}</span>
                    </div>
                    {lead.is_priority && <Star size={10} fill={gold} stroke={gold} className="shrink-0" />}
                  </Link>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs truncate block max-w-[160px]" style={{ color: C.textMuted }}>{lead.company ?? "—"}</span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <span className="text-xs truncate block max-w-[160px]" style={{ color: C.textMuted }}>{lead.role ?? "—"}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded inline-block" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px]" style={{ color: C.textMuted }}>{lead.status ?? "new"}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-semibold" style={{ color: replyColor }}>{replyLabel}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/leads/${lead.id}`} className="text-[10px] font-medium hover:underline" style={{ color: gold }}>View</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function TicketDetailClient({ ticketName, campaigns, leads }: Props) {
  const [tab, setTab] = useState(0);

  const totalLeads    = leads.length;
  const totalCamps    = campaigns.length;
  const positiveCount = leads.filter(l => l.has_positive).length;
  const replyCount    = leads.reduce((s, l) => s + l.reply_count, 0);

  const tabs = [
    { label: "Outreach Campaigns", count: totalCamps,  color: gold },
    { label: "Leads",              count: totalLeads,  color: C.blue },
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
      <div className="rounded-xl border mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Lead Miner Profile</p>
          <h1 className="text-2xl font-bold mb-5" style={{ color: C.textPrimary }}>{ticketName}</h1>
          <div className="flex items-center gap-6 flex-wrap">
            {[
              { label: "Leads",     value: totalLeads,    color: C.textBody },
              { label: "Campaigns", value: totalCamps,    color: gold },
              { label: "Replies",   value: replyCount,    color: C.blue },
              { label: "Positive",  value: positiveCount, color: C.green },
            ].map((s, i, arr) => (
              <div key={s.label} className="flex items-center gap-5">
                <div>
                  <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{s.label}</p>
                </div>
                {i < arr.length - 1 && <div className="h-8 w-px" style={{ backgroundColor: C.border }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `${t.color}15` : "#F3F4F6", color: isActive ? t.color : C.textDim }}>
                  {t.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
      </div>

      {/* Tab 0: Outreach Campaigns */}
      {tab === 0 && (
        campaigns.length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <p className="text-sm" style={{ color: C.textDim }}>No campaigns for this profile yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map(c => <CampaignCard key={c.firstId} camp={c} />)}
          </div>
        )
      )}

      {/* Tab 1: Leads */}
      {tab === 1 && <LeadsTable leads={leads} />}
    </div>
  );
}
