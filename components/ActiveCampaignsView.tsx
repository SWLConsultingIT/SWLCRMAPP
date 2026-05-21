"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { Share2, Mail, Phone, BarChart3, Clock, Target, ChevronDown, Users, ChevronRight } from "lucide-react";

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
  totalActive: number;
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
      totalActive: gs.reduce((s, g) => s + g.active, 0),
      totalReplies: gs.reduce((s, g) => s + g.totalReplies, 0),
      totalPositive: gs.reduce((s, g) => s + g.totalPositive, 0),
      groups: gs,
    };
  });
  return sections.sort((a, b) => {
    if (a.id === null && b.id !== null) return 1;
    if (b.id === null && a.id !== null) return -1;
    return b.totalLeads - a.totalLeads;
  });
}

function MetricTile({ label, value, sub, accent, dim }: { label: string; value: string | number; sub?: string | null; accent: string; dim: boolean }) {
  return (
    <div className="rounded-xl border px-4 py-3 min-w-[120px] flex-1"
      style={{
        borderColor: dim ? C.border : `color-mix(in srgb, ${accent} 22%, transparent)`,
        backgroundColor: dim ? C.bg : `color-mix(in srgb, ${accent} 5%, var(--card))`,
      }}>
      <p className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textDim }}>{label}</p>
      <p className="text-[22px] font-bold tabular-nums leading-none mt-1.5"
        style={{ color: dim ? C.textPrimary : accent, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] mt-1" style={{ color: C.textDim }}>{sub}</p>
      )}
    </div>
  );
}

