"use client";

import Link from "next/link";
import { C } from "@/lib/design";
import { Share2, Mail, Phone, BarChart3 } from "lucide-react";

const gold = "#C9A83A";

type Campaign = {
  id: string;
  name: string;
  status: string;
  channel: string;
  current_step: number;
  sequence_steps: any[] | null;
  last_step_at: string | null;
  paused_until: string | null;
  completed_at: string | null;
  created_at: string;
  leads: {
    id: string;
    primary_first_name: string | null;
    primary_last_name: string | null;
    company_name: string | null;
    primary_title_role: string | null;
    status: string | null;
  } | null;
  sellers: { name: string } | null;
};

type CampaignGroup = {
  name: string;
  campaigns: Campaign[];
  channels: string[];
  statusCounts: Record<string, number>;
  totalLeads: number;
  avgProgress: number;
  sellers: string[];
  newestDate: string;
};

const channelMeta: Record<string, { icon: React.ElementType; color: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2" },
  email:    { icon: Mail,   color: "#7C3AED" },
  whatsapp: { icon: Mail,   color: "#25D366" },
  call:     { icon: Phone,  color: "#F97316" },
};

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB" },
  completed: { label: "Completed", color: C.textMuted, bg: "#F3F4F6" },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight },
};

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
    const statusCounts: Record<string, number> = {};
    camps.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1; });
    const progressValues = camps.map(c => {
      const total = c.sequence_steps?.length ?? 0;
      return total > 0 ? c.current_step / total : 0;
    });
    const avgProgress = progressValues.length > 0 ? Math.round((progressValues.reduce((a, b) => a + b, 0) / progressValues.length) * 100) : 0;
    const sellers = [...new Set(camps.map(c => c.sellers?.name).filter(Boolean))] as string[];
    const newestDate = camps.reduce((latest, c) => c.created_at > latest ? c.created_at : latest, camps[0].created_at);
    return { name, campaigns: camps, channels, statusCounts, totalLeads: camps.length, avgProgress, sellers, newestDate };
  }).sort((a, b) => b.newestDate.localeCompare(a.newestDate));
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
    <div className="grid grid-cols-3 gap-4">
      {groups.map((group) => {
        const activeCount = group.statusCounts["active"] ?? 0;
        const completedCount = group.statusCounts["completed"] ?? 0;
        const groupStatus = activeCount > 0 ? "active" : (group.statusCounts["paused"] ?? 0) > 0 ? "paused" : completedCount > 0 ? "completed" : "failed";

        return (
          <Link key={group.name} href={`/campaigns/${group.campaigns[0]?.id}`}
            className="rounded-xl border overflow-hidden transition-all hover:shadow-md block"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{group.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    {group.channels.map(ch => {
                      const meta = channelMeta[ch];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      return <Icon key={ch} size={14} style={{ color: meta.color }} />;
                    })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-3">
                {[
                  { label: "ACTIVE", value: activeCount, color: C.green },
                  { label: "DONE", value: completedCount, color: C.textMuted },
                  { label: "PROGRESS", value: `${group.avgProgress}%`, color: gold },
                ].map(s => (
                  <div key={s.label} className="flex-1 rounded-lg border px-3 py-2 text-center" style={{ borderColor: C.border }}>
                    <p className="text-lg font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium" style={{ color: C.textMuted }}>
                  {group.sellers.length > 0 ? group.sellers.join(", ") : "Auto-Assignment"}
                </span>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                  style={{ backgroundColor: statusConfig[groupStatus]?.bg, color: statusConfig[groupStatus]?.color }}>
                  {statusConfig[groupStatus]?.label}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
