"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import Link from "next/link";
import {
  Share2, Mail, Phone, ChevronDown, ChevronRight,
  PlayCircle, PauseCircle, CheckCircle, XCircle,
  Users, BarChart3, Pause, Play, Trash2, Loader2,
} from "lucide-react";

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

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight,  icon: PlayCircle },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB",     icon: PauseCircle },
  completed: { label: "Completed", color: C.textMuted, bg: "#F3F4F6",    icon: CheckCircle },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight,    icon: XCircle },
};

const channelConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin:  { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:     { icon: Mail,   color: C.email,    label: "Email" },
  whatsapp:  { icon: Mail,   color: "#22c55e",  label: "WhatsApp" },
  call:      { icon: Phone,  color: C.phone,    label: "Call" },
};

function groupCampaigns(campaigns: Campaign[]): CampaignGroup[] {
  const groups: Record<string, Campaign[]> = {};

  for (const c of campaigns) {
    const key = c.name || "Unnamed Campaign";
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  return Object.entries(groups).map(([name, camps]) => {
    const channels = [...new Set(camps.map(c => c.channel))];
    const statusCounts: Record<string, number> = {};
    camps.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1; });

    const progressValues = camps.map(c => {
      const total = c.sequence_steps?.length ?? 0;
      return total > 0 ? c.current_step / total : 0;
    });
    const avgProgress = progressValues.length > 0
      ? Math.round((progressValues.reduce((a, b) => a + b, 0) / progressValues.length) * 100)
      : 0;

    const sellers = [...new Set(camps.map(c => c.sellers?.name).filter(Boolean))] as string[];
    const newestDate = camps.reduce((latest, c) => c.created_at > latest ? c.created_at : latest, camps[0].created_at);

    return { name, campaigns: camps, channels, statusCounts, totalLeads: camps.length, avgProgress, sellers, newestDate };
  }).sort((a, b) => b.newestDate.localeCompare(a.newestDate));
}

