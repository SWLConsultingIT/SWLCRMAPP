"use client";

import Link from "next/link";
import { C } from "@/lib/design";
import { Share2, Mail, Phone, BarChart3, MessageSquare, Clock, CheckCircle } from "lucide-react";

const gold = "#C9A83A";

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
  } | null;
  sellers: { name: string } | null;
  reply_count?: number;
  positive_count?: number;
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
  completed: { label: "Completed", color: C.textMuted, bg: "#F3F4F6" },
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
      const total = c.sequence_steps?.length ?? 0;
      return total > 0 ? c.current_step / total : 0;
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
    };
  }).sort((a, b) => b.active - a.active || b.totalLeads - a.totalLeads);
}

export default function ActiveCampaignsView({ campaigns }: { campaigns: Campaign[] }) {
  const groups = groupCampaigns(campaigns);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <BarChart3 size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
        <p className="text-sm font-medium" style={{ color: C.textBody }}>No campaigns yet</p>
        <p className="text-xs mt-1" style={{ color: C.textMuted }}>Go to Ready to Launch to create your first campaign</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(group => {
        const st = statusConfig[group.status] ?? statusConfig.active;
        const responseRate = group.totalLeads > 0 ? Math.round((group.totalReplies / group.totalLeads) * 100) : 0;
        const ago = timeAgo(group.lastActivity);

        return (
          <Link key={group.name} href={`/campaigns/${group.firstId}`}
            className="rounded-xl border overflow-hidden transition-all hover:shadow-md group"
            style={{ backgroundColor: C.card, borderColor: C.border }}>

            {/* Top bar: channels + status */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b"
              style={{ borderColor: C.border, backgroundColor: C.bg }}>
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
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                style={{ backgroundColor: st.bg, color: st.color }}>
                {st.label}
              </span>
            </div>

            {/* Body */}
            <div className="px-4 py-3">
              <h3 className="text-sm font-bold mb-1 group-hover:underline" style={{ color: C.textPrimary }}>{group.name}</h3>
              <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: C.textMuted }}>
                <span>{group.totalLeads} {group.totalLeads === 1 ? "lead" : "leads"}</span>
                {group.active > 0 && <><span>·</span><span style={{ color: C.green }}>{group.active} active</span></>}
                {group.completed > 0 && <><span>·</span><span>{group.completed} done</span></>}
              </div>

              {/* Response metrics */}
              <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: C.textDim }}>
                {group.totalReplies > 0 && (
                  <span className="flex items-center gap-1" style={{ color: C.blue }}>
                    <MessageSquare size={9} /> {group.totalReplies} {group.totalReplies === 1 ? "reply" : "replies"}
                    <span style={{ color: C.textDim }}>({responseRate}%)</span>
                  </span>
                )}
                {group.totalPositive > 0 && (
                  <span className="flex items-center gap-1" style={{ color: C.green }}>
                    <CheckCircle size={9} /> {group.totalPositive} positive
                  </span>
                )}
              </div>

              {/* Seller */}
              {group.sellers.length > 0 && (
                <p className="text-[10px] mt-1.5" style={{ color: C.textDim }}>
                  Seller: {group.sellers.join(", ")}
                </p>
              )}
            </div>

            {/* Footer: progress + last activity */}
            <div className="px-4 py-2.5 border-t flex items-center justify-between gap-2"
              style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <div className="flex items-center gap-2 flex-1">
                <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                  <div className="h-1 rounded-full" style={{ width: `${group.avgProgress}%`, background: `linear-gradient(90deg, ${gold}, #e8c84a)` }} />
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
      })}
    </div>
  );
}
