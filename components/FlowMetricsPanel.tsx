"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import { Users, Send, UserCheck, MessageSquare, Trophy, TrendingUp, AlertTriangle, Share2, Mail, Phone } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

export type DrillLead = { id: string; name: string; company: string | null; detail?: string };
export type FlowMetrics = {
  totalLeads: number;
  requestsSent: number; accepted: number; acceptRate: number;
  replied: number; replyRate: number; positive: number; progressPct: number;
  stepFunnel: { label: string; channel: string; reached: number }[];
  linkedin: { invitesSent: number; accepted: number; acceptRate: number; dmsSent: number; replies: number } | null;
  email: { sent: number; bounced: number; bounceRate: number; replies: number } | null;
  call: { dialed: number } | null;
  issues: { failed: number; bounced: number; parked: number };
  drill: { accepted: DrillLead[]; replied: DrillLead[]; bounced: DrillLead[]; failed: DrillLead[] };
};

const CH = {
  linkedin: { label: "LinkedIn", color: "#0A66C2", Icon: Share2 },
  email: { label: "Email", color: "#8B5CF6", Icon: Mail },
  call: { label: "Call", color: "#F97316", Icon: Phone },
  whatsapp: { label: "WhatsApp", color: "#16A34A", Icon: MessageSquare },
} as Record<string, { label: string; color: string; Icon: typeof Mail }>;

export default function FlowMetricsPanel({ metrics: m }: { metrics: FlowMetrics }) {
  const [open, setOpen] = useState<null | keyof FlowMetrics["drill"]>(null);
  const toggle = (k: keyof FlowMetrics["drill"]) => setOpen(o => (o === k ? null : k));

  const maxReached = Math.max(1, ...m.stepFunnel.map(s => s.reached));

  // KPI tile. `drill` makes it clickable to expand the matching name list.
  const Kpi = ({ icon: Icon, label, value, sub, color, drill }: {
    icon: typeof Mail; label: string; value: string | number; sub?: string; color: string; drill?: keyof FlowMetrics["drill"];
  }) => {
    const clickable = !!drill && (m.drill[drill]?.length ?? 0) > 0;
    return (
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && toggle(drill!)}
        className="text-left px-3.5 py-3 rounded-xl border transition-colors disabled:cursor-default"
        style={{
          backgroundColor: open === drill ? `color-mix(in srgb, ${color} 8%, ${C.card})` : C.card,
          borderColor: open === drill ? color : C.border,
          cursor: clickable ? "pointer" : "default",
        }}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <Icon size={12} style={{ color }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-bold leading-none tabular-nums" style={{ color: C.textPrimary }}>{value}</span>
          {sub && <span className="text-[11px] font-semibold" style={{ color }}>{sub}</span>}
        </div>
        {clickable && <span className="text-[9px]" style={{ color: C.textDim }}>{m.drill[drill!].length} · click to view</span>}
      </button>
    );
  };

  return (
    <div className="rounded-2xl border mb-6 overflow-hidden" style={{ backgroundColor: C.bg, borderColor: C.border }}>
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <TrendingUp size={14} style={{ color: gold }} />
        <span className="text-sm font-bold" style={{ color: C.textPrimary }}>Flow performance</span>
      </div>

      {/* Row 1 — funnel KPIs */}
      <div className="px-5 pt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Kpi icon={Users} label="Leads" value={m.totalLeads} color={gold} />
        <Kpi icon={Send} label="Requests" value={m.requestsSent} color="#0A66C2" />
        <Kpi icon={UserCheck} label="Accepted" value={m.accepted} sub={m.requestsSent ? `${m.acceptRate}%` : undefined} color="#16A34A" drill="accepted" />
        <Kpi icon={MessageSquare} label="Replied" value={m.replied} sub={m.totalLeads ? `${m.replyRate}%` : undefined} color="#8B5CF6" drill="replied" />
        <Kpi icon={Trophy} label="Positive" value={m.positive} color="#D97706" />
        <Kpi icon={TrendingUp} label="Progress" value={`${m.progressPct}%`} color={gold} />
      </div>

      {/* Drill-down list (accepted / replied / bounced / failed) */}
      {open && (
        <div className="mx-5 mt-3 rounded-lg border max-h-64 overflow-y-auto" style={{ borderColor: C.border, backgroundColor: C.card }}>
          {(m.drill[open] ?? []).length === 0 ? (
            <p className="px-4 py-3 text-xs" style={{ color: C.textDim }}>None</p>
          ) : (
            (m.drill[open] ?? []).map(d => (
              <div key={d.id + (d.detail ?? "")} className="flex items-center justify-between gap-3 px-4 py-2 border-b last:border-b-0" style={{ borderColor: C.border }}>
                <div className="min-w-0">
                  <Link href={`/leads/${d.id}`} className="text-sm font-medium hover:underline" style={{ color: C.textPrimary }}>{d.name}</Link>
                  {d.company && <span className="text-xs" style={{ color: C.textMuted }}> · {d.company}</span>}
                </div>
                {d.detail && <span className="text-[11px] shrink-0" style={{ color: open === "bounced" || open === "failed" ? C.red : C.textDim }}>{d.detail}</span>}
              </div>
            ))
          )}
        </div>
      )}

      {/* Row 2 — step funnel */}
      {m.stepFunnel.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>Step funnel</p>
          <div className="space-y-1.5">
            {m.stepFunnel.map((s, i) => {
              const meta = CH[s.channel] ?? { label: s.channel, color: C.textMuted };
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] w-14 shrink-0 font-medium" style={{ color: C.textBody }}>{s.label}</span>
                  <div className="flex-1 h-4 rounded" style={{ backgroundColor: C.border }}>
                    <div className="h-4 rounded flex items-center justify-end pr-1.5" style={{ width: `${Math.max(4, (s.reached / maxReached) * 100)}%`, backgroundColor: `color-mix(in srgb, ${meta.color} 75%, transparent)` }}>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: "#fff" }}>{s.reached}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Row 3 — per-channel breakdown */}
      <div className="px-5 pt-4 flex flex-wrap gap-2">
        {m.linkedin && (
          <ChannelChip ch="linkedin" stats={[["inv", m.linkedin.invitesSent], ["acc", `${m.linkedin.accepted} (${m.linkedin.acceptRate}%)`], ["DM", m.linkedin.dmsSent], ["reply", m.linkedin.replies]]} />
        )}
        {m.email && (
          <ChannelChip ch="email" stats={[["sent", m.email.sent], ["bounced", `${m.email.bounced} (${m.email.bounceRate}%)`], ["reply", m.email.replies]]} danger={m.email.bounced > 0} />
        )}
        {m.call && <ChannelChip ch="call" stats={[["dialed", m.call.dialed]]} />}
      </div>

      {/* Row 4 — issues */}
      <div className="px-5 py-4 mt-1 flex flex-wrap items-center gap-2">
        <AlertTriangle size={13} style={{ color: m.issues.failed || m.issues.bounced ? C.red : C.textDim }} />
        <IssueChip label="failed steps" n={m.issues.failed} drillKey="failed" open={open} onClick={() => m.issues.failed && toggle("failed")} danger />
        <IssueChip label="emails bounced" n={m.issues.bounced} drillKey="bounced" open={open} onClick={() => m.issues.bounced && toggle("bounced")} danger />
        <IssueChip label="awaiting acceptance" n={m.issues.parked} />
      </div>
    </div>
  );
}

