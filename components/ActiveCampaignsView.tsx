"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { C, N } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Share2, Mail, Phone, BarChart3, Clock, Target, ChevronDown, Users, ChevronRight, TrendingDown, ListOrdered, Plus, UserPlus, Search, X, Trophy } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type Tr = (key: string) => string;

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
  // Per-channel send breakdown + win/lost (boss 2026-05-27).
  liInvitesSent: number;
  liDmsSent: number;
  emailsSent: number;
  callsMade: number;
  wonCount: number;
  lostCount: number;
  // LinkedIn accept rate — null when the group has no LinkedIn invites
  // (e.g. an email-only flow). acceptedCount / inviteCohort fills the
  // denominator gap for the tooltip.
  acceptRate: number | null;
  acceptedCount: number;
  inviteCohort: number;
  // Sequence step count — total scripted steps in the flow (from
  // sequence_steps). Same value across every campaign in the group
  // since the steps are flow-level, not lead-level.
  totalSteps: number;
  // Funnel snapshot — top→bottom story of where the cohort drops off.
  // Stages with count 0 (except "leads") are filtered out so an email-
  // only flow doesn't show "Connections sent: 0".
  funnel: Array<{
    key: "leads" | "connSent" | "accepted" | "msgsSent" | "replied" | "positive";
    count: number;
    pctOfTop: number;          // bar width — proportion of total leads
    pctFromPrior: number | null; // drop-off rate from the previous stage
    color: string;
  }>;
  // Per-step breakdown — one entry per scripted step in the sequence.
  // sent = leads whose current_step has moved past this step (i.e. step
  // i was fired); pending = leads currently waiting on this step;
  // scheduled = leads not yet reached this step.
  steps: Array<{
    idx: number;
    channel: string;
    sent: number;
    pending: number;
    scheduled: number;
  }>;
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

