"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Trophy, Share2, Mail, Phone, Star,
  ExternalLink, Search, X, ChevronRight,
} from "lucide-react";
import PageHero from "@/components/PageHero";

const gold = "#C9A83A";

type OpportunityLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  score: number | null;
  is_priority: boolean;
  transferred: boolean;
  profile_name: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  win_channel: string | null;
  win_text: string | null;
  win_classification: string;
  win_date: string | null;
  channels: string[];
  steps_to_convert: number;
  total_steps: number;
  days_to_convert: number | null;
};

type Props = { leads: OpportunityLead[] };

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT", color: C.hot, bg: C.hotBg };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

export default function OpportunitiesClient({ leads }: Props) {
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [transferFilter, setTransferFilter] = useState("all");

  const profileNames = [...new Set(leads.map(l => l.profile_name).filter(Boolean))] as string[];
  const allChannels = [...new Set(leads.flatMap(l => l.channels))];

  const filtered = leads.filter(l => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${l.first_name} ${l.last_name} ${l.company} ${l.campaign_name}`.toLowerCase().includes(q)) return false;
    }
    if (profileFilter !== "all" && l.profile_name !== profileFilter) return false;
    if (channelFilter !== "all" && l.win_channel !== channelFilter) return false;
    if (transferFilter === "yes" && !l.transferred) return false;
    if (transferFilter === "no" && l.transferred) return false;
    return true;
  });

  const selectStyle = { color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` };

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Trophy}
        section="Operations"
        title="Opportunities"
        description="Track qualified leads and deals moving through your sales pipeline."
        accentColor={C.green}
        status={{ label: `${leads.length} converted`, active: leads.length > 0 }}
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 flex-1 min-w-[200px] max-w-md"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search opportunities..." className="bg-transparent text-sm outline-none flex-1"
            style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        {profileNames.length > 1 && (
          <select value={profileFilter} onChange={e => setProfileFilter(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs" style={selectStyle}>
            <option value="all">All Profiles</option>
            {profileNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {allChannels.length > 1 && (
          <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs" style={selectStyle}>
            <option value="all">All Channels</option>
            {allChannels.map(ch => <option key={ch} value={ch}>{channelMeta[ch]?.label ?? ch}</option>)}
          </select>
        )}
        <select value={transferFilter} onChange={e => setTransferFilter(e.target.value)}
          className="rounded-lg px-3 py-1.5 text-xs" style={selectStyle}>
          <option value="all">All Status</option>
          <option value="yes">Transferred</option>
          <option value="no">Pending Transfer</option>
        </select>
        <span className="text-xs" style={{ color: C.textMuted }}>{filtered.length} results</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Trophy size={32} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium" style={{ color: C.textBody }}>
            {search || profileFilter !== "all" || channelFilter !== "all" ? "No opportunities match your filters" : "No opportunities yet"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ backgroundColor: C.bg }}>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Lead</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell" style={{ color: C.textMuted }}>Company</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden lg:table-cell" style={{ color: C.textMuted }}>Campaign</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Channel</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center hidden sm:table-cell" style={{ color: C.textMuted }}>Days</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Status</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden xl:table-cell" style={{ color: C.textMuted }}>Reply</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
                const badge = scoreBadge(lead.score, lead.is_priority);
                const chMeta = channelMeta[lead.win_channel ?? "email"] ?? channelMeta.email;
                const ChIcon = chMeta.icon;
                return (
                  <tr key={lead.id} className="border-t transition-colors hover:bg-black/[0.015]" style={{ borderColor: C.border }}>
                    <td className="px-4 py-3">
                      <Link href={`/opportunities/${lead.campaign_id ?? lead.id}`} className="flex items-center gap-2.5 group/row">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ background: `linear-gradient(135deg, ${C.green}, #34D399)`, color: "#fff" }}>
                          {(lead.first_name ?? "?")[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold group-hover/row:underline truncate" style={{ color: C.textPrimary }}>{name}</span>
                            {lead.is_priority && <Star size={9} fill={gold} stroke={gold} />}
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                          </div>
                          <span className="text-[10px] block truncate md:hidden" style={{ color: C.textMuted }}>{lead.company ?? "—"}</span>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs truncate block max-w-[130px]" style={{ color: C.textMuted }}>{lead.company ?? "—"}</span>
                      {lead.role && <span className="text-[10px] truncate block max-w-[130px]" style={{ color: C.textDim }}>{lead.role}</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-[10px] truncate block max-w-[150px]" style={{ color: C.textDim }}>{lead.campaign_name ?? "—"}</span>
                      {lead.profile_name && <span className="text-[9px] truncate block max-w-[150px]" style={{ color: C.textDim }}>{lead.profile_name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: chMeta.color }}>
                        <ChIcon size={10} /> {chMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className="text-xs font-bold tabular-nums" style={{ color: gold }}>
                        {lead.days_to_convert ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {lead.transferred ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md"
                          style={{ backgroundColor: C.greenLight, color: C.green }}>
                          <ExternalLink size={9} /> In CRM
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
                          style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      {lead.win_text ? (
                        <p className="text-[10px] line-clamp-1 max-w-[200px]" style={{ color: C.textDim }}>
                          &ldquo;{lead.win_text}&rdquo;
                        </p>
                      ) : (
                        <span className="text-[10px]" style={{ color: C.textDim }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/opportunities/${lead.campaign_id ?? lead.id}`}
                        className="text-[10px] font-medium hover:underline flex items-center gap-0.5 justify-end"
                        style={{ color: gold }}>
                        Detail <ChevronRight size={10} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
