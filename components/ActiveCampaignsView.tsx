"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Share2, Mail, Phone, BarChart3, Clock, Target, ChevronDown, Users, ChevronRight } from "lucide-react";

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

function FlowRow({ group, t }: { group: CampaignGroup; t: Tr }) {
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
          </div>
        </div>

        {/* Status section — funnel + sequence side-by-side. Boss feedback
            2026-05-28: the seller has to read the whole flow head-to-toe.
            Left = funnel drop-off (where the cohort is dying); right =
            per-step status (what's firing right now in the sequence,
            broken down by channel). Stacks on mobile. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ── Funnel ─────────────────────────────────────────── */}
          <div className="rounded-xl border p-4"
            style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.textDim }}>
              {t("flows.section.funnel")}
            </p>
            <div className="space-y-2">
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
          <div className="rounded-xl border p-4"
            style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.textDim }}>
              {t("flows.section.sequence")}
            </p>
            {group.steps.length === 0 ? (
              <p className="text-[11px] py-2" style={{ color: C.textDim }}>
                {t("flows.section.noSequence")}
              </p>
            ) : (
              <div className="space-y-2">
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
    </Link>
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
            <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: gold, letterSpacing: "0.14em" }}>{t("flows.preTitle")}</p>
            <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {section.groups.length} {section.groups.length === 1 ? t("flows.flows.single") : t("flows.flows.plural")}
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
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("flows.metric.leads")}</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5" style={{ color: C.textPrimary }}>
              {section.totalLeads}
              {section.totalActive > 0 && (
                <span className="ml-1 text-[10px]" style={{ color: C.green }}>({t("flows.activeCount").replace("{n}", String(section.totalActive))})</span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("flows.metric.replies")}</p>
            <p className="text-base font-bold tabular-nums leading-none mt-0.5"
              style={{ color: section.totalReplies > 0 ? C.blue : C.textPrimary }}>
              {section.totalReplies}
              <span className="ml-1 text-[10px]" style={{ color: C.textDim }}>({responseRate}%)</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("flows.metric.positive")}</p>
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
          {section.groups.map(g => <FlowRow key={g.name} group={g} t={t} />)}
        </div>
      )}
    </section>
  );
}

export default function ActiveCampaignsView({ campaigns, icpMap }: { campaigns: Campaign[]; icpMap: Record<string, IcpProfile> }) {
  const { t } = useLocale();
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
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("flows.empty.title")}</p>
        <p className="text-xs mt-1.5" style={{ color: C.textDim }}>{t("flows.empty.hint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((section, i) => (
        <IcpSectionBlock key={section.id ?? "uncategorized"} section={section} defaultOpen={i === 0} t={t} />
      ))}
    </div>
  );
}
