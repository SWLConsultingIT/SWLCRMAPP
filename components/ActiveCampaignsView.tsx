"use client";

import Link from "next/link";
import { C } from "@/lib/design";
import { Share2, Mail, Phone, BarChart3, MessageSquare, Clock, CheckCircle, Target } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type Campaign = {
  id: string;
  name: string;
  status: string;
  channel: string;
  current_step: number;
  sequence_steps: any[] | null;
  last_step_at: string | null;
  created_at: string;
  leads: {
    id: string;
    primary_first_name: string | null;
    primary_last_name: string | null;
    company_name: string | null;
    status: string | null;
    icp_profile_id?: string | null;
  } | null;
  sellers: { name: string } | null;
  reply_count?: number;
  positive_count?: number;
  sent_steps?: number;
  total_steps?: number;
};

type IcpProfile = {
  id: string;
  profile_name: string | null;
  target_industries?: string[] | null;
  target_roles?: string[] | null;
};

type CampaignGroup = {
  name: string;
  firstId: string;
  channels: string[];
  totalLeads: number;
  active: number;
  completed: number;
  avgProgress: number;
  totalReplies: number;
  totalPositive: number;
  sellers: string[];
  lastActivity: string | null;
  status: string;
  icpProfileId: string | null;
};

type IcpSection = {
  id: string | null;
  name: string;
  description: string | null;
  totalLeads: number;
  totalReplies: number;
  totalPositive: number;
  groups: CampaignGroup[];
};

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  whatsapp: { icon: Mail,   color: "#25D366", label: "WhatsApp" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB" },
  completed: { label: "Completed", color: C.textMuted, bg: C.surface },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight },
};

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function groupCampaigns(campaigns: Campaign[]): CampaignGroup[] {
  const groups: Record<string, Campaign[]> = {};
  for (const c of campaigns) {
    const key = c.name || "Unnamed";
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  return Object.entries(groups).map(([name, camps]) => {
    const channels = [...new Set(camps.flatMap(c => {
      const steps = c.sequence_steps ?? [];
      return steps.map((s: any) => typeof s === "string" ? s : s?.channel).filter(Boolean);
    }))];
    if (channels.length === 0) channels.push(...new Set(camps.map(c => c.channel)));

    const active = camps.filter(c => c.status === "active").length;
    const completed = camps.filter(c => c.status === "completed").length;
    const paused = camps.filter(c => c.status === "paused").length;

    const progressValues = camps.map(c => {
      if ((c.leads as any)?.status === "closed_lost") return 1;
      if ((c.reply_count ?? 0) > 0) return 1;
      const total = c.total_steps ?? 0;
      const sent = c.sent_steps ?? 0;
      return total > 0 ? sent / total : 0;
    });
    const avgProgress = progressValues.length > 0 ? Math.round((progressValues.reduce((a, b) => a + b, 0) / progressValues.length) * 100) : 0;

    const sellers = [...new Set(camps.map(c => c.sellers?.name).filter(Boolean))] as string[];

    const lastActivity = camps
      .map(c => c.last_step_at)
      .filter(Boolean)
      .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] ?? null;

    const totalReplies = camps.reduce((s, c) => s + (c.reply_count ?? 0), 0);
    const totalPositive = camps.reduce((s, c) => s + (c.positive_count ?? 0), 0);

    const groupStatus = active > 0 ? "active" : paused > 0 ? "paused" : completed > 0 ? "completed" : "failed";

    // Pick the dominant ICP for this campaign group: in practice every lead in
    // a campaign shares an ICP because the wizard creates one campaign per
    // ICP, but we tally just in case (e.g. a manually-assembled flow).
    const icpCounts: Record<string, number> = {};
    for (const c of camps) {
      const id = (c.leads as any)?.icp_profile_id ?? "__none";
      icpCounts[id] = (icpCounts[id] ?? 0) + 1;
    }
    const dominantIcp = Object.entries(icpCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "__none";

    return {
      name,
      firstId: camps[0].id,
      channels: [...new Set(channels)],
      totalLeads: camps.length,
      active,
      completed,
      avgProgress,
      totalReplies,
      totalPositive,
      sellers,
      lastActivity,
      status: groupStatus,
      icpProfileId: dominantIcp === "__none" ? null : dominantIcp,
    };
  }).sort((a, b) => b.active - a.active || b.totalLeads - a.totalLeads);
}

// Build the ICP-grouped sections from already-grouped campaign rows. Sections
// with no flows are dropped; the order is "most active first" so the section a
// seller most likely wants to act on lives at the top of the screen.
function buildIcpSections(groups: CampaignGroup[], icpMap: Record<string, IcpProfile>): IcpSection[] {
  const byIcp: Record<string, CampaignGroup[]> = {};
  for (const g of groups) {
    const key = g.icpProfileId ?? "__none";
    if (!byIcp[key]) byIcp[key] = [];
    byIcp[key].push(g);
  }
  const sections: IcpSection[] = Object.entries(byIcp).map(([id, gs]) => {
    const profile = id !== "__none" ? icpMap[id] : null;
    const name = profile?.profile_name ?? "Uncategorized";
    const description = profile
      ? [...(profile.target_industries ?? []), ...(profile.target_roles ?? [])]
          .filter(Boolean).slice(0, 3).join(" · ") || null
      : null;
    return {
      id: id === "__none" ? null : id,
      name,
      description,
      totalLeads: gs.reduce((s, g) => s + g.totalLeads, 0),
      totalReplies: gs.reduce((s, g) => s + g.totalReplies, 0),
      totalPositive: gs.reduce((s, g) => s + g.totalPositive, 0),
      groups: gs,
    };
  });
  // Active-leads-first ordering. Uncategorized always sinks to the bottom so
  // it doesn't compete for attention with real ICPs.
  return sections.sort((a, b) => {
    if (a.id === null && b.id !== null) return 1;
    if (b.id === null && a.id !== null) return -1;
    return b.totalLeads - a.totalLeads;
  });
}

function FlowCard({ group }: { group: CampaignGroup }) {
  const st = statusConfig[group.status] ?? statusConfig.active;
  const responseRate = group.totalLeads > 0 ? Math.round((group.totalReplies / group.totalLeads) * 100) : 0;
  const positiveRate = group.totalLeads > 0 ? Math.round((group.totalPositive / group.totalLeads) * 100) : 0;
  const ago = timeAgo(group.lastActivity);

  return (
    <Link
      href={`/campaigns/${group.firstId}`}
      className="rounded-2xl border overflow-hidden transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:shadow-lg group relative"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        borderTop: `3px solid ${st.color}`,
        boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
      }}
    >
      <div aria-hidden className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none opacity-40"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${st.color} 18%, transparent) 0%, transparent 70%)` }} />

      {/* Top bar: channels + status */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b relative"
        style={{
          borderColor: C.border,
          background: `linear-gradient(90deg, color-mix(in srgb, ${st.color} 4%, transparent) 0%, transparent 60%)`,
        }}>
        <div className="flex items-center gap-2">
          {group.channels.map(ch => {
            const meta = channelMeta[ch] ?? channelMeta.email;
            const Icon = meta.icon;
            return (
              <span key={ch} className="flex items-center gap-1">
                <Icon size={12} style={{ color: meta.color }} />
                <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
              </span>
            );
          })}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: st.bg,
            color: st.color,
            border: `1px solid color-mix(in srgb, ${st.color} 22%, transparent)`,
          }}>
          {st.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 relative">
        <h3 className="text-[15px] font-semibold mb-2 group-hover:underline"
          style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
          {group.name}
        </h3>

        {/* Headline metric strip: three tiles — leads, replies (+rate), positive (+rate).
            Always visible, always tabular numbers, so the seller can compare
            cards at a glance even when values are 0. */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-lg px-2.5 py-2 border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim, letterSpacing: "0.06em" }}>Leads</p>
            <p className="text-base font-bold tabular-nums leading-none mt-1" style={{ color: C.textPrimary }}>{group.totalLeads}</p>
            {group.active > 0 && (
              <p className="text-[9px] mt-0.5" style={{ color: C.green }}>{group.active} active</p>
            )}
          </div>
          <div className="rounded-lg px-2.5 py-2 border"
            style={{
              borderColor: group.totalReplies > 0 ? `color-mix(in srgb, ${C.blue} 22%, transparent)` : C.border,
              backgroundColor: group.totalReplies > 0 ? `color-mix(in srgb, ${C.blue} 4%, transparent)` : C.bg,
            }}>
            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim, letterSpacing: "0.06em" }}>Replies</p>
            <p className="text-base font-bold tabular-nums leading-none mt-1" style={{ color: group.totalReplies > 0 ? C.blue : C.textPrimary }}>{group.totalReplies}</p>
            <p className="text-[9px] mt-0.5" style={{ color: C.textDim }}>{responseRate}% rate</p>
          </div>
          <div className="rounded-lg px-2.5 py-2 border"
            style={{
              borderColor: group.totalPositive > 0 ? `color-mix(in srgb, ${C.green} 22%, transparent)` : C.border,
              backgroundColor: group.totalPositive > 0 ? `color-mix(in srgb, ${C.green} 4%, transparent)` : C.bg,
            }}>
            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim, letterSpacing: "0.06em" }}>Positive</p>
            <p className="text-base font-bold tabular-nums leading-none mt-1" style={{ color: group.totalPositive > 0 ? C.green : C.textPrimary }}>{group.totalPositive}</p>
            <p className="text-[9px] mt-0.5" style={{ color: C.textDim }}>{positiveRate}% rate</p>
          </div>
        </div>

        {/* Seller line + completed count if any */}
        <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: C.textDim }}>
          {group.sellers.length > 0 ? (
            <span>Seller{group.sellers.length > 1 ? "s" : ""}: <span style={{ color: C.textBody, fontWeight: 500 }}>{group.sellers.join(", ")}</span></span>
          ) : <span />}
          {group.completed > 0 && (
            <span className="flex items-center gap-1" style={{ color: C.textMuted }}>
              <CheckCircle size={9} /> {group.completed} done
            </span>
          )}
        </div>
      </div>

      {/* Footer: progress + last activity */}
      <div className="px-4 py-2.5 border-t flex items-center justify-between gap-2"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <div className="flex items-center gap-2 flex-1">
          <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: C.border }}>
            <div className="h-1 rounded-full"
              style={{ width: `${group.avgProgress}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} />
          </div>
          <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{group.avgProgress}%</span>
        </div>
        {ago && (
          <span className="text-[10px] flex items-center gap-0.5 shrink-0" style={{ color: C.textDim }}>
            <Clock size={9} /> {ago}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function ActiveCampaignsView({ campaigns, icpMap }: { campaigns: Campaign[]; icpMap: Record<string, IcpProfile> }) {
  const groups = groupCampaigns(campaigns);
  const sections = buildIcpSections(groups, icpMap);

  if (sections.length === 0) {
    return (
      <div className="rounded-2xl border py-16 text-center"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
          style={{
            backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${gold} 18%, transparent)`,
          }}>
          <BarChart3 size={22} style={{ color: gold }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>No active flows yet</p>
        <p className="text-xs mt-1.5" style={{ color: C.textDim }}>Open the New Flow tab to launch your first one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => {
        const responseRate = section.totalLeads > 0 ? Math.round((section.totalReplies / section.totalLeads) * 100) : 0;
        return (
          <section key={section.id ?? "uncategorized"}>
            {/* Section header — ICP name + rolled-up metrics for the whole ICP.
                Lets a manager scan ICP performance without expanding every card. */}
            <header className="flex items-end justify-between gap-4 mb-3 pb-2 border-b" style={{ borderColor: C.border }}>
              <div className="min-w-0 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
                  }}>
                  <Target size={16} style={{ color: gold }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textDim }}>ICP Profile</p>
                  <h2 className="text-base font-bold truncate"
                    style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
                    {section.name}
                  </h2>
                  {section.description && (
                    <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{section.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] shrink-0" style={{ color: C.textMuted }}>
                <span className="flex items-center gap-1">
                  <span className="font-bold tabular-nums" style={{ color: C.textPrimary }}>{section.totalLeads}</span> leads
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare size={11} style={{ color: C.blue }} />
                  <span className="font-bold tabular-nums" style={{ color: C.textPrimary }}>{section.totalReplies}</span>
                  <span>· {responseRate}%</span>
                </span>
                {section.totalPositive > 0 && (
                  <span className="flex items-center gap-1">
                    <CheckCircle size={11} style={{ color: C.green }} />
                    <span className="font-bold tabular-nums" style={{ color: C.green }}>{section.totalPositive}</span>
                  </span>
                )}
              </div>
            </header>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.groups.map(g => <FlowCard key={g.name} group={g} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
