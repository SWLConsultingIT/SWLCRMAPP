"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Users, Send, UserCheck, MessageSquare, Trophy, TrendingUp, AlertTriangle,
  Share2, Mail, Phone, Clock, ChevronRight, XCircle, Hourglass,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

export type DrillLead = { id: string; name: string; company: string | null; detail?: string };
export type FlowMetrics = {
  totalLeads: number;
  invitesSent: number; accepted: number; messaged: number; replied: number; positive: number;
  acceptRate: number; messagedRate: number; replyRate: number; positiveRate: number; progressPct: number;
  pendingAccept: number; lost: number;
  statusDist: { active: number; paused: number; completed: number; cancelled: number };
  steps: { label: string; channel: string; sent: number; failed: number; skipped: number; pending: number }[];
  linkedin: { invitesSent: number; accepted: number; acceptRate: number; pendingAccept: number; dmsSent: number; replies: number; failed: number } | null;
  email: { sent: number; bounced: number; bounceRate: number; replies: number } | null;
  call: { dialed: number } | null;
  failureReasons: { reason: string; count: number }[];
  replyBreakdown: { positive: number; negative: number; question: number; other: number };
  drill: { accepted: DrillLead[]; messaged: DrillLead[]; pendingAccept: DrillLead[]; replied: DrillLead[]; positive: DrillLead[]; bounced: DrillLead[]; failed: DrillLead[] };
};
type DrillKey = keyof FlowMetrics["drill"];

const CH = {
  linkedin: { label: "LinkedIn", color: "#0A66C2", Icon: Share2 },
  email: { label: "Email", color: "#8B5CF6", Icon: Mail },
  call: { label: "Call", color: "#F97316", Icon: Phone },
  whatsapp: { label: "WhatsApp", color: "#16A34A", Icon: MessageSquare },
} as Record<string, { label: string; color: string; Icon: typeof Mail }>;

