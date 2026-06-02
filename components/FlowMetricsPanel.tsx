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
export type LeadActivity = {
  id: string; name: string; company: string | null; channels: string[];
  inviteSent: boolean; accepted: boolean; messaged: number; replied: string | null; bounced: boolean;
  status: string; lastActivity: string | null;
};
export type FlowMetrics = {
  leadsActivity: LeadActivity[];
  totalLeads: number;
  invitesSent: number; accepted: number; messaged: number; replied: number; positive: number;
  acceptRate: number; messagedRate: number; replyRate: number; positiveRate: number; progressPct: number;
  pendingAccept: number; lost: number;
  statusDist: { active: number; paused: number; completed: number; cancelled: number };
  steps: {
    label: string; channel: string; sent: number; failed: number; skipped: number; pending: number;
    leads: { sent: DrillLead[]; failed: DrillLead[]; skipped: DrillLead[]; pending: DrillLead[] };
  }[];
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
  const [stepOpen, setStepOpen] = useState<number | null>(null);
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

        {/* per-channel + reply/status context */}
        <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: C.border }}>
          {m.linkedin && <ChannelRow ch="linkedin" stats={[["invites", m.linkedin.invitesSent], ["accepted", `${m.linkedin.accepted} (${m.linkedin.acceptRate}%)`], ["pending", m.linkedin.pendingAccept], ["DMs", m.linkedin.dmsSent], ["replies", m.linkedin.replies], ["failed", m.linkedin.failed]]} />}
          {m.email && <ChannelRow ch="email" danger={m.email.bounced > 0} stats={[["sent", m.email.sent], ["bounced", `${m.email.bounced} (${m.email.bounceRate}%)`], ["replies", m.email.replies]]} />}
          {m.call && <ChannelRow ch="call" stats={[["dialed", m.call.dialed]]} />}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider mr-1 self-center" style={{ color: C.textDim }}>Replies</span>
          <Tag label="positive" n={m.replyBreakdown.positive} color={C.green} />
          <Tag label="question" n={m.replyBreakdown.question} color="#0EA5E9" />
          <Tag label="negative" n={m.replyBreakdown.negative} color={C.red} />
          <Tag label="other" n={m.replyBreakdown.other} color={C.textMuted} />
          <span className="text-[10px] font-bold uppercase tracking-wider mx-1 self-center" style={{ color: C.textDim }}>Status</span>
          <Tag label="active" n={m.statusDist.active} color="#16A34A" />
          <Tag label="paused" n={m.statusDist.paused} color="#D97706" />
          <Tag label="completed" n={m.statusDist.completed} color={C.textMuted} />
          <Tag label="cancelled" n={m.statusDist.cancelled} color={C.textDim} />
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

      {/* ── STEP-BY-STEP ── */}
      <Section title="Step-by-step" right={<span className="text-[10px]" style={{ color: C.textDim }}>click a step → leads</span>}>
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 text-[10px] font-bold uppercase tracking-wider pb-1" style={{ color: C.textDim }}>
              <span>Step</span><span className="text-right w-10">Sent</span><span className="text-right w-10">Fail</span><span className="text-right w-10">Skip</span><span className="text-right w-12">Pend.</span>
            </div>
            {m.steps.map((s, i) => {
              const meta = CH[s.channel] ?? { label: s.channel, color: C.textMuted };
              const total = s.sent + s.failed + s.skipped + s.pending;
              const expanded = stepOpen === i;
              return (
                <div key={i}>
                  <button type="button" onClick={() => setStepOpen(o => (o === i ? null : i))}
                    className="w-full grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-sm py-1 rounded transition-colors"
                    style={{ backgroundColor: expanded ? `color-mix(in srgb, ${meta.color} 7%, transparent)` : "transparent" }}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ChevronRight size={12} style={{ color: C.textDim, transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
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
                  </button>
                  {expanded && (
                    <div className="ml-5 mb-2 mt-1 rounded-lg border divide-y" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <StepBucket label="Sent" leads={s.leads.sent} color={C.green} />
                      <StepBucket label="Failed" leads={s.leads.failed} color={C.red} showDetail />
                      <StepBucket label="Skipped" leads={s.leads.skipped} color={C.textMuted} showDetail />
                      <StepBucket label="Pending" leads={s.leads.pending} color="#0A66C2" showDetail />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

      {/* ── LEADS ACTIVITY ── */}
      <LeadsActivityTable rows={m.leadsActivity} />

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

function LeadsActivityTable({ rows }: { rows: LeadActivity[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "accepted" | "replied" | "pending" | "bounced">("all");
  const fmt = (s: string | null) => {
    if (!s) return "—";
    try { const d = new Date(s); return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; }
  };
  const replyColor: Record<string, string> = { positive: C.green, question: "#0EA5E9", negative: C.red, other: C.textMuted };
  const filtered = rows.filter(r => {
    if (q.trim()) { const s = q.trim().toLowerCase(); if (!`${r.name} ${r.company ?? ""}`.toLowerCase().includes(s)) return false; }
    if (filter === "accepted") return r.accepted;
    if (filter === "replied") return !!r.replied;
    if (filter === "pending") return r.inviteSent && !r.accepted;
    if (filter === "bounced") return r.bounced;
    return true;
  });

  return (
    <div className="rounded-xl border" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: C.border }}>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>Leads activity · {filtered.length}</span>
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "accepted", "replied", "pending", "bounced"] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors"
              style={{ borderColor: filter === f ? gold : C.border, color: filter === f ? gold : C.textMuted, backgroundColor: filter === f ? `color-mix(in srgb, ${gold} 8%, transparent)` : "transparent" }}>{f}</button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / company…"
            className="text-xs rounded-lg border px-2.5 py-1 outline-none w-48" style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textPrimary }} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="max-h-[420px] overflow-y-auto min-w-[640px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ backgroundColor: C.bg }}>
              <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
                <th className="text-left px-4 py-2">Lead</th>
                <th className="text-left px-2 py-2">Channels</th>
                <th className="text-center px-2 py-2">Invite</th>
                <th className="text-center px-2 py-2">Accepted</th>
                <th className="text-center px-2 py-2">Msgs</th>
                <th className="text-left px-2 py-2">Replied</th>
                <th className="text-left px-2 py-2">Status</th>
                <th className="text-left px-3 py-2">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-xs" style={{ color: C.textDim }}>No leads match.</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-t" style={{ borderColor: C.border }}>
                  <td className="px-4 py-2 max-w-[220px]">
                    <Link href={`/leads/${r.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{r.name}</Link>
                    {r.company && <div className="text-[11px] truncate" style={{ color: C.textMuted }}>{r.company}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      {r.channels.map(c => { const meta = CH[c]; return meta ? <meta.Icon key={c} size={12} style={{ color: meta.color }} /> : null; })}
                    </div>
                  </td>
                  <td className="text-center px-2 py-2" style={{ color: r.inviteSent ? C.green : C.textDim }}>{r.inviteSent ? "✓" : "—"}</td>
                  <td className="text-center px-2 py-2" style={{ color: r.accepted ? C.green : C.textDim }}>{r.accepted ? "✓" : "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums" style={{ color: r.messaged ? C.textBody : C.textDim }}>{r.messaged || "—"}</td>
                  <td className="px-2 py-2">
                    {r.replied
                      ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: replyColor[r.replied] ?? C.textMuted, backgroundColor: `color-mix(in srgb, ${replyColor[r.replied] ?? C.textMuted} 12%, transparent)` }}>{r.replied}</span>
                      : <span style={{ color: C.textDim }}>—</span>}
                    {r.bounced && <span className="text-[11px] font-semibold ml-1" style={{ color: C.red }}>bounced</span>}
                  </td>
                  <td className="px-2 py-2 text-xs" style={{ color: C.textMuted }}>{r.status}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: C.textMuted }}>{fmt(r.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StepBucket({ label, leads, color, showDetail }: { label: string; leads: DrillLead[]; color: string; showDetail?: boolean }) {
  const [o, setO] = useState(false);
  if (leads.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setO(v => !v)} className="w-full flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-bold" style={{ color }}>{leads.length} {label}</span>
        <ChevronRight size={11} style={{ color: C.textDim, transform: o ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
      </button>
      {o && (
        <div className="max-h-48 overflow-y-auto">
          {leads.map((d, i) => (
            <div key={d.id + i} className="flex items-center justify-between gap-2 px-3 py-1 border-t" style={{ borderColor: C.border }}>
              <Link href={`/leads/${d.id}`} className="text-xs font-medium hover:underline truncate" style={{ color: C.textPrimary }}>{d.name}{d.company ? ` · ${d.company}` : ""}</Link>
              {showDetail && d.detail && <span className="text-[10px] shrink-0 text-right max-w-[55%] truncate" style={{ color }} title={d.detail}>{d.detail}</span>}
            </div>
          ))}
        </div>
      )}
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