// Active uses brand gold so the dominant state on the Outreach Flows page
// (where every visible card is active) reads as the brand surface itself.
// Other statuses keep their semantic palette so paused/completed/failed
// cards still pop out against the sea of gold.
// Status meta — `label` resolved at render via t(`flows.status.${key}`).
const statusConfig: Record<string, { key: string; color: string; bg: string }> = {
  active:    { key: "active",    color: "var(--brand, #c9a83a)", bg: "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)" },
  paused:    { key: "paused",    color: "#D97706",  bg: "#FFFBEB" },
  completed: { key: "completed", color: C.textMuted, bg: C.surface },
  failed:    { key: "failed",    color: C.red,      bg: C.redLight },
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
    const liInvitesSent = camps.reduce((s, c) => s + ((c as any).linkedin_invites_sent ?? 0), 0);
    const liDmsSent     = camps.reduce((s, c) => s + ((c as any).linkedin_dms_sent ?? 0), 0);
    const emailsSent    = camps.reduce((s, c) => s + ((c as any).emails_sent ?? 0), 0);
    const callsMade     = camps.reduce((s, c) => s + ((c as any).calls_made ?? 0), 0);
    const wonCount  = camps.filter(c => {
      const l = (c.leads as any);
      return l?.status === "closed_won" || l?.status === "qualified" || !!l?.transferred_to_odoo_at;
    }).length;
    const lostCount = camps.filter(c => (c.leads as any)?.status === "closed_lost").length;

    // Accept rate proxy — a LinkedIn campaign whose current_step > 1 means
    // the dispatcher unparked past the CR step (only possible once the
    // accept-webhook fired). Cohort = LinkedIn rows that fired a CR at all.
    const liCamps = camps.filter(c => c.channel === "linkedin" && ((c as any).linkedin_invites_sent ?? 0) > 0);
    const acceptedCount = liCamps.filter(c => (c.current_step ?? 0) > 1).length;
    const inviteCohort = liCamps.length;
    const acceptRate = inviteCohort > 0 ? Math.round((acceptedCount / inviteCohort) * 100) : null;
    // Step count — pick the max sequence length across the group; each
    // campaign-row in a flow shares the same sequence so this is just a
    // resilient read against a possibly-null `sequence_steps`.
    const totalSteps = camps.reduce((m, c) => {
      const n = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : (c.total_steps ?? 0);
      return n > m ? n : m;
    }, 0);

    // Funnel — head-to-toe drop-off story. Drop stages whose count is 0
    // (except "leads", which is always the top stage). pctOfTop drives
    // the bar width; pctFromPrior is the conversion-from-prior-stage %
    // that we render between rows.
    const msgsSentTotal = liDmsSent + emailsSent + callsMade;
    const funnelStagesRaw: Array<{ key: CampaignGroup["funnel"][number]["key"]; count: number; color: string }> = [
      { key: "leads",    count: camps.length,    color: "var(--brand, #c9a83a)" },
      { key: "connSent", count: liInvitesSent,   color: "#0A66C2" },
      { key: "accepted", count: acceptedCount,   color: "#10B981" },
      { key: "msgsSent", count: msgsSentTotal,   color: "#7C3AED" },
      { key: "replied",  count: totalReplies,    color: C.blue },
      { key: "positive", count: totalPositive,   color: C.green },
    ];
    const topCount = camps.length || 1;
    const funnel: CampaignGroup["funnel"] = [];
    let priorCount: number | null = null;
    for (const s of funnelStagesRaw) {
      if (s.key !== "leads" && s.count === 0 && priorCount === 0) continue; // skip blank tails
      if (s.key !== "leads" && s.count === 0 && priorCount === null) continue;
      funnel.push({
        key: s.key,
        count: s.count,
        pctOfTop: Math.round((s.count / topCount) * 100),
        pctFromPrior: priorCount === null ? null
          : priorCount === 0 ? null
          : Math.round((s.count / priorCount) * 100),
        color: s.color,
      });
      priorCount = s.count;
    }

    // Per-step breakdown — read the sequence from any campaign in the
    // group (they share the same flow). For each step idx, count how
    // many campaigns are past / at / before it.
    const sampleSequence = camps.find(c => Array.isArray(c.sequence_steps))?.sequence_steps ?? [];
    const steps: CampaignGroup["steps"] = (sampleSequence as any[]).map((s, idx) => {
      const channel = typeof s === "string" ? s : (s?.channel ?? "email");
      const sent = camps.filter(c => (c.current_step ?? 0) > idx).length;
      const pending = camps.filter(c => (c.current_step ?? 0) === idx).length;
      const scheduled = Math.max(0, camps.length - sent - pending);
      return { idx, channel, sent, pending, scheduled };
    });

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
      liInvitesSent,
      liDmsSent,
      emailsSent,
      callsMade,
      wonCount,
      lostCount,
      acceptRate,
      acceptedCount,
      inviteCohort,
      totalSteps,
      funnel,
      steps,
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
  // Every approved ICP shows up as a section — even if it has zero
  // active/paused flows. Boss feedback 2026-05-28: "que pasa si no
  // tenemos flows activos? que aparezcan los icps ahi" — so the seller
  // can click "Create New Flow" from any ICP, not just ones with
  // existing campaigns. The header still renders with metrics = 0 and
  // an "empty" body when there are no groups.
  for (const id of Object.keys(icpMap)) {
    if (!byIcp[id]) byIcp[id] = [];
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
  return sections
    // Drop the "Uncategorized" bucket when it's empty — there's nothing
    // to do with leads that have no ICP from this surface.
    .filter(s => !(s.id === null && s.groups.length === 0))
    .sort((a, b) => {
      if (a.id === null && b.id !== null) return 1;
      if (b.id === null && a.id !== null) return -1;
      // ICPs with active flows first; empty ICPs at the bottom.
      if ((a.groups.length === 0) !== (b.groups.length === 0)) {
        return a.groups.length === 0 ? 1 : -1;
      }
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

function FlowRow({ group, t }: { group: CampaignGroup; t: Tr }) {
  const st = statusConfig[group.status] ?? statusConfig.active;
  const responseRate = group.totalLeads > 0 ? Math.round((group.totalReplies / group.totalLeads) * 100) : 0;
  const positiveRate = group.totalLeads > 0 ? Math.round((group.totalPositive / group.totalLeads) * 100) : 0;
  const ago = timeAgo(group.lastActivity);
  // Boss 2026-05-29: row body (funnel + sequence) is heavy. Default-collapse
  // it so the seller scans a tight summary; expand inline for the detail.
  // The flow name remains a Link to /campaigns/[id] so navigation still
  // works without going through the expanded view.
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="relative rounded-2xl overflow-hidden transition-[transform,box-shadow,border-color] duration-150 hover:shadow-lg group"
      style={{
        backgroundColor: C.card,
        boxShadow: "0 1px 0 rgba(0,0,0,0.04), 0 0 0 1.5px rgba(0,0,0,0.06)",
      }}>
      {/* Status accent bar — bold left edge tells the seller at a glance. */}
      <div aria-hidden className="absolute left-0 top-0 bottom-0" style={{ width: 4, backgroundColor: st.color }} />

      {/* Toggle button — covers the row's clickable area without competing
          with the name Link / Add Leads link inside. */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? t("flows.row.hideDetails") : t("flows.row.showDetails")}
        className="absolute inset-0 cursor-pointer"
      />

      <div className="relative pl-6 pr-12 py-3.5 pointer-events-none">
        {/* Top row: channels + name (Link, navigates) + status + sellers/ago/AddLeads */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
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
            <Link
              href={`/campaigns/${group.firstId}`}
              className="text-[16px] font-semibold truncate hover:underline pointer-events-auto relative z-10"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}
            >
              {group.name}
            </Link>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: st.bg,
                color: st.color,
                border: `1px solid color-mix(in srgb, ${st.color} 22%, transparent)`,
              }}>
              {t(`flows.status.${st.key}`)}
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
            <Link
              href={`/campaigns/${group.firstId}?tab=add-leads`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition-opacity hover:opacity-85 pointer-events-auto relative z-10"
              style={{
                color: gold,
                backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${gold} 28%, transparent)`,
              }}
            >
              <UserPlus size={10} /> {t("flows.addLeads")}
            </Link>
          </div>
        </div>

        {/* Compact metrics line — visible in BOTH collapsed and expanded
            states so the row is informative even when the heavy funnel +
            sequence sub-cards are hidden. */}
        <div className="flex items-center gap-4 mt-2 text-[11px] tabular-nums" style={{ color: C.textMuted }}>
          <span><span className="font-bold" style={{ color: C.textBody }}>{group.totalLeads}</span> {t("flows.metric.leads").toLowerCase()}</span>
          <span><span className="font-bold" style={{ color: group.totalReplies > 0 ? C.blue : C.textBody }}>{group.totalReplies}</span> {t("flows.metric.replies").toLowerCase()} <span style={{ color: C.textDim }}>({responseRate}%)</span></span>
          <span><span className="font-bold" style={{ color: group.totalPositive > 0 ? C.green : C.textBody }}>{group.totalPositive}</span> {t("flows.metric.positive").toLowerCase()} <span style={{ color: C.textDim }}>({positiveRate}%)</span></span>
          {group.totalSteps > 0 && (
            <span><span className="font-bold" style={{ color: C.textBody }}>{group.totalSteps}</span> {t("flows.kpi.steps").toLowerCase()}</span>
          )}
        </div>
      </div>

      {/* Expand chevron — top-right, rotates when open. */}
      <div className="absolute right-4 top-4 pointer-events-none transition-transform duration-200"
        style={{ color: st.color, transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
        <ChevronRight size={18} />
      </div>

      {/* Collapsed: stop here. Expanded: render the funnel + sequence grid. */}
      {expanded && (
      <div className="relative pl-6 pr-6 pb-4 pt-0">

        {/* Status section — funnel + sequence side-by-side. Boss feedback
            2026-05-28: the seller has to read the whole flow head-to-toe.
            Left = funnel drop-off (where the cohort is dying); right =
            per-step status (what's firing right now in the sequence,
            broken down by channel). Stacks on mobile.
            Each sub-card gets a left-edge accent rail + headed eyebrow
            with icon + slight shadow so they're visually distinct from
            each other (boss follow-up: "parece todo en uno"). */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Funnel ─────────────────────────────────────────── */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              border: `1px solid color-mix(in srgb, ${gold} 22%, ${C.border})`,
              backgroundColor: C.card,
              borderLeft: `3px solid ${gold}`,
              boxShadow: `0 1px 3px rgba(0,0,0,0.04)`,
            }}
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{
                borderColor: C.border,
                backgroundColor: `color-mix(in srgb, ${gold} 5%, ${C.bg})`,
              }}>
              <span className="inline-flex items-center justify-center rounded-md shrink-0"
                style={{
                  width: 20, height: 20,
                  backgroundColor: `color-mix(in srgb, ${gold} 18%, transparent)`,
                  color: gold,
                }}>
                <TrendingDown size={11} />
              </span>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: gold }}>
                {t("flows.section.funnel")}
              </p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {group.funnel.map((stage) => (
                <div key={stage.key} className="flex items-center gap-2.5">
                  <span className="text-[10.5px] font-semibold w-[88px] shrink-0 truncate" style={{ color: C.textBody }}>
                    {t(`flows.funnel.${stage.key}`)}
                  </span>
                  <div className="flex-1 h-3 rounded-full relative overflow-hidden"
                    style={{ backgroundColor: `color-mix(in srgb, ${stage.color} 8%, transparent)` }}>
                    <div className="h-3 rounded-full transition-[width] duration-300"
                      style={{
                        width: `${Math.max(stage.pctOfTop, stage.count > 0 ? 4 : 0)}%`,
                        background: `linear-gradient(90deg, ${stage.color}, color-mix(in srgb, ${stage.color} 65%, white))`,
                      }} />
                  </div>
                  <span className="text-[12px] font-bold tabular-nums w-6 text-right shrink-0"
                    style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {stage.count}
                  </span>
                  <span className="text-[10px] tabular-nums w-10 text-right shrink-0"
                    style={{ color: stage.pctFromPrior === null ? "transparent"
                      : stage.pctFromPrior >= 50 ? C.green
                      : stage.pctFromPrior >= 20 ? C.textDim
                      : C.red }}>
                    {stage.pctFromPrior !== null ? `${stage.pctFromPrior}%` : "·"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Sequence steps ─────────────────────────────────── */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              border: `1px solid color-mix(in srgb, ${C.blue} 22%, ${C.border})`,
              backgroundColor: C.card,
              borderLeft: `3px solid ${C.blue}`,
              boxShadow: `0 1px 3px rgba(0,0,0,0.04)`,
            }}
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{
                borderColor: C.border,
                backgroundColor: `color-mix(in srgb, ${C.blue} 5%, ${C.bg})`,
              }}>
              <span className="inline-flex items-center justify-center rounded-md shrink-0"
                style={{
                  width: 20, height: 20,
                  backgroundColor: `color-mix(in srgb, ${C.blue} 18%, transparent)`,
                  color: C.blue,
                }}>
                <ListOrdered size={11} />
              </span>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.blue }}>
                {t("flows.section.sequence")}
              </p>
            </div>
            {group.steps.length === 0 ? (
              <p className="text-[11px] px-4 py-4" style={{ color: C.textDim }}>
                {t("flows.section.noSequence")}
              </p>
            ) : (
              <div className="px-4 py-3 space-y-2">
                {group.steps.map((s) => {
                  const meta = channelMeta[s.channel] ?? channelMeta.email;
                  const Icon = meta.icon;
                  const isCR = s.idx === 0 && s.channel === "linkedin";
                  const stepLabel = isCR
                    ? t("flows.step.cr")
                    : meta.label;
                  return (
                    <div key={s.idx} className="flex items-center gap-2.5">
                      <span className="text-[10px] font-bold tabular-nums w-4 text-center shrink-0"
                        style={{ color: C.textDim }}>{s.idx + 1}</span>
                      <span className="inline-flex items-center justify-center rounded-md shrink-0"
                        style={{
                          width: 22, height: 22,
                          backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                          color: meta.color,
                        }}>
                        <Icon size={11} />
                      </span>
                      <span className="text-[12px] font-semibold truncate flex-1"
                        style={{ color: C.textPrimary }}>
                        {stepLabel}
                      </span>
                      <span className="flex items-center gap-1.5 text-[10.5px] tabular-nums shrink-0"
                        style={{ color: C.textMuted }}>
                        <span className="font-bold" style={{ color: s.sent > 0 ? C.green : C.textDim }}>
                          {s.sent}
                        </span>
                        <span style={{ color: C.textDim }}>{t("flows.step.sent")}</span>
                        {s.pending > 0 && (
                          <>
                            <span style={{ color: C.textDim }}>·</span>
                            <span className="font-bold" style={{ color: gold }}>{s.pending}</span>
                            <span style={{ color: C.textDim }}>{t("flows.step.pending")}</span>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
      )}
    </div>
  );
}

// Compact inline chip for the channel-breakdown strip. Solid variant for
// the win/lost terminal counts so they pop visually against the in-flight
// channel chips.
function MetricChip({ icon, label, value, color, solid }: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  color: string;
  solid?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: solid ? color : `color-mix(in srgb, ${color} 12%, transparent)`,
        color: solid ? "#fff" : color,
        border: solid ? "none" : `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
      }}
    >
      {icon}
      <span className="tabular-nums font-bold">{value}</span>
      <span className="opacity-90">{label}</span>
    </span>
  );
}

function LeaderboardRibbon({ groups, t }: { groups: CampaignGroup[]; t: Tr }) {
  if (groups.length < 2) return null;
  // Sort flows by conversion. Dormant flows (zero leads) fall to the end.
  const ranked = [...groups].sort((a, b) => {
    const aConv = a.totalLeads > 0 ? (a.totalPositive / a.totalLeads) * 100 : -1;
    const bConv = b.totalLeads > 0 ? (b.totalPositive / b.totalLeads) * 100 : -1;
    if (aConv !== bConv) return bConv - aConv;
    return b.totalPositive - a.totalPositive;
  });
  const top3 = ranked.slice(0, 3);
  const someActive = top3.some(g => g.totalLeads > 0 && g.totalPositive > 0);
  // Medal palette — gold/silver/bronze. Dormant flows use textDim.
  const medalColors = ["#D4AF37", "#9CA3AF", "#A0522D"];
  if (!someActive) {
    return (
      <div className="rounded-lg border px-3 py-2 text-[11px] italic"
        style={{ backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)`, borderColor: C.border, color: C.textMuted }}>
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] mr-2" style={{ color: gold, fontStyle: "normal" }}>
          {t("flows.podium.eyebrow")}
        </span>
        {t("flows.podium.empty")}
      </div>
    );
  }
  return (
    <div className="rounded-lg border px-3 py-2 flex items-center gap-3 flex-wrap"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 7%, transparent), transparent 80%)`,
        borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
      }}>
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: gold }}>
        <Trophy size={10} /> {t("flows.podium.eyebrow")}
      </span>
      {top3.map((g, idx) => {
        const conv = g.totalLeads > 0 ? Math.round((g.totalPositive / g.totalLeads) * 100) : 0;
        const isDormant = g.totalLeads === 0 || g.totalPositive === 0;
        const medal = isDormant ? C.textDim : medalColors[idx] ?? C.textDim;
        return (
          <span key={g.name} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px]"
            style={{
              backgroundColor: `color-mix(in srgb, ${medal} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${medal} 32%, transparent)`,
              color: C.textBody,
            }}>
            <span className="text-[10px] font-bold tabular-nums" style={{ color: medal }}>#{idx + 1}</span>
            <span className="font-semibold truncate max-w-[180px]" style={{ color: C.textPrimary }}>{g.name}</span>
            <span className="tabular-nums" style={{ color: isDormant ? C.textDim : medal }}>
              {isDormant ? t("flows.podium.dormant") : `${conv}%`}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function IcpSectionBlock({ section, defaultOpen, t }: { section: IcpSection; defaultOpen: boolean; t: Tr }) {
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
        borderColor: `color-mix(in srgb, ${gold} 24%, ${C.border})`,
        boxShadow: "0 4px 18px rgba(0,0,0,0.07)",
      }}>
      {/* Lead Miner section header — dark navy + gold text so the ICP
          identity is unmistakable and visually distinct from the white
          flow rows underneath. Boss feedback 2026-05-28: "se tiene que
          distinguir bien, capaz la parte de lead miner la podes poner
          negra con las letras de oro no?" — yes. */}
      <div
        className="relative flex items-center gap-4 px-6 py-4"
        style={{
          background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
          borderBottom: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
        }}
      >
        {/* Hairline gold accent on the top edge — editorial detail */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${gold} 50%, transparent) 30%, color-mix(in srgb, ${gold} 50%, transparent) 70%, transparent 100%)` }} />

        {/* Click target for collapsing — covers everything except the
            Create-flow button on the right (which has its own action). */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="absolute inset-0 cursor-pointer"
          aria-label={`Toggle ${section.name}`}
        />

        {/* Icon disc */}
        <div className="relative w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
            boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 32%, transparent)`,
          }}>
          <Target size={18} style={{ color: N.ink }} strokeWidth={2.4} />
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.22em]" style={{ color: gold }}>{t("flows.preTitle")}</p>
            <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`,
                color: gold,
                border: `1px solid color-mix(in srgb, ${gold} 28%, transparent)`,
              }}>
              {section.groups.length} {section.groups.length === 1 ? t("flows.flows.single") : t("flows.flows.plural")}
            </span>
          </div>
          <h2 className="text-[18px] font-bold leading-tight truncate"
            style={{
              color: "white",
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
              letterSpacing: "-0.015em",
              textShadow: `0 1px 12px color-mix(in srgb, ${gold} 18%, transparent)`,
            }}>
            {section.name}
          </h2>
          {section.description && (
            <p className="text-[11px] truncate mt-0.5" style={{ color: "color-mix(in srgb, white 55%, transparent)" }}>{section.description}</p>
          )}
        </div>

        {/* Create New Flow CTA — sits between the title and the metrics
            (boss feedback 2026-05-28: "antes de los datos, más a la
            izquierda en el medio"). Bigger pill so it reads as the
            primary action of the section. */}
        {section.id && (
          <Link
            href={`/campaigns/new/${section.id}/pick`}
            onClick={(e) => e.stopPropagation()}
            className="relative inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-bold whitespace-nowrap transition-[opacity,transform] hover:opacity-90 hover:-translate-y-0.5 shrink-0"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
              color: N.ink,
              boxShadow: `0 6px 20px color-mix(in srgb, ${gold} 38%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
            }}
          >
            <Plus size={15} strokeWidth={2.8} /> {t("flows.createNew")}
          </Link>
        )}

        {/* Rolled-up metrics — on the dark surface, white numbers with
            gold/blue/green accents on the non-zero values. */}
        <div className="relative hidden md:flex items-center gap-5 shrink-0 mr-3">
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "color-mix(in srgb, white 50%, transparent)" }}>{t("flows.metric.leads")}</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5" style={{ color: "white" }}>
              {section.totalLeads}
              {section.totalActive > 0 && (
                <span className="ml-1 text-[10px]" style={{ color: "#34D399" }}>({t("flows.activeCount").replace("{n}", String(section.totalActive))})</span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "color-mix(in srgb, white 50%, transparent)" }}>{t("flows.metric.replies")}</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5"
              style={{ color: section.totalReplies > 0 ? "#5B9CFF" : "white" }}>
              {section.totalReplies}
              <span className="ml-1 text-[10px]" style={{ color: "color-mix(in srgb, white 45%, transparent)" }}>({responseRate}%)</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "color-mix(in srgb, white 50%, transparent)" }}>{t("flows.metric.positive")}</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5"
              style={{ color: section.totalPositive > 0 ? "#34D399" : "white" }}>
              {section.totalPositive}
            </p>
          </div>
        </div>

        <ChevronDown size={18}
          className="relative shrink-0 transition-transform duration-200 pointer-events-none"
          style={{
            color: "color-mix(in srgb, white 60%, transparent)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            opacity: hydrated ? 1 : 0,
          }} />
      </div>

      {open && (
        <div className="p-5 space-y-3"
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, var(--c-bg, ${C.bg}) 95%, transparent) 0%, color-mix(in srgb, var(--c-bg, ${C.bg}) 85%, transparent) 100%)`,
          }}>
          {/* Within-ICP leaderboard ribbon (boss 2026-05-29): compact
              podium ranking the section's flows by conversion (positives /
              leads × 100). Top 3 with medal icons; dormant flows (0
              contacted) get a tag so they don't pretend to be #last. */}
          <LeaderboardRibbon groups={section.groups} t={t} />
          {section.groups.map(g => <FlowRow key={g.name} group={g} t={t} />)}
        </div>
      )}
    </section>
  );
}

export default function ActiveCampaignsView({ campaigns, icpMap }: { campaigns: Campaign[]; icpMap: Record<string, IcpProfile> }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");

  const allGroups = useMemo(() => groupCampaigns(campaigns), [campaigns]);
  const allSections = useMemo(() => buildIcpSections(allGroups, icpMap), [allGroups, icpMap]);

  // Client-side filter pass — search matches against flow name + ICP name +
  // seller name; status chip filters the flow row's rolled-up status.
  // Empty groups (ICPs with zero matching flows) get pruned.
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && statusFilter === "all") return allSections;
    return allSections
      .map(section => {
        const filteredGroups = section.groups.filter(g => {
          if (statusFilter !== "all" && g.status !== statusFilter) return false;
          if (!q) return true;
          const hay = `${g.name} ${section.name ?? ""} ${g.sellers.join(" ")}`.toLowerCase();
          return hay.includes(q);
        });
        if (filteredGroups.length === 0) return null;
        return { ...section, groups: filteredGroups };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [allSections, search, statusFilter]);

  if (allSections.length === 0) {
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
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("flows.empty.title")}</p>
        <p className="text-xs mt-1.5" style={{ color: C.textDim }}>{t("flows.empty.hint")}</p>
      </div>
    );
  }

  const chips: Array<{ key: "all" | "active" | "paused"; label: string }> = [
    { key: "all",    label: t("flows.statusChip.all") },
    { key: "active", label: t("flows.statusChip.active") },
    { key: "paused", label: t("flows.statusChip.paused") },
  ];

  return (
    <div className="space-y-4">
      {/* Search + status chip row (D) — sits above the accordion. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 flex-1 min-w-[240px] max-w-md"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("flows.search.placeholder")}
            className="bg-transparent text-sm outline-none flex-1"
            style={{ color: C.textPrimary }}
          />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          {chips.map(c => {
            const isActive = statusFilter === c.key;
            return (
              <button key={c.key} type="button" onClick={() => setStatusFilter(c.key)}
                className="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors"
                style={{
                  backgroundColor: isActive ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent",
                  color: isActive ? gold : C.textBody,
                  border: isActive ? `1px solid color-mix(in srgb, ${gold} 40%, transparent)` : "1px solid transparent",
                }}>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-2xl border py-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-medium" style={{ color: C.textBody }}>{t("flows.filter.noMatch")}</p>
        </div>
      ) : (
        sections.map((section, i) => (
          <IcpSectionBlock key={section.id ?? "uncategorized"} section={section} defaultOpen={i === 0} t={t} />
        ))
      )}
    </div>
  );
}