function ChannelChip({ ch, stats, danger }: { ch: string; stats: [string, string | number][]; danger?: boolean }) {
  const meta = CH[ch] ?? { label: ch, color: "#888", Icon: Mail };
  const Icon = meta.Icon;
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: danger ? C.red : C.border, backgroundColor: C.card }}>
      <Icon size={13} style={{ color: meta.color }} />
      <span className="text-xs font-bold" style={{ color: C.textPrimary }}>{meta.label}</span>
      <span className="text-[11px]" style={{ color: C.textMuted }}>
        {stats.map(([k, v], i) => (
          <span key={k}>{i > 0 && " · "}{v} {k}</span>
        ))}
      </span>
    </div>
  );
}

function IssueChip({ label, n, drillKey, open, onClick, danger }: {
  label: string; n: number; drillKey?: keyof FlowMetrics["drill"]; open?: string | null; onClick?: () => void; danger?: boolean;
}) {
  const active = n > 0;
  const clickable = active && !!drillKey;
  const color = active && danger ? C.red : C.textMuted;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border transition-colors disabled:cursor-default"
      style={{
        borderColor: open === drillKey && active ? color : C.border,
        backgroundColor: active && danger ? `color-mix(in srgb, ${C.red} 8%, transparent)` : "transparent",
        color, cursor: clickable ? "pointer" : "default",
      }}
    >
      <span className="font-bold tabular-nums">{n}</span> {label}
    </button>
  );
}