export default function ActiveCampaignsView({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null); // "group:name:action" or "lead:id:action"

  const groups = groupCampaigns(campaigns);

  async function handleGroupAction(group: CampaignGroup, action: "pause" | "resume" | "cancel") {
    const key = `group:${group.name}:${action}`;
    setActing(key);
    const ids = group.campaigns
      .filter(c => action === "pause" ? c.status === "active" : action === "resume" ? c.status === "paused" : ["active", "paused"].includes(c.status))
      .map(c => c.id);
    if (ids.length > 0) {
      const newStatus = action === "pause" ? "paused" : action === "resume" ? "active" : "completed";
      await supabase.from("campaigns").update({ status: newStatus }).in("id", ids);
    }
    setActing(null);
    router.refresh();
  }

  async function handleLeadAction(campaignId: string, action: "pause" | "resume" | "cancel") {
    const key = `lead:${campaignId}:${action}`;
    setActing(key);
    const newStatus = action === "pause" ? "paused" : action === "resume" ? "active" : "completed";
    await supabase.from("campaigns").update({ status: newStatus }).eq("id", campaignId);
    setActing(null);
    router.refresh();
  }

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
    <div className="space-y-4">
      {groups.map((group) => {
        const isExpanded = expandedGroup === group.name;
        const activeCount = group.statusCounts["active"] ?? 0;
        const pausedCount = group.statusCounts["paused"] ?? 0;
        const completedCount = group.statusCounts["completed"] ?? 0;
        const failedCount = group.statusCounts["failed"] ?? 0;

        // Determine overall group status color
        const groupStatusColor = activeCount > 0 ? C.green : pausedCount > 0 ? "#D97706" : C.textMuted;

        return (
          <div key={group.name} className="rounded-xl border overflow-hidden transition-shadow"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${groupStatusColor}` }}>

            {/* Campaign group header — clickable */}
            <button
              onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
              className="w-full px-6 py-5 flex items-center gap-5 text-left transition-colors hover:bg-[#FAFBFC]"
            >
              {/* Expand icon */}
              <div className="shrink-0" style={{ color: C.textMuted }}>
                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </div>

              {/* Name + channels */}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>
                  {group.name}
                </h3>
                <div className="flex items-center gap-2 mt-1.5">
                  {group.channels.map(ch => {
                    const conf = channelConfig[ch] ?? channelConfig.linkedin;
                    const Icon = conf.icon;
                    return (
                      <span key={ch} className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: `${conf.color}12`, color: conf.color }}>
                        <Icon size={11} /> {conf.label}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6 shrink-0">
                {/* Leads count */}
                <div className="text-center">
                  <div className="flex items-center gap-1.5">
                    <Users size={13} style={{ color: C.textMuted }} />
                    <span className="text-lg font-bold tabular-nums" style={{ color: C.textPrimary }}>{group.totalLeads}</span>
                  </div>
                  <p className="text-xs" style={{ color: C.textMuted }}>Leads</p>
                </div>

                {/* Status pills */}
                <div className="flex items-center gap-1.5">
                  {activeCount > 0 && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md"
                      style={{ backgroundColor: C.greenLight, color: C.green }}>
                      <PlayCircle size={11} /> {activeCount}
                    </span>
                  )}
                  {pausedCount > 0 && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md"
                      style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                      <PauseCircle size={11} /> {pausedCount}
                    </span>
                  )}
                  {completedCount > 0 && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md"
                      style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>
                      <CheckCircle size={11} /> {completedCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md"
                      style={{ backgroundColor: C.redLight, color: C.red }}>
                      <XCircle size={11} /> {failedCount}
                    </span>
                  )}
                </div>

                {/* Progress */}
                <div className="text-center w-24">
                  <div className="w-full h-2 rounded-full mb-1" style={{ backgroundColor: "#E5E7EB" }}>
                    <div className="h-2 rounded-full transition-all" style={{
                      width: `${group.avgProgress}%`,
                      background: group.avgProgress === 100 ? C.textDim : `linear-gradient(90deg, ${gold}, #e8c84a)`,
                    }} />
                  </div>
                  <p className="text-xs tabular-nums font-medium" style={{ color: C.textMuted }}>{group.avgProgress}% avg</p>
                </div>

                {/* Seller */}
                <div className="w-20 text-right">
                  <p className="text-xs font-medium truncate" style={{ color: C.textBody }}>
                    {group.sellers.length > 0 ? group.sellers.join(", ") : "—"}
                  </p>
                  <p className="text-xs" style={{ color: C.textDim }}>
                    {new Date(group.newestDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </p>
                </div>
              </div>
            </button>

            {/* Expanded — actions bar + leads table */}
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}` }}>
                {/* Group actions */}
                <div className="px-5 py-3 flex items-center gap-2 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <span className="text-xs font-medium mr-2" style={{ color: C.textMuted }}>Actions:</span>
                  {activeCount > 0 && (
                    <button onClick={() => handleGroupAction(group, "pause")}
                      disabled={!!acting}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                      {acting === `group:${group.name}:pause` ? <Loader2 size={11} className="animate-spin" /> : <Pause size={11} />}
                      Pause All
                    </button>
                  )}
                  {pausedCount > 0 && (
                    <button onClick={() => handleGroupAction(group, "resume")}
                      disabled={!!acting}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: C.greenLight, color: C.green }}>
                      {acting === `group:${group.name}:resume` ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                      Resume All
                    </button>
                  )}
                  {(activeCount > 0 || pausedCount > 0) && (
                    <button onClick={() => { if (confirm(`Cancel all ${activeCount + pausedCount} active campaigns in "${group.name}"?`)) handleGroupAction(group, "cancel"); }}
                      disabled={!!acting}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: C.redLight, color: C.red }}>
                      {acting === `group:${group.name}:cancel` ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Cancel All
                    </button>
                  )}
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: `rgba(201,168,58,0.04)` }}>
                      {["Lead", "Company", "Role", "Status", "Progress", "Last Step", ""].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider"
                          style={{ color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.campaigns.map((c) => {
                      const st = statusConfig[c.status] ?? statusConfig.active;
                      const StIcon = st.icon;
                      const totalSteps = c.sequence_steps?.length ?? 0;
                      const pct = totalSteps > 0 ? Math.round((c.current_step / totalSteps) * 100) : 0;
                      const leadName = `${c.leads?.primary_first_name ?? ""} ${c.leads?.primary_last_name ?? ""}`.trim() || "Unknown";

                      return (
                        <tr key={c.id} className="table-row-hover" style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td className="px-5 py-3">
                            <Link href={`/campaigns/${c.id}`} className="hover:underline">
                              <p className="font-medium" style={{ color: C.textPrimary }}>{leadName}</p>
                              <p className="text-xs" style={{ color: gold }}>View campaign →</p>
                            </Link>
                          </td>
                          <td className="px-5 py-3 text-xs" style={{ color: C.textBody }}>
                            {c.leads?.company_name ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-xs" style={{ color: C.textMuted }}>
                            {c.leads?.primary_title_role ?? "—"}
                          </td>
                          <td className="px-5 py-3">
                            <div className="inline-flex items-center gap-1.5 rounded-md px-2 py-1" style={{ backgroundColor: st.bg }}>
                              <StIcon size={11} style={{ color: st.color }} />
                              <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-24 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                                <div className="h-1.5 rounded-full" style={{
                                  width: `${pct}%`,
                                  background: pct === 100 ? C.textDim : `linear-gradient(90deg, ${gold}, #e8c84a)`,
                                }} />
                              </div>
                              <span className="text-xs tabular-nums font-medium" style={{ color: C.textMuted }}>
                                {c.current_step}/{totalSteps}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums" style={{ color: C.textMuted }}>
                            {c.last_step_at
                              ? new Date(c.last_step_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                              : "—"}
                          </td>
                          <td className="px-5 py-3">
                            {(c.status === "active" || c.status === "paused") && (
                              <div className="flex items-center gap-1.5">
                                {c.status === "active" ? (
                                  <button onClick={() => handleLeadAction(c.id, "pause")} disabled={!!acting}
                                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
                                    style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                                    {acting === `lead:${c.id}:pause` ? <Loader2 size={10} className="animate-spin" /> : <Pause size={10} />}
                                    Pause
                                  </button>
                                ) : (
                                  <button onClick={() => handleLeadAction(c.id, "resume")} disabled={!!acting}
                                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
                                    style={{ backgroundColor: C.greenLight, color: C.green }}>
                                    {acting === `lead:${c.id}:resume` ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                                    Resume
                                  </button>
                                )}
                                <button onClick={() => { if (confirm(`Remove ${leadName} from this campaign?`)) handleLeadAction(c.id, "cancel"); }}
                                  disabled={!!acting}
                                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
                                  style={{ backgroundColor: C.redLight, color: C.red }}>
                                  {acting === `lead:${c.id}:cancel` ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                                </button>
                              </div>
                            )}
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
      })}
    </div>
  );
}
