"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Users, Send, UserCheck, MessageSquare, Trophy, TrendingUp, AlertTriangle,
  Share2, Mail, Phone, ChevronRight, ChevronDown, XCircle, Hourglass, Search,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";
const OUTFIT = "var(--font-outfit), system-ui, sans-serif";

export type DrillLead = { id: string; name: string; company: string | null; detail?: string };
export type LeadActivity = {
  id: string; name: string; company: string | null; channels: string[];
  inviteSent: boolean; accepted: boolean; messaged: number; replied: string | null; replyText: string | null; bounced: boolean;
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

// Section wrapper with the app's gold "─ TITLE" header + premium card body.
function Section({ title, action, children, pad = true }: { title: string; action?: React.ReactNode; children: React.ReactNode; pad?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className="h-px w-5" style={{ backgroundColor: gold }} />
          <span className="text-[10px] font-bold uppercase" style={{ color: gold, letterSpacing: "0.16em" }}>{title}</span>
        </div>
        {action}
      </div>
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
        <div className={pad ? "p-4" : ""}>{children}</div>
      </div>
    </div>
  );
}

export default function FlowMetricsPanel({ metrics: m }: { metrics: FlowMetrics }) {
  const [open, setOpen] = useState<DrillKey | null>(null);
  const [stepOpen, setStepOpen] = useState<number | null>(null);
  const toggle = (k: DrillKey) => setOpen(o => (o === k ? null : k));
  const has = (k: DrillKey) => (m.drill[k]?.length ?? 0) > 0;

  // Funnel stages (top → bottom), with the conversion vs the previous stage.
  const stages: { key: string; label: string; value: number; icon: typeof Mail; color: string; drill: DrillKey | null; conv: number | null; convLabel: string }[] = [
    { key: "leads", label: "Leads", value: m.totalLeads, icon: Users, color: gold as string, drill: null, conv: null, convLabel: "" },
    { key: "invites", label: "Invites", value: m.invitesSent, icon: Send, color: "#0A66C2", drill: null, conv: m.totalLeads ? Math.round((m.invitesSent / m.totalLeads) * 100) : 0, convLabel: "invited" },
    { key: "accepted", label: "Accepted", value: m.accepted, icon: UserCheck, color: "#16A34A", drill: "accepted", conv: m.acceptRate, convLabel: "of invites" },
    { key: "messaged", label: "Messaged", value: m.messaged, icon: MessageSquare, color: "#0EA5E9", drill: "messaged", conv: m.messagedRate, convLabel: "of accepted" },
    { key: "replied", label: "Replied", value: m.replied, icon: MessageSquare, color: "#8B5CF6", drill: "replied", conv: m.replyRate, convLabel: "of messaged" },
    { key: "positive", label: "Positive", value: m.positive, icon: Trophy, color: "#D97706", drill: "positive", conv: m.positiveRate, convLabel: "of replied" },
  ];
  const maxV = Math.max(1, m.totalLeads, m.invitesSent);
  const stepMax = Math.max(1, ...m.steps.map(s => s.sent + s.failed + s.skipped + s.pending));

  return (
    <div className="space-y-5">
      {/* ── OUTREACH FUNNEL ── */}
      <Section title="Outreach funnel">
        <div className="space-y-0.5">
          {stages.map((s, i) => {
            const w = s.value > 0 ? Math.max(4, Math.round((s.value / maxV) * 100)) : 0;
            const Icon = s.icon;
            const clickable = !!s.drill && has(s.drill);
            const isOpen = open === s.drill;
            return (
              <Fragment key={s.key}>
                {i > 0 && s.conv != null && (
                  <div className="flex items-center gap-1.5 pl-[8.5rem] h-5">
                    <ChevronDown size={12} style={{ color: C.textDim }} />
                    <span className="text-[12px] font-bold tabular-nums" style={{ color: s.color }}>{s.conv}%</span>
                    <span className="text-[10px]" style={{ color: C.textDim }}>{s.convLabel}</span>
                  </div>
                )}
                <button
                  type="button" disabled={!clickable} onClick={() => clickable && toggle(s.drill!)}
                  className="w-full flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors disabled:cursor-default"
                  style={{ backgroundColor: isOpen ? `color-mix(in srgb, ${s.color} 8%, transparent)` : "transparent", cursor: clickable ? "pointer" : "default" }}
                >
                  <div className="flex items-center gap-2 w-32 shrink-0">
                    <Icon size={14} style={{ color: s.color }} />
                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: C.textMuted }}>{s.label}</span>
                  </div>
                  <div className="flex-1 h-7 rounded-md relative overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${C.border} 70%, transparent)` }}>
                    <div className="h-7 rounded-md transition-[width]" style={{ width: `${w}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${s.color} 85%, transparent), color-mix(in srgb, ${s.color} 60%, transparent))` }} />
                  </div>
                  <span className="text-[22px] font-bold tabular-nums w-14 text-right leading-none" style={{ color: s.value ? C.textPrimary : C.textDim, fontFamily: OUTFIT }}>{s.value}</span>
                  {clickable && <ChevronRight size={13} style={{ color: C.textDim, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />}
                  {!clickable && <span className="w-[13px] shrink-0" />}
                </button>
              </Fragment>
            );
          })}
        </div>

        {/* drill list (who) — opens inline under the funnel */}
        {open && (
          <div className="mt-3 rounded-xl border max-h-64 overflow-y-auto" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <div className="px-4 py-2 border-b sticky top-0 flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <span className="text-[11px] font-bold uppercase tracking-wider capitalize" style={{ color: gold }}>{open} · {m.drill[open]?.length ?? 0}</span>
              <button type="button" onClick={() => setOpen(null)}><XCircle size={14} style={{ color: C.textDim }} /></button>
            </div>
            {(m.drill[open] ?? []).length === 0
              ? <p className="px-4 py-3 text-xs" style={{ color: C.textDim }}>None</p>
              : (m.drill[open] ?? []).map((d, i) => (
                <div key={d.id + i} className="flex items-center justify-between gap-3 px-4 py-1.5 border-b last:border-b-0" style={{ borderColor: C.border }}>
                  <div className="min-w-0">
                    <Link href={`/leads/${d.id}`} className="text-sm font-medium hover:underline" style={{ color: C.textPrimary }}>{d.name}</Link>
                    {d.company && <span className="text-xs" style={{ color: C.textMuted }}> · {d.company}</span>}
                  </div>
                  {d.detail && <span className="text-[11px] shrink-0 font-medium" style={{ color: open === "bounced" || open === "failed" ? C.red : (open === "positive" || d.detail === "positive") ? C.green : C.textDim }}>{d.detail}</span>}
                </div>
              ))}
          </div>
        )}

        {/* secondary chips */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: C.border }}>
          <MiniChip icon={Hourglass} label="awaiting acceptance" n={m.pendingAccept} color="#D97706" active={open === "pendingAccept"} onClick={() => has("pendingAccept") && toggle("pendingAccept")} clickable={has("pendingAccept")} />
          <MiniChip icon={TrendingUp} label="progress" n={`${m.progressPct}%`} color={gold as string} />
          <MiniChip icon={XCircle} label="lost" n={m.lost} color={C.red} />
        </div>
      </Section>

      {/* ── BY CHANNEL ── */}
      <Section title="By channel" pad>
        <div className="flex flex-wrap gap-3">
          {m.linkedin && <ChannelCard ch="linkedin" stats={[["invites", m.linkedin.invitesSent], ["accepted", `${m.linkedin.accepted} · ${m.linkedin.acceptRate}%`], ["pending", m.linkedin.pendingAccept], ["DMs", m.linkedin.dmsSent], ["replies", m.linkedin.replies], ["failed", m.linkedin.failed]]} danger={m.linkedin.failed > 0} />}
          {m.email && <ChannelCard ch="email" stats={[["sent", m.email.sent], ["bounced", `${m.email.bounced} · ${m.email.bounceRate}%`], ["replies", m.email.replies]]} danger={m.email.bounced > 0} />}
          {m.call && <ChannelCard ch="call" stats={[["dialed", m.call.dialed]]} />}
        </div>
        <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-1.5" style={{ borderColor: C.border }}>
          <span className="text-[10px] font-bold uppercase tracking-wider mr-1" style={{ color: C.textDim }}>Replies</span>
          <Tag label="positive" n={m.replyBreakdown.positive} color={C.green} />
          <Tag label="question" n={m.replyBreakdown.question} color="#0EA5E9" />
          <Tag label="negative" n={m.replyBreakdown.negative} color={C.red} />
          <Tag label="other" n={m.replyBreakdown.other} color={C.textMuted} />
          <span className="text-[10px] font-bold uppercase tracking-wider mx-1" style={{ color: C.textDim }}>Status</span>
          <Tag label="active" n={m.statusDist.active} color="#16A34A" />
          <Tag label="paused" n={m.statusDist.paused} color="#D97706" />
          <Tag label="completed" n={m.statusDist.completed} color={C.textMuted} />
          <Tag label="cancelled" n={m.statusDist.cancelled} color={C.textDim} />
        </div>
      </Section>

      {/* ── STEP-BY-STEP ── */}
      <Section title="Step-by-step" action={<span className="text-[10px]" style={{ color: C.textDim }}>click a step → leads</span>}>
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 text-[10px] font-bold uppercase tracking-wider pb-1.5 mb-1 border-b" style={{ color: C.textDim, borderColor: C.border }}>
          <span>Step</span><span className="text-right w-10">Sent</span><span className="text-right w-10">Fail</span><span className="text-right w-10">Skip</span><span className="text-right w-12">Pend.</span>
        </div>
        <div className="space-y-0.5">
          {m.steps.map((s, i) => {
            const meta = CH[s.channel] ?? { label: s.channel, color: C.textMuted, Icon: Mail };
            const total = s.sent + s.failed + s.skipped + s.pending;
            const expanded = stepOpen === i;
            return (
              <div key={i}>
                <button type="button" onClick={() => setStepOpen(o => (o === i ? null : i))}
                  className="w-full grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-sm py-1.5 rounded-lg px-1 transition-colors"
                  style={{ backgroundColor: expanded ? `color-mix(in srgb, ${meta.color} 7%, transparent)` : "transparent" }}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight size={12} style={{ color: C.textDim, transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                    <span className="font-medium truncate" style={{ color: C.textBody }}>{s.label}</span>
                    <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{meta.label}</span>
                    <div className="flex-1 h-1.5 rounded ml-1" style={{ backgroundColor: `color-mix(in srgb, ${C.border} 70%, transparent)` }}>
                      <div className="h-1.5 rounded" style={{ width: `${(total / stepMax) * 100}%`, backgroundColor: meta.color }} />
                    </div>
                  </div>
                  <span className="text-right w-10 tabular-nums font-semibold" style={{ color: C.textPrimary, fontFamily: OUTFIT }}>{s.sent}</span>
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
                    {total === 0 && <p className="px-3 py-1.5 text-[11px]" style={{ color: C.textDim }}>Nothing yet on this step.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── LEADS ACTIVITY ── */}
      <LeadsActivityTable rows={m.leadsActivity} />

      {/* ── ISSUES ── */}
      <Section title="Issues" action={<span className="text-[11px] font-semibold" style={{ color: (m.steps.reduce((a, s) => a + s.failed, 0) || m.email?.bounced) ? C.red : C.textDim }}>{m.steps.reduce((a, s) => a + s.failed, 0)} failed · {m.email?.bounced ?? 0} bounced</span>}>
        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-[220px]">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textDim }}>Failure reasons</p>
            {m.failureReasons.length === 0 ? (
              <p className="text-xs" style={{ color: C.textDim }}>No failed steps — all clean. 🎉</p>
            ) : (
              <div className="space-y-1">
                {m.failureReasons.map(f => (
                  <div key={f.reason} className="flex items-center justify-between gap-3 text-sm">
                    <span style={{ color: C.textBody }}>{f.reason}</span>
                    <span className="tabular-nums font-bold" style={{ color: C.red, fontFamily: OUTFIT }}>{f.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
  const [openLead, setOpenLead] = useState<string | null>(null);
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
    <Section title="Leads activity" pad={false}
      action={<span className="text-[10px]" style={{ color: C.textDim }}>{filtered.length} of {rows.length}</span>}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "accepted", "replied", "pending", "bounced"] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border transition-colors capitalize"
              style={{ borderColor: filter === f ? gold : C.border, color: filter === f ? gold : C.textMuted, backgroundColor: filter === f ? `color-mix(in srgb, ${gold} 8%, transparent)` : "transparent" }}>{f}</button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.textDim }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / company…"
            className="text-xs rounded-lg border pl-7 pr-2.5 py-1.5 outline-none w-52" style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textPrimary }} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="max-h-[440px] overflow-y-auto min-w-[680px]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: C.bg, boxShadow: `inset 0 -1px 0 ${C.border}` }}>
              <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
                <th className="text-left px-4 py-2.5">Lead</th>
                <th className="text-left px-2 py-2.5">Channels</th>
                <th className="text-center px-2 py-2.5">Invite</th>
                <th className="text-center px-2 py-2.5">Accepted</th>
                <th className="text-center px-2 py-2.5">Msgs</th>
                <th className="text-left px-2 py-2.5">Replied</th>
                <th className="text-left px-2 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-xs" style={{ color: C.textDim }}>No leads match this filter.</td></tr>
              ) : filtered.map(r => {
                const rc = r.replied ? (replyColor[r.replied] ?? C.textMuted) : C.textMuted;
                const expanded = openLead === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-t transition-colors hover:bg-black/[0.02]" style={{ borderColor: C.border }}>
                      <td className="px-4 py-2 max-w-[220px]">
                        <Link href={`/leads/${r.id}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{r.name}</Link>
                        {r.company && <div className="text-[11px] truncate" style={{ color: C.textMuted }}>{r.company}</div>}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">{r.channels.map(c => { const meta = CH[c]; return meta ? <meta.Icon key={c} size={12} style={{ color: meta.color }} /> : null; })}</div>
                      </td>
                      <td className="text-center px-2 py-2" style={{ color: r.inviteSent ? C.green : C.textDim }}>{r.inviteSent ? "✓" : "—"}</td>
                      <td className="text-center px-2 py-2" style={{ color: r.accepted ? C.green : C.textDim }}>{r.accepted ? "✓" : "—"}</td>
                      <td className="text-center px-2 py-2 tabular-nums" style={{ color: r.messaged ? C.textBody : C.textDim }}>{r.messaged || "—"}</td>
                      <td className="px-2 py-2">
                        {r.replied
                          ? (r.replyText
                            ? <button type="button" onClick={() => setOpenLead(o => (o === r.id ? null : r.id))}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded capitalize"
                                style={{ color: rc, backgroundColor: `color-mix(in srgb, ${rc} 12%, transparent)` }}>
                                {r.replied} <ChevronRight size={10} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                              </button>
                            : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded capitalize" style={{ color: rc, backgroundColor: `color-mix(in srgb, ${rc} 12%, transparent)` }}>{r.replied}</span>)
                          : <span style={{ color: C.textDim }}>—</span>}
                        {r.bounced && <span className="text-[11px] font-semibold ml-1" style={{ color: C.red }}>bounced</span>}
                      </td>
                      <td className="px-2 py-2 text-xs capitalize" style={{ color: C.textMuted }}>{r.status}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: C.textMuted }}>{fmt(r.lastActivity)}</td>
                    </tr>
                    {expanded && r.replyText && (
                      <tr style={{ backgroundColor: C.bg }}>
                        <td colSpan={8} className="px-4 py-2.5">
                          <div className="rounded-lg border px-3 py-2" style={{ borderColor: `color-mix(in srgb, ${rc} 30%, ${C.border})`, backgroundColor: C.card }}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <MessageSquare size={11} style={{ color: rc }} />
                              <span className="text-[10px] font-bold uppercase tracking-wider capitalize" style={{ color: rc }}>{r.replied} reply</span>
                            </div>
                            <p className="text-xs whitespace-pre-wrap" style={{ color: C.textBody }}>{r.replyText}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
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

function ChannelCard({ ch, stats, danger }: { ch: string; stats: [string, string | number][]; danger?: boolean }) {
  const meta = CH[ch] ?? { label: ch, color: "#888", Icon: Mail };
  const Icon = meta.Icon;
  return (
    <div className="flex-1 min-w-[180px] rounded-xl border overflow-hidden" style={{ borderColor: danger ? `color-mix(in srgb, ${C.red} 35%, ${C.border})` : C.border, backgroundColor: C.bg }}>
      <div className="h-1" style={{ backgroundColor: meta.color }} />
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Icon size={14} style={{ color: meta.color }} />
          <span className="text-xs font-bold" style={{ color: C.textPrimary }}>{meta.label}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {stats.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1">
              <span className="text-[15px] font-bold tabular-nums" style={{ color: C.textPrimary, fontFamily: OUTFIT }}>{v}</span>
              <span className="text-[10px]" style={{ color: C.textMuted }}>{k}</span>
            </div>
          ))}
        </div>
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