export default function FlowMetricsPanel({ metrics: m }: { metrics: FlowMetrics }) {
  const [open, setOpen] = useState<DrillKey | null>(null);
  const toggle = (k: DrillKey) => setOpen(o => (o === k ? null : k));
  const has = (k: DrillKey) => (m.drill[k]?.length ?? 0) > 0;

  const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="rounded-xl border" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{title}</span>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );

  // Funnel stage tile — big number, optional conversion %, optional drill.
  const Stage = ({ icon: Icon, label, value, rate, rateLabel, color, drill }: {
    icon: typeof Mail; label: string; value: number; rate?: number; rateLabel?: string; color: string; drill?: DrillKey;
  }) => {
    const clickable = !!drill && has(drill);
    return (
      <button type="button" disabled={!clickable} onClick={() => clickable && toggle(drill!)}
        className="flex-1 min-w-[120px] text-left px-3.5 py-3 rounded-xl border transition-colors disabled:cursor-default"
        style={{
          backgroundColor: open === drill ? `color-mix(in srgb, ${color} 9%, ${C.card})` : C.card,
          borderColor: open === drill ? color : C.border, cursor: clickable ? "pointer" : "default",
        }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Icon size={12} style={{ color }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[24px] font-bold leading-none tabular-nums" style={{ color: C.textPrimary }}>{value}</span>
          {rate != null && <span className="text-[11px] font-semibold" style={{ color }}>{rate}% {rateLabel}</span>}
        </div>
        {clickable && <span className="text-[9px] flex items-center gap-0.5 mt-0.5" style={{ color: C.textDim }}>view {m.drill[drill!].length} <ChevronRight size={9} /></span>}
      </button>
    );
  };

  const stepMax = Math.max(1, ...m.steps.map(s => s.sent + s.failed + s.skipped + s.pending));

  return (
    <div className="space-y-4">
      {/* ── FUNNEL ── */}
      <Section title="Outreach funnel">
        <div className="flex items-stretch gap-1.5 flex-wrap">
          <Stage icon={Users} label="Leads" value={m.totalLeads} color={gold} />
          <Arrow />
          <Stage icon={Send} label="Invites sent" value={m.invitesSent} color="#0A66C2" />
          <Arrow rate={m.acceptRate} />
          <Stage icon={UserCheck} label="Accepted" value={m.accepted} rate={m.acceptRate} rateLabel="of sent" color="#16A34A" drill="accepted" />
          <Arrow rate={m.messagedRate} />
          <Stage icon={MessageSquare} label="Messaged" value={m.messaged} rate={m.messagedRate} rateLabel="of acc." color="#0EA5E9" drill="messaged" />
          <Arrow rate={m.replyRate} />
          <Stage icon={MessageSquare} label="Replied" value={m.replied} rate={m.replyRate} rateLabel="of msg." color="#8B5CF6" drill="replied" />
          <Arrow rate={m.positiveRate} />
          <Stage icon={Trophy} label="Positive" value={m.positive} rate={m.positiveRate} rateLabel="of repl." color="#D97706" drill="positive" />
        </div>
        {/* secondary chips */}
        <div className="flex flex-wrap gap-2 mt-3">
          <MiniChip icon={Hourglass} label="awaiting acceptance" n={m.pendingAccept} color="#D97706" active={open === "pendingAccept"} onClick={() => has("pendingAccept") && toggle("pendingAccept")} clickable={has("pendingAccept")} />
          <MiniChip icon={TrendingUp} label="progress" n={`${m.progressPct}%`} color={gold as string} />
          <MiniChip icon={XCircle} label="lost" n={m.lost} color={C.red} />
        </div>
      </Section>

      {/* shared drill-down list */}
      {open && (
        <div className="rounded-xl border max-h-72 overflow-y-auto" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <div className="px-4 py-2 border-b sticky top-0" style={{ borderColor: C.border, backgroundColor: C.card }}>
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: gold }}>{open} · {m.drill[open]?.length ?? 0}</span>
          </div>
          {(m.drill[open] ?? []).length === 0
            ? <p className="px-4 py-3 text-xs" style={{ color: C.textDim }}>None</p>
            : (m.drill[open] ?? []).map((d, i) => (
              <div key={d.id + i} className="flex items-center justify-between gap-3 px-4 py-2 border-b last:border-b-0" style={{ borderColor: C.border }}>
                <div className="min-w-0">
                  <Link href={`/leads/${d.id}`} className="text-sm font-medium hover:underline" style={{ color: C.textPrimary }}>{d.name}</Link>
                  {d.company && <span className="text-xs" style={{ color: C.textMuted }}> · {d.company}</span>}
                </div>
                {d.detail && <span className="text-[11px] shrink-0 font-medium" style={{ color: open === "bounced" || open === "failed" ? C.red : open === "positive" || d.detail === "positive" ? C.green : C.textDim }}>{d.detail}</span>}
              </div>
            ))}
        </div>
      )}

      {/* ── TWO-COLUMN: step table + channels/issues ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Step-by-step */}
        <Section title="Step-by-step">
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 text-[10px] font-bold uppercase tracking-wider pb-1" style={{ color: C.textDim }}>
              <span>Step</span><span className="text-right w-10">Sent</span><span className="text-right w-10">Fail</span><span className="text-right w-10">Skip</span><span className="text-right w-12">Pend.</span>
            </div>
            {m.steps.map((s, i) => {
              const meta = CH[s.channel] ?? { label: s.channel, color: C.textMuted };
              const total = s.sent + s.failed + s.skipped + s.pending;
              return (
                <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-sm">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                    <span className="font-medium truncate" style={{ color: C.textBody }}>{s.label}</span>
                    <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{meta.label}</span>
                    <div className="flex-1 h-1 rounded ml-1" style={{ backgroundColor: C.border }}>
                      <div className="h-1 rounded" style={{ width: `${(total / stepMax) * 100}%`, backgroundColor: meta.color }} />
                    </div>
                  </div>
                  <span className="text-right w-10 tabular-nums font-semibold" style={{ color: C.textPrimary }}>{s.sent}</span>
                  <span className="text-right w-10 tabular-nums" style={{ color: s.failed ? C.red : C.textDim }}>{s.failed}</span>
                  <span className="text-right w-10 tabular-nums" style={{ color: C.textDim }}>{s.skipped}</span>
                  <span className="text-right w-12 tabular-nums" style={{ color: s.pending ? "#0A66C2" : C.textDim }}>{s.pending}</span>
                </div>
              );
            })}
          </div>
        </Section>

        <div className="space-y-4">
          {/* Per-channel */}
          <Section title="By channel">
            <div className="space-y-2">
              {m.linkedin && <ChannelRow ch="linkedin" stats={[["invites", m.linkedin.invitesSent], ["accepted", `${m.linkedin.accepted} (${m.linkedin.acceptRate}%)`], ["pending", m.linkedin.pendingAccept], ["DMs", m.linkedin.dmsSent], ["replies", m.linkedin.replies], ["failed", m.linkedin.failed]]} />}
              {m.email && <ChannelRow ch="email" danger={m.email.bounced > 0} stats={[["sent", m.email.sent], ["bounced", `${m.email.bounced} (${m.email.bounceRate}%)`], ["replies", m.email.replies]]} />}
              {m.call && <ChannelRow ch="call" stats={[["dialed", m.call.dialed]]} />}
            </div>
          </Section>

          {/* Reply breakdown + lead status */}
          <Section title="Replies & status">
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Tag label="positive" n={m.replyBreakdown.positive} color={C.green} />
              <Tag label="question" n={m.replyBreakdown.question} color="#0EA5E9" />
              <Tag label="negative" n={m.replyBreakdown.negative} color={C.red} />
              <Tag label="other" n={m.replyBreakdown.other} color={C.textMuted} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Tag label="active" n={m.statusDist.active} color="#16A34A" />
              <Tag label="paused" n={m.statusDist.paused} color="#D97706" />
              <Tag label="completed" n={m.statusDist.completed} color={C.textMuted} />
              <Tag label="cancelled" n={m.statusDist.cancelled} color={C.textDim} />
            </div>
          </Section>
        </div>
      </div>

      {/* ── ISSUES / FAILURES ── */}
      <Section
        title="Issues"
        right={<span className="text-[11px] font-semibold" style={{ color: (m.failureReasons.length || m.email?.bounced) ? C.red : C.textDim }}>
          {m.steps.reduce((a, s) => a + s.failed, 0)} failed · {m.email?.bounced ?? 0} bounced
        </span>}
      >
        <div className="flex flex-wrap items-start gap-4">
          {/* failure reasons */}
          <div className="min-w-[200px]">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>Failure reasons</p>
            {m.failureReasons.length === 0 ? (
              <p className="text-xs" style={{ color: C.textDim }}>No failed steps 🎉</p>
            ) : (
              <div className="space-y-1">
                {m.failureReasons.map(f => (
                  <div key={f.reason} className="flex items-center justify-between gap-3 text-sm">
                    <span style={{ color: C.textBody }}>{f.reason}</span>
                    <span className="tabular-nums font-semibold" style={{ color: C.red }}>{f.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* drill chips */}
          <div className="flex flex-wrap gap-1.5">
            <MiniChip icon={AlertTriangle} label="failed steps" n={m.steps.reduce((a, s) => a + s.failed, 0)} color={C.red} active={open === "failed"} onClick={() => has("failed") && toggle("failed")} clickable={has("failed")} />
            <MiniChip icon={Mail} label="bounced" n={m.email?.bounced ?? 0} color={C.red} active={open === "bounced"} onClick={() => has("bounced") && toggle("bounced")} clickable={has("bounced")} />
            <MiniChip icon={Hourglass} label="awaiting accept" n={m.pendingAccept} color="#D97706" active={open === "pendingAccept"} onClick={() => has("pendingAccept") && toggle("pendingAccept")} clickable={has("pendingAccept")} />
          </div>
        </div>
      </Section>
    </div>
  );
}

function Arrow({ rate }: { rate?: number }) {
  return (
    <div className="flex flex-col items-center justify-center shrink-0 px-0.5">
      <ChevronRight size={16} style={{ color: C.textDim }} />
      {rate != null && <span className="text-[9px] font-bold tabular-nums" style={{ color: C.textMuted }}>{rate}%</span>}
    </div>
  );
}

function ChannelRow({ ch, stats, danger }: { ch: string; stats: [string, string | number][]; danger?: boolean }) {
  const meta = CH[ch] ?? { label: ch, color: "#888", Icon: Mail };
  const Icon = meta.Icon;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2" style={{ borderColor: danger ? `color-mix(in srgb, ${C.red} 45%, ${C.border})` : C.border, backgroundColor: C.bg }}>
      <Icon size={14} style={{ color: meta.color }} />
      <span className="text-xs font-bold w-16 shrink-0" style={{ color: C.textPrimary }}>{meta.label}</span>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" style={{ color: C.textMuted }}>
        {stats.map(([k, v]) => (
          <span key={k}><span className="font-bold tabular-nums" style={{ color: C.textBody }}>{v}</span> {k}</span>
        ))}
      </div>
    </div>
  );
}

function Tag({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border"
      style={{ borderColor: n ? `color-mix(in srgb, ${color} 40%, transparent)` : C.border, color: n ? color : C.textDim, backgroundColor: n ? `color-mix(in srgb, ${color} 8%, transparent)` : "transparent" }}>
      <span className="font-bold tabular-nums">{n}</span> {label}
    </span>
  );
}

function MiniChip({ icon: Icon, label, n, color, active, onClick, clickable }: {
  icon: typeof Mail; label: string; n: number | string; color: string; active?: boolean; onClick?: () => void; clickable?: boolean;
}) {
  return (
    <button type="button" disabled={!clickable} onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border transition-colors disabled:cursor-default"
      style={{ borderColor: active ? color : C.border, color, backgroundColor: active ? `color-mix(in srgb, ${color} 10%, transparent)` : "transparent", cursor: clickable ? "pointer" : "default" }}>
      <Icon size={11} /> <span className="font-bold tabular-nums">{n}</span> {label}
    </button>
  );
}