function FlowRow({ group }: { group: CampaignGroup }) {
  const st = statusConfig[group.status] ?? statusConfig.active;
  const responseRate = group.totalLeads > 0 ? Math.round((group.totalReplies / group.totalLeads) * 100) : 0;
  const positiveRate = group.totalLeads > 0 ? Math.round((group.totalPositive / group.totalLeads) * 100) : 0;
  const ago = timeAgo(group.lastActivity);

  return (
    <Link href={`/campaigns/${group.firstId}`}
      className="block relative rounded-2xl overflow-hidden transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:shadow-lg group cursor-pointer"
      style={{
        backgroundColor: C.card,
        // 1.5px border for definition against the tinted section bg, plus an
        // outer ring that fires on hover to make "this whole block is a link"
        // unmistakable. Without it the row blended into the surrounding section.
        boxShadow: "0 1px 0 rgba(0,0,0,0.04), 0 0 0 1.5px rgba(0,0,0,0.06)",
        ["--hover-ring" as any]: `color-mix(in srgb, ${st.color} 55%, transparent)`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.07), 0 0 0 1.5px var(--hover-ring)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 0 rgba(0,0,0,0.04), 0 0 0 1.5px rgba(0,0,0,0.06)";
      }}>
      {/* Status accent bar — bold left edge tells the seller at a glance. */}
      <div aria-hidden className="absolute left-0 top-0 bottom-0" style={{ width: 4, backgroundColor: st.color }} />

      {/* Affordance: a quiet chevron on the right that brightens on hover so
          the whole row reads as a single clickable entity. */}
      <div aria-hidden className="absolute right-4 top-1/2 -translate-y-1/2 transition-[opacity,transform] duration-150 opacity-30 group-hover:opacity-100 group-hover:translate-x-0.5"
        style={{ color: st.color }}>
        <ChevronRight size={20} />
      </div>

      <div className="pl-6 pr-10 py-4">
        {/* Top row: channels + name + status + seller. Single line at wide widths. */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              {group.channels.map(ch => {
                const meta = channelMeta[ch] ?? channelMeta.email;
                const Icon = meta.icon;
                return (
                  <span key={ch} className="inline-flex items-center justify-center rounded-lg"
                    style={{ width: 24, height: 24, backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)` }}
                    title={meta.label}>
                    <Icon size={12} style={{ color: meta.color }} />
                  </span>
                );
              })}
            </div>
            <h3 className="text-[16px] font-semibold truncate group-hover:underline"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
              {group.name}
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: st.bg,
                color: st.color,
                border: `1px solid color-mix(in srgb, ${st.color} 22%, transparent)`,
              }}>
              {st.label}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] shrink-0" style={{ color: C.textMuted }}>
            {group.sellers.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Users size={11} />
                <span style={{ color: C.textBody, fontWeight: 500 }}>{group.sellers.join(", ")}</span>
              </span>
            )}
            {ago && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> {ago}
              </span>
            )}
          </div>
        </div>

        {/* Metric tiles + progress — laid out as a horizontal strip so the
            seller can scan KPIs left-to-right without scrolling. Progress
            bar sits on the right and stretches to fill remaining space. */}
        <div className="flex items-stretch gap-3 flex-wrap">
          <MetricTile label="Leads" value={group.totalLeads}
            sub={group.active > 0 ? `${group.active} active${group.completed > 0 ? ` · ${group.completed} done` : ""}` : group.completed > 0 ? `${group.completed} done` : null}
            accent={gold} dim={true} />
          <MetricTile label="Replies" value={group.totalReplies}
            sub={`${responseRate}% response rate`}
            accent={C.blue} dim={group.totalReplies === 0} />
          <MetricTile label="Positive" value={group.totalPositive}
            sub={`${positiveRate}% positive rate`}
            accent={C.green} dim={group.totalPositive === 0} />

          {/* Progress block — fills remaining horizontal space. Big, friendly,
              tells the seller "how far through the sequence am I on average". */}
          <div className="rounded-xl border px-4 py-3 flex-[2] min-w-[220px]"
            style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textDim }}>Sequence Progress</p>
              <p className="text-[12px] font-bold tabular-nums" style={{ color: C.textPrimary }}>{group.avgProgress}%</p>
            </div>
            <div className="mt-2.5 h-2 rounded-full" style={{ backgroundColor: C.border }}>
              <div className="h-2 rounded-full transition-[width] duration-300"
                style={{
                  width: `${group.avgProgress}%`,
                  background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 65%, white))`,
                }} />
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: C.textDim }}>
              Average across all leads in this flow
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function IcpSectionBlock({ section, defaultOpen }: { section: IcpSection; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = `flows.icp.${section.id ?? "uncategorized"}.collapsed`;

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === "1") setOpen(false);
      else if (v === "0") setOpen(true);
    } catch { /* private mode */ }
    setHydrated(true);
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(storageKey, next ? "0" : "1"); } catch { /* ignore */ }
  }

  const responseRate = section.totalLeads > 0 ? Math.round((section.totalReplies / section.totalLeads) * 100) : 0;

  return (
    <section className="rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: C.border,
        boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
      }}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="w-full flex items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-black/[0.02]"
        style={{ borderBottom: open ? `1px solid ${C.border}` : "none" }}>
        {/* Decorative icon disc + ICP info */}
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
            boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 30%, transparent)`,
          }}>
          <Target size={18} style={{ color: "#fff" }} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: gold, letterSpacing: "0.14em" }}>ICP Profile</p>
            <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {section.groups.length} flow{section.groups.length === 1 ? "" : "s"}
            </span>
          </div>
          <h2 className="text-[17px] font-bold leading-tight truncate"
            style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
            {section.name}
          </h2>
          {section.description && (
            <p className="text-[11px] truncate mt-0.5" style={{ color: C.textMuted }}>{section.description}</p>
          )}
        </div>

        {/* Rolled-up metrics — shown in the header so the manager can scan
            ICP performance without expanding every section. */}
        <div className="hidden md:flex items-center gap-5 shrink-0 mr-3">
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>Leads</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5" style={{ color: C.textPrimary }}>
              {section.totalLeads}
              {section.totalActive > 0 && (
                <span className="ml-1 text-[10px]" style={{ color: C.green }}>({section.totalActive} active)</span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>Replies</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5"
              style={{ color: section.totalReplies > 0 ? C.blue : C.textPrimary }}>
              {section.totalReplies}
              <span className="ml-1 text-[10px]" style={{ color: C.textDim }}>({responseRate}%)</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>Positive</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5"
              style={{ color: section.totalPositive > 0 ? C.green : C.textPrimary }}>
              {section.totalPositive}
            </p>
          </div>
        </div>

        <ChevronDown size={18}
          className="shrink-0 transition-transform duration-200"
          style={{
            color: C.textMuted,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            opacity: hydrated ? 1 : 0,
          }} />
      </button>

      {open && (
        <div className="p-5 space-y-3"
          style={{
            // Deeper inset so the white flow cards float above this surface
            // with obvious contrast — without it the rows blended into the
            // section background and lost their "row" affordance.
            background: `linear-gradient(180deg, color-mix(in srgb, var(--c-bg, ${C.bg}) 95%, transparent) 0%, color-mix(in srgb, var(--c-bg, ${C.bg}) 85%, transparent) 100%)`,
          }}>
          {section.groups.map(g => <FlowRow key={g.name} group={g} />)}
        </div>
      )}
    </section>
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
    <div className="space-y-4">
      {sections.map((section, i) => (
        <IcpSectionBlock key={section.id ?? "uncategorized"} section={section} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
