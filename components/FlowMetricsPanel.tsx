"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import {
  Users, Send, UserCheck, MessageSquare, Trophy, TrendingUp, AlertTriangle,
  Share2, Mail, Phone, ChevronRight, ChevronDown, XCircle, Hourglass, Search, Download,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";
const OUTFIT = "var(--font-outfit), system-ui, sans-serif";

export type DrillLead = { id: string; name: string; company: string | null; detail?: string };
export type LeadActivity = {
  id: string; name: string; company: string | null; channels: string[];
  inviteSent: boolean; accepted: boolean; messaged: number; replied: string | null; replyText: string | null; bounced: boolean;
  status: string; currentStep: number | null; daysInFlow: number | null; lastActivity: string | null;
};
export type FlowMetrics = {
  leadsActivity: LeadActivity[];
  velocity: { sentToday: number; dailyLimit: number | null; lastActivityAt: string | null; byDay: { date: string; sent: number; replies: number }[]; avgDaysToReply: number | null };
  cooldown: { until: string; channel: string } | null;
  totalLeads: number;
  invitesSent: number; accepted: number; messaged: number; replied: number; positive: number;
  contacted: number; contactedRate: number; contactedReplyRate: number;
  acceptRate: number; messagedRate: number; replyRate: number; positiveRate: number; progressPct: number;
  pendingAccept: number; lost: number;
  statusDist: { active: number; paused: number; completed: number; cancelled: number };
  steps: {
    label: string; channel: string; replies: number; replyRate: number; sent: number; failed: number; skipped: number; pending: number;
    leads: { sent: DrillLead[]; failed: DrillLead[]; skipped: DrillLead[]; pending: DrillLead[] };
  }[];
  linkedin: { invitesSent: number; accepted: number; acceptRate: number; pendingAccept: number; dmsSent: number; replies: number; positive: number; replyRate: number; positiveReplyRate: number; failed: number } | null;
  email: { sent: number; bounced: number; bounceRate: number; replies: number; positive: number; replyRate: number; positiveReplyRate: number } | null;
  call: { dialed: number } | null;
  failureReasons: { reason: string; count: number }[];
  replyBreakdown: { positive: number; negative: number; question: number; followup: number; other: number };
  drill: { contacted: DrillLead[]; accepted: DrillLead[]; messaged: DrillLead[]; pendingAccept: DrillLead[]; replied: DrillLead[]; positive: DrillLead[]; bounced: DrillLead[]; failed: DrillLead[] };
  // ── Flow Metrics redesign (2026-08-27): unique-lead outcomes, call stage,
  // pipeline distribution, per-seller. UI consumes these in the next increment. ──
  meetings: number; meetingRate: number; positiveLeadRate: number;
  callStage: { made: number; connected: number; connectRate: number; positiveOutcomes: number; meetings: number; meetingConversion: number; groups: Record<string, number>; outcomes: Record<string, number> } | null;
  pipeline: { inLinkedin: number; inEmail: number; inCall: number; repliedExited: number; completedNoResponse: number; removed: number; failed: number; other: number };
  stageAging: Record<string, { active: number; stuckOver3d: number; avgDays: number | null; tracked: number }>;
  sellers: { sellerId: string; name: string; leads: number; contacted: number; linkedinSent: number; emailsSent: number; callsMade: number; callsConnected: number; replies: number; positiveReplies: number; positiveOutcomes: number; meetings: number; connectRate: number; positiveReplyRate: number; meetingsPer100: number; positivePer100: number }[];
  positivesByChannel: { linkedin: number; email: number };
  health: { bounceRate: FlowHealth; connectRate: FlowHealth; meetingConversion: FlowHealth; positiveReplyRate: FlowHealth };
  // Period-over-period vs the immediately-preceding equal window (only when a
  // bounded date range is active). Volume metrics carry `pct`, rate metrics `pp`.
  deltas?: FlowDeltas | null;
};
export type FlowHealth = "healthy" | "warning" | "critical";
export type FlowDeltas = {
  meetings?: { curr: number; prev: number; pct: number | null };
  positive?: { curr: number; prev: number; pct: number | null };
  positiveReplyRate?: { curr: number; prev: number; pp: number };
  connectRate?: { curr: number; prev: number; pp: number };
  replyRate?: { curr: number; prev: number; pp: number };
};
type DrillKey = keyof FlowMetrics["drill"];

// Channels are identified by their LOGO tinted with the SWL gold ramp (--fg*)
// — one gold spectrum instead of a per-channel rainbow (boss 2026-08). Dark→
// light: LinkedIn (deepest) · WhatsApp · Email · Call (lightest).
const CH = {
  linkedin: { label: "LinkedIn", color: "var(--fg1)", Icon: Share2 },
  email: { label: "Email", color: "var(--fg3)", Icon: Mail },
  call: { label: "Call", color: "var(--fg4)", Icon: Phone },
  whatsapp: { label: "WhatsApp", color: "var(--fg2)", Icon: MessageSquare },
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
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border2, backgroundColor: C.card, boxShadow: C.shadow }}>
        <div className={pad ? "p-4" : ""}>{children}</div>
      </div>
    </div>
  );
}

export default function FlowMetricsPanel({ metrics, sellers = [], filters, campaignId }: {
  metrics: FlowMetrics;
  sellers?: { id: string; name: string }[];
  filters?: { seller: string | null; range: string; from: string | null; to: string | null };
  campaignId?: string;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const sp = useSearchParams();
  // Filter changes recompute ONLY this section via /api/campaigns/[id]/flow-metrics
  // (no full-page rerender, no scroll loss). Previous data stays visible while
  // the new response loads; a request id guards against out-of-order responses.
  const [data, setData] = useState<FlowMetrics>(metrics);
  const [sel, setSel] = useState(() => ({ seller: filters?.seller ?? null, range: filters?.range ?? "all", from: filters?.from ?? "", to: filters?.to ?? "" }));
  const [updating, setUpdating] = useState(false);
  const reqIdRef = useRef(0);
  // Server-driven changes (deep-link / navigation) refresh the baseline data.
  useEffect(() => { setData(metrics); }, [metrics]);
  const m = data;
  const curRange = sel.range;
  const curSeller = sel.seller;
  const [cFrom, setCFrom] = useState(filters?.from ?? "");
  const [cTo, setCTo] = useState(filters?.to ?? "");

  async function applyFilters(patch: Partial<typeof sel>) {
    const next = { ...sel, ...patch };
    setSel(next);
    // Sync the URL (so a reload keeps the filter) WITHOUT a Next navigation —
    // history.replaceState won't re-run the server component.
    try {
      const usp = new URLSearchParams(sp.toString());
      usp.set("tab", "0");
      const url: Record<string, string> = {};
      if (next.seller) url.seller = next.seller;
      if (next.range !== "all") url.range = next.range;
      if (next.range === "custom") { if (next.from) url.from = next.from; if (next.to) url.to = next.to; }
      for (const k of ["seller", "range", "from", "to"]) url[k] ? usp.set(k, url[k]) : usp.delete(k);
      window.history.replaceState(null, "", `${pathname}?${usp.toString()}`);
    } catch { /* ignore */ }
    if (!campaignId) return;
    const rid = ++reqIdRef.current;
    setUpdating(true);
    const q = new URLSearchParams();
    if (next.seller) q.set("seller", next.seller);
    if (next.range !== "all") q.set("range", next.range);
    if (next.range === "custom") { if (next.from) q.set("from", next.from); if (next.to) q.set("to", next.to); }
    try {
      const r = await fetch(`/api/campaigns/${campaignId}/flow-metrics?${q.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (rid !== reqIdRef.current) return; // a newer selection already won
      if (j?.metrics) setData(j.metrics as FlowMetrics);
    } catch { /* keep previous data */ } finally {
      if (rid === reqIdRef.current) setUpdating(false);
    }
  }

  const [open, setOpen] = useState<DrillKey | null>(null);
  // Which section opened the drill, so the lead list renders RIGHT THERE
  // (under the funnel vs under Issues) instead of always jumping to the top.
  const [openFrom, setOpenFrom] = useState<"funnel" | "issues">("funnel");
  const [stepOpen, setStepOpen] = useState<number | null>(null);
  const toggle = (k: DrillKey, from: "funnel" | "issues" = "funnel") => {
    setOpen(o => (o === k && openFrom === from ? null : k));
    setOpenFrom(from);
  };
  const has = (k: DrillKey) => (m.drill[k]?.length ?? 0) > 0;

  // The shared drill-down list (who) — rendered under whichever section opened it.
  const drillPanel = open ? (
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
  ) : null;

  // Benchmark colour for a rate (higher = better). Signals good/ok/bad at a glance.
  const bench = (rate: number, hi: number, mid: number) => rate >= hi ? "#16A34A" : rate >= mid ? "#D97706" : C.red;
  // Funnel stages (top → bottom), with the conversion vs the previous stage.
  // benchT = [good, ok] thresholds for the conversion INTO this stage (when it's
  // a quality signal, not an operational one we fully control).
  // Channel-agnostic funnel (boss 2026-06-11): Leads → Contacted → Replied →
  // Positive. Works for any channel mix and stays monotonic. The LinkedIn-only
  // mechanics (invites sent / accepted) and the email mechanics live in the
  // "By channel" section below, where an accept-rate actually makes sense — in
  // a multichannel flow they don't belong in the headline funnel (that's what
  // produced "Messages 800% of accepted").
  const stages: { key: string; label: string; value: number; icon: typeof Mail; color: string; drill: DrillKey | null; conv: number | null; convLabel: string; benchT?: [number, number] }[] = [
    { key: "leads", label: "Leads", value: m.totalLeads, icon: Users, color: "var(--fg1)", drill: null, conv: null, convLabel: "" },
    { key: "contacted", label: "Contacted", value: m.contacted, icon: Send, color: "var(--fg2)", drill: "contacted", conv: m.contactedRate, convLabel: "of leads" },
    { key: "replied", label: "Replied", value: m.replied, icon: MessageSquare, color: "var(--fg3)", drill: "replied", conv: m.contactedReplyRate, convLabel: "of contacted", benchT: [10, 3] },
    { key: "positive", label: "Positive", value: m.positive, icon: Trophy, color: "var(--fg4)", drill: "positive", conv: m.positiveRate, convLabel: "of replied", benchT: [40, 20] },
  ];
  const maxV = Math.max(1, m.totalLeads, m.contacted);
  const stepMax = Math.max(1, ...m.steps.map(s => s.sent + s.failed + s.skipped + s.pending));

  const RANGES: { k: string; label: string }[] = [
    { k: "all", label: "All time" }, { k: "7d", label: "7 days" }, { k: "4w", label: "4 weeks" }, { k: "90d", label: "90 days" }, { k: "custom", label: "Custom" },
  ];
  return (
    <div className="space-y-5">
      {/* ── FILTERS — Seller (== LinkedIn profile) + Date range. Drive a
          server-side cohort recompute; whole narrative recalculates. ── */}
      <div className="flex flex-wrap items-center gap-2">
        {sellers.length > 1 && (
          <label className="inline-flex items-center gap-2 text-[12px] rounded-lg border px-3 py-1.5" style={{ borderColor: C.border2, backgroundColor: C.card }}>
            <span className="font-semibold uppercase tracking-wider text-[9px]" style={{ color: C.textDim }}>Seller</span>
            <select value={curSeller ?? ""} onChange={e => applyFilters({ seller: e.target.value || null })}
              className="bg-transparent outline-none font-semibold cursor-pointer" style={{ color: C.textBody }}>
              <option value="">All sellers</option>
              {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: C.border2, backgroundColor: C.card }}>
          {RANGES.map(r => {
            const on = curRange === r.k;
            return (
              <button key={r.k} type="button"
                onClick={() => r.k === "custom"
                  ? applyFilters({ range: "custom", from: cFrom, to: cTo })
                  : applyFilters({ range: r.k, from: "", to: "" })}
                className="text-[12px] font-semibold px-3 py-1 rounded-md transition-colors"
                style={{ backgroundColor: on ? `color-mix(in srgb, ${gold} 16%, transparent)` : "transparent", color: on ? "var(--fg1)" : C.textMuted }}>
                {r.label}
              </button>
            );
          })}
        </div>
        {curRange === "custom" && (
          <span className="inline-flex items-center gap-1.5">
            <input type="date" value={cFrom} onChange={e => setCFrom(e.target.value)} className="rounded-md border px-2 py-1 text-[11px] outline-none" style={{ borderColor: C.border2, backgroundColor: C.card, color: C.textBody }} />
            <span className="text-[11px]" style={{ color: C.textDim }}>→</span>
            <input type="date" value={cTo} onChange={e => setCTo(e.target.value)} className="rounded-md border px-2 py-1 text-[11px] outline-none" style={{ borderColor: C.border2, backgroundColor: C.card, color: C.textBody }} />
            <button type="button" disabled={!cFrom} onClick={() => cFrom && applyFilters({ range: "custom", from: cFrom, to: cTo })}
              className="text-[11px] font-bold px-2.5 py-1 rounded-md disabled:opacity-40" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1505" }}>Apply</button>
          </span>
        )}
        {updating && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--fg1)" }}>
            <span className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `color-mix(in srgb, ${gold} 60%, transparent)`, borderTopColor: "transparent" }} />
            Updating…
          </span>
        )}
        {!updating && curRange !== "all" && curRange !== "custom" && (
          <span className="text-[11px]" style={{ color: C.textDim }}>· cohort = leads started in period{curSeller ? " · seller-scoped" : ""}</span>
        )}
      </div>
      {/* Everything below the filter bar dims while a new cohort loads — the
          previous numbers stay readable, no flash, no layout jump. */}
      <div style={{ opacity: updating ? 0.5 : 1, transition: "opacity .18s", pointerEvents: updating ? "none" : "auto" }}>
      <div className="space-y-5">

      {m.totalLeads === 0 ? (
        /* Empty cohort — a filter (period / seller) matched no enrolled leads.
           One clean state instead of a dozen zero-filled modules / an empty bar. */
        <div className="rounded-2xl border flex flex-col items-center justify-center text-center px-6 py-16" style={{ borderColor: C.border2, backgroundColor: C.card, boxShadow: C.shadow }}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)` }}>
            <Search size={18} style={{ color: gold }} />
          </div>
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>No leads in this view</p>
          <p className="text-xs mt-1 max-w-xs" style={{ color: C.textMuted }}>
            No leads were enrolled in the selected period{curSeller ? " for this seller" : ""}. Adjust the filters above to see activity.
          </p>
        </div>
      ) : (
      <>

      {/* ── COOLDOWN BANNER ── */}
      {m.cooldown && (
        <div className="rounded-xl border px-4 py-2.5 flex items-center gap-2.5" style={{ borderColor: "color-mix(in srgb, #D97706 38%, transparent)", backgroundColor: "color-mix(in srgb, #D97706 8%, transparent)" }}>
          <Hourglass size={15} style={{ color: "#D97706" }} />
          <span className="text-[13px]" style={{ color: C.textBody }}>
            <strong style={{ color: "#B45309" }}>{m.cooldown.channel === "linkedin" ? "LinkedIn" : m.cooldown.channel}</strong>{" "}
            {t("metrics.cooldown.body", { until: fmtDT(m.cooldown.until) })}
          </span>
        </div>
      )}

      {/* ── EXECUTIVE OVERVIEW — "what happened" in seconds. Leads →
          Contacted → Positive → Meetings, with lead-level conversions.
          (Flow Metrics redesign 2026-08-27.) ── */}
      <div className="rounded-2xl border overflow-hidden relative" style={{ borderColor: C.border2, backgroundColor: C.card, boxShadow: C.shadow }}>
        <div className="absolute inset-x-0 top-0 h-[3px] pointer-events-none" style={{ background: "linear-gradient(90deg, var(--fg1), var(--fg3) 45%, var(--fg4) 80%, transparent)" }} />
        <div className="flex flex-wrap items-stretch px-2 py-1">
          {[
            { v: m.totalLeads, l: "Leads", conv: null as string | null, color: C.textPrimary, delta: null as number | null },
            { v: m.contacted, l: "Contacted", conv: `${m.contactedRate}% of leads`, color: C.textPrimary, delta: null },
            { v: m.positive, l: "Positive replies", conv: `${m.positiveLeadRate}% of leads`, color: C.green, delta: m.deltas?.positive?.pct ?? null },
            { v: m.meetings, l: "Meetings", conv: `${m.meetingRate}% of leads`, color: "var(--fg1)", delta: m.deltas?.meetings?.pct ?? null },
          ].map((k, i) => (
            <Fragment key={k.l}>
              {i > 0 && <div className="flex items-center px-1"><ChevronRight size={16} style={{ color: C.textDim }} /></div>}
              <div className="px-5 py-4 flex-1 min-w-[130px]">
                <div className="flex items-baseline gap-2">
                  <div className="text-[30px] font-extrabold leading-none tabular-nums" style={{ color: k.v === 0 ? C.textDim : k.color, fontFamily: OUTFIT, letterSpacing: "-0.03em" }}>{k.v}</div>
                  {k.delta != null && k.delta !== 0 && (
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: k.delta > 0 ? C.green : C.red }}>
                      {k.delta > 0 ? "↑" : "↓"}{Math.abs(k.delta)}%
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] mt-2" style={{ color: C.textMuted }}>{k.l}</div>
                {k.conv && <div className="text-[11px] font-bold mt-1.5" style={{ color: "var(--fg1)" }}>{k.conv}</div>}
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {/* ── OUTREACH FUNNEL (Totals merged in — boss 2026-06-08: the standalone
          Totals block duplicated the funnel, so it now lives inside this one
          section). LEFT = funnel bars (overall drop-off + conversions); RIGHT =
          totals per step. The per-channel split + negatives the bars don't
          break out sit in the chip row below. */}
      <Section title="Outreach funnel">
        <div>
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
                    <span className="text-[12px] font-bold tabular-nums" style={{ color: s.benchT ? bench(s.conv, s.benchT[0], s.benchT[1]) : s.color }}>{s.conv}%</span>
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
        </div>{/* close funnel wrapper — per-step totals now live only in the Step-by-step section below (was duplicated here) */}

        {/* drill list (who) — only when opened from the funnel */}
        {openFrom === "funnel" && drillPanel}

        {/* secondary chips */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: C.border }}>
          <MiniChip icon={Hourglass} label="awaiting acceptance" n={m.pendingAccept} color="#D97706" active={open === "pendingAccept" && openFrom === "funnel"} onClick={() => has("pendingAccept") && toggle("pendingAccept", "funnel")} clickable={has("pendingAccept")} />
          <MiniChip icon={XCircle} label="lost" n={m.lost} color={C.red} />
        </div>
      </Section>

      {/* ── PIPELINE STATUS — where the leads are NOW (mutually exclusive,
          partitions the cohort). Distribution bar + time-in-stage aging. ── */}
      <Section title="Pipeline status">
        {(() => {
          const p = m.pipeline;
          const segs = [
            { k: "In LinkedIn", n: p.inLinkedin, c: "var(--fg1)" },
            { k: "In Email", n: p.inEmail, c: "var(--fg3)" },
            { k: "In Cold calling", n: p.inCall, c: "var(--fg4)" },
            { k: "Replied · exited", n: p.repliedExited, c: C.green },
            { k: "Completed · no response", n: p.completedNoResponse, c: C.textMuted },
            { k: "Removed", n: p.removed, c: C.textDim },
            ...(p.failed ? [{ k: "Failed", n: p.failed, c: C.red }] : []),
            ...(p.other ? [{ k: "Other", n: p.other, c: C.textDim }] : []),
          ].filter(s => s.n > 0);
          const total = segs.reduce((a, s) => a + s.n, 0) || 1;
          const agingRows = Object.entries(m.stageAging).filter(([, a]) => a.active > 0);
          return (
            <>
              <div className="flex h-3 rounded-full overflow-hidden mb-3" style={{ backgroundColor: C.border }}>
                {segs.map(s => <div key={s.k} title={`${s.k}: ${s.n}`} style={{ width: `${(s.n / total) * 100}%`, backgroundColor: s.c }} />)}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {segs.map(s => (
                  <div key={s.k} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.c }} />
                    <span className="text-[14px] font-bold tabular-nums" style={{ color: C.textPrimary, fontFamily: OUTFIT }}>{s.n}</span>
                    <span className="text-[11px]" style={{ color: C.textMuted }}>{s.k}</span>
                  </div>
                ))}
              </div>
              {agingRows.length > 0 && (
                <div className="mt-4 pt-3 border-t flex flex-wrap gap-2 items-center" style={{ borderColor: C.border }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider mr-1" style={{ color: C.textDim }}>Time in stage</span>
                  {agingRows.map(([ch, a]) => {
                    const meta = CH[ch] ?? { label: ch, color: C.textMuted, Icon: Mail };
                    const warn = a.stuckOver3d > 0;
                    return (
                      <span key={ch} className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
                        style={{ borderColor: warn ? "color-mix(in srgb, #D97706 34%, transparent)" : C.border, backgroundColor: warn ? "color-mix(in srgb, #D97706 8%, transparent)" : C.bg, color: warn ? "#B45309" : C.textMuted }}>
                        {meta.label}: {a.active} active{a.avgDays != null ? ` · avg ${a.avgDays}d` : ""}{warn ? ` · ${a.stuckOver3d} stuck >3d` : ""}
                      </span>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}
      </Section>

      {/* ── BY CHANNEL ── */}
      <Section title="By channel" pad>
        <div className="flex flex-wrap gap-3">
          {m.linkedin && <ChannelCard ch="linkedin" stats={[["invites", m.linkedin.invitesSent], ["accepted", m.linkedin.accepted], ["DMs", m.linkedin.dmsSent], ["replies", m.linkedin.replies], ["reply rate", `${m.linkedin.replyRate}%`, m.linkedin.dmsSent > 0 ? bench(m.linkedin.replyRate, 10, 4) : undefined], ["positive", m.linkedin.positive, m.linkedin.positive > 0 ? C.green : undefined], ["pos. reply rate", `${m.linkedin.positiveReplyRate}%`, m.linkedin.replies > 0 ? bench(m.linkedin.positiveReplyRate, 25, 12) : undefined]]} danger={m.linkedin.failed > 0} />}
          {m.email && <ChannelCard ch="email" stats={[["sent", m.email.sent], ["bounced", m.email.bounced], ["bounce rate", `${m.email.bounceRate}%`, m.email.sent > 0 ? (m.email.bounceRate <= 2 ? "#16A34A" : m.email.bounceRate <= 5 ? "#D97706" : C.red) : undefined], ["replies", m.email.replies], ["reply rate", `${m.email.replyRate}%`, m.email.sent > 0 ? bench(m.email.replyRate, 8, 3) : undefined], ["positive", m.email.positive, m.email.positive > 0 ? C.green : undefined], ["pos. reply rate", `${m.email.positiveReplyRate}%`, m.email.replies > 0 ? bench(m.email.positiveReplyRate, 25, 12) : undefined]]} danger={m.email.bounceRate > 5} />}
          {m.call && (m.callStage
            ? <ChannelCard ch="call" stats={[["calls", m.callStage.made], ["connected", m.callStage.connected], ["connect rate", `${m.callStage.connectRate}%`, m.callStage.made > 0 ? bench(m.callStage.connectRate, 40, 25) : undefined], ["positive", m.callStage.positiveOutcomes, m.callStage.positiveOutcomes > 0 ? C.green : undefined], ["meetings", m.callStage.meetings, m.callStage.meetings > 0 ? "var(--fg1)" : undefined]]} />
            : <ChannelCard ch="call" stats={[["dialed", m.call.dialed]]} />)}
        </div>
      </Section>

      {/* ── OUTCOMES & DIAGNOSTICS — why (call outcome groups + reply quality
          + the one or two insights that actually matter). ── */}
      <Section title="Outcomes & diagnostics">
        <div className="flex flex-wrap gap-6">
          {m.callStage && (m.callStage.made > 0) && (
            <div className="min-w-[260px] flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>Call outcomes</p>
              {(() => {
                const g = m.callStage.groups;
                const groups = [
                  { k: "Positive", n: g.positive ?? 0, c: C.green },
                  { k: "Follow-up", n: g.followup ?? 0, c: "#D97706" },
                  { k: "Negative", n: g.negative ?? 0, c: C.red },
                  { k: "Unreachable", n: g.unreachable ?? 0, c: C.textMuted },
                  ...(g.other ? [{ k: "Other", n: g.other, c: C.textDim }] : []),
                ].filter(x => x.n > 0);
                const total = groups.reduce((a, x) => a + x.n, 0) || 1;
                return (
                  <>
                    <div className="flex h-2.5 rounded-full overflow-hidden mb-2.5" style={{ backgroundColor: C.border }}>
                      {groups.map(x => <div key={x.k} title={`${x.k}: ${x.n}`} style={{ width: `${(x.n / total) * 100}%`, backgroundColor: x.c }} />)}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {groups.map(x => <span key={x.k} className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: C.textBody }}><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: x.c }} /><b style={{ fontFamily: OUTFIT }}>{x.n}</b> {x.k}</span>)}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          <div className="min-w-[220px]">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>Reply quality</p>
            <div className="flex flex-wrap gap-1.5">
              <Tag label="positive" n={m.replyBreakdown.positive} color={C.green} />
              <Tag label="question" n={m.replyBreakdown.question} color="#0EA5E9" />
              <Tag label="follow-up" n={m.replyBreakdown.followup} color="#D97706" />
              <Tag label="negative" n={m.replyBreakdown.negative} color={C.red} />
              <Tag label="other" n={m.replyBreakdown.other} color={C.textMuted} />
            </div>
          </div>
        </div>
        {(() => {
          // Diagnostic insights — comparative / actionable only. We never restate
          // a headline number already visible above (e.g. "6 meetings"); each line
          // is a bottleneck, an anomaly, a leader, or an accumulation. Prioritized
          // (lower = more urgent), top 3 shown.
          const ins: { pri: number; text: string }[] = [];
          // 1 — deliverability anomaly: blocks everything downstream.
          if (m.email && m.email.sent > 0 && m.email.bounceRate >= 5)
            ins.push({ pri: 1, text: `Email bounce rate is ${m.email.bounceRate}% — verify the list before sending more.` });
          // 2 — biggest funnel leak: where the cohort drops off most.
          if (m.contacted > 0 && m.contactedReplyRate < 4 && m.replied < m.contacted)
            ins.push({ pri: 2, text: `Biggest leak is engagement — only ${m.contactedReplyRate}% of contacted leads reply. The opener needs work.` });
          else if (m.replied > 0 && m.positiveRate < 20)
            ins.push({ pri: 2, text: `Replies aren't converting — only ${m.positiveRate}% are positive. Revisit targeting or the pitch.` });
          // 3 — best-performing seller / LinkedIn profile (only meaningful with >1).
          if (m.sellers.length > 1) {
            const top = m.sellers[0]; // sorted by meetings desc, then positives
            const rest = m.sellers.slice(1);
            const avgOthers = rest.length ? rest.reduce((a, s) => a + s.meetingsPer100, 0) / rest.length : 0;
            if (top && (top.meetings > 0 || top.positiveReplies > 0) && top.meetingsPer100 > avgOthers)
              ins.push({ pri: 3, text: `${top.name} is converting best — ${top.meetingsPer100} meetings per 100 contacted.` });
          }
          // 4 — leads piling up without progress (rate-limit / paused seller).
          const stuck = Object.values(m.stageAging).reduce((a, x) => a + x.stuckOver3d, 0);
          if (stuck >= 5)
            ins.push({ pri: 4, text: `${stuck} leads are stuck >3 days without progress — check for a rate-limit or a paused seller.` });
          // 5 — channel efficiency gap.
          if (m.linkedin && m.email && m.linkedin.replies > 0 && m.email.replies > 0 && (m.linkedin.positiveReplyRate - m.email.positiveReplyRate) >= 10)
            ins.push({ pri: 5, text: `LinkedIn converts replies ${m.linkedin.positiveReplyRate - m.email.positiveReplyRate}pp better than Email — shift volume there.` });
          // 6 — calls connect but don't book.
          if (m.callStage && m.callStage.connected > 0 && m.callStage.connectRate >= 40 && m.callStage.meetingConversion < 6)
            ins.push({ pri: 6, text: `Calls connect well (${m.callStage.connectRate}%) but few book — ${m.callStage.meetingConversion}% of connected become meetings.` });
          // 7 — cohort finishing silent.
          if (m.totalLeads > 0 && m.pipeline.completedNoResponse > m.totalLeads * 0.4)
            ins.push({ pri: 7, text: `${m.pipeline.completedNoResponse} leads finished the flow without responding.` });
          const shown = ins.sort((a, b) => a.pri - b.pri).slice(0, 3);
          if (!shown.length) return null;
          return (
            <div className="mt-4 pt-3 border-t space-y-1.5" style={{ borderColor: C.border }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textDim }}>What to act on</p>
              {shown.map((s, i) => (<div key={i} className="flex items-start gap-2 text-[12px]" style={{ color: C.textBody }}><span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: gold }} />{s.text}</div>))}
            </div>
          );
        })()}
      </Section>

      {/* ── SELLER PERFORMANCE — who is driving the result. Activity →
          engagement → outcomes → meetings, + meetings-per-100 to compare
          sellers regardless of volume. ── */}
      {m.sellers.length > 0 && (
        <Section title="Seller performance">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-3 text-[10px] font-bold uppercase tracking-wider pb-1.5 mb-1 border-b" style={{ color: C.textDim, borderColor: C.border }}>
            <span>Seller</span><span className="text-right">LI</span><span className="text-right">Email</span><span className="text-right">Calls</span><span className="text-right">Conn.</span><span className="text-right">Pos.</span><span className="text-right">Meet/100</span>
          </div>
          <div className="space-y-0.5">
            {m.sellers.map(s => (
              <div key={s.sellerId} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-3 items-center text-[13px] py-1.5">
                <span className="font-semibold truncate" style={{ color: C.textPrimary }}>{s.name}<span className="text-[10px] font-normal ml-1.5" style={{ color: C.textDim }}>{s.leads} leads</span></span>
                <span className="text-right tabular-nums" style={{ color: C.textBody }}>{s.linkedinSent}</span>
                <span className="text-right tabular-nums" style={{ color: C.textBody }}>{s.emailsSent}</span>
                <span className="text-right tabular-nums" style={{ color: C.textBody }}>{s.callsMade}</span>
                <span className="text-right tabular-nums" style={{ color: C.textMuted }}>{s.callsConnected}</span>
                <span className="text-right tabular-nums font-semibold" style={{ color: s.positiveReplies ? C.green : C.textDim }}>{s.positiveReplies}</span>
                <span className="text-right tabular-nums font-bold" style={{ color: s.meetings ? "var(--fg1)" : C.textDim, fontFamily: OUTFIT }}>{s.meetingsPer100}</span>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] mt-2 pt-2 border-t" style={{ color: C.textDim, borderColor: C.border }}>Meet/100 = meetings per 100 contacted — compares sellers regardless of volume.</p>
        </Section>
      )}

      {/* ── STEP-BY-STEP ── */}
      <Section title="Step-by-step" action={
        <div className="flex items-center gap-2.5 text-[10px]" style={{ color: C.textDim }}>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: "var(--fg1)" }} />sent</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: C.textDim }} />skipped</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: "var(--fg4)" }} />pending</span>
        </div>
      }>
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 text-[10px] font-bold uppercase tracking-wider pb-1.5 mb-1 border-b" style={{ color: C.textDim, borderColor: C.border }}>
          <span>Step</span><span className="text-right w-10">Sent</span><span className="text-right w-14">Reply</span><span className="text-right w-10">Fail</span><span className="text-right w-10">Skip</span><span className="text-right w-12">Pend.</span>
        </div>
        <div className="space-y-0.5">
          {m.steps.map((s, i) => {
            const meta = CH[s.channel] ?? { label: s.channel, color: C.textMuted, Icon: Mail };
            const total = s.sent + s.failed + s.skipped + s.pending;
            const expanded = stepOpen === i;
            return (
              <div key={i}>
                <button type="button" onClick={() => setStepOpen(o => (o === i ? null : i))}
                  className="w-full grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 items-center text-sm py-1.5 rounded-lg px-1 transition-colors"
                  style={{ backgroundColor: expanded ? `color-mix(in srgb, ${meta.color} 7%, transparent)` : "transparent" }}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight size={12} style={{ color: C.textDim, transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                    <span className="font-medium truncate" style={{ color: C.textBody }}>{s.label}</span>
                    <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{meta.label}</span>
                    {/* Segmented bar — shows the step's real composition
                        (sent / skipped / pending) so you see at a glance where
                        leads pile up, instead of a decorative full-width bar. */}
                    <div className="flex-1 h-1.5 rounded ml-1 flex overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${C.border} 70%, transparent)` }} title={`${s.sent} sent · ${s.skipped} skipped · ${s.pending} pending`}>
                      {total > 0 && <>
                        <div className="h-1.5" style={{ width: `${(s.sent / total) * 100}%`, backgroundColor: "var(--fg1)" }} />
                        <div className="h-1.5" style={{ width: `${(s.skipped / total) * 100}%`, backgroundColor: C.textDim }} />
                        <div className="h-1.5" style={{ width: `${(s.pending / total) * 100}%`, backgroundColor: "var(--fg4)" }} />
                      </>}
                    </div>
                  </div>
                  <span className="text-right w-10 tabular-nums font-semibold" style={{ color: C.textPrimary, fontFamily: OUTFIT }}>{s.sent}</span>
                  <span className="text-right w-14 tabular-nums text-[12px]" style={{ color: s.replies ? bench(s.replyRate, 10, 3) : C.textDim }}>
                    {s.replies ? `${s.replies}·${s.replyRate}%` : "—"}
                  </span>
                  <span className="text-right w-10 tabular-nums" style={{ color: s.failed ? C.red : C.textDim }}>{s.failed}</span>
                  <span className="text-right w-10 tabular-nums" style={{ color: C.textDim }}>{s.skipped}</span>
                  <span className="text-right w-12 tabular-nums" style={{ color: s.pending ? "var(--fg3)" : C.textDim }}>{s.pending}</span>
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
            <MiniChip icon={AlertTriangle} label="failed steps" n={m.steps.reduce((a, s) => a + s.failed, 0)} color={C.red} active={open === "failed" && openFrom === "issues"} onClick={() => has("failed") && toggle("failed", "issues")} clickable={has("failed")} />
            <MiniChip icon={Mail} label="bounced" n={m.email?.bounced ?? 0} color={C.red} active={open === "bounced" && openFrom === "issues"} onClick={() => has("bounced") && toggle("bounced", "issues")} clickable={has("bounced")} />
            <MiniChip icon={Hourglass} label="awaiting accept" n={m.pendingAccept} color="#D97706" active={open === "pendingAccept" && openFrom === "issues"} onClick={() => has("pendingAccept") && toggle("pendingAccept", "issues")} clickable={has("pendingAccept")} />
          </div>
        </div>
        {/* drill list — only when opened from Issues, so it appears RIGHT HERE */}
        {openFrom === "issues" && drillPanel}
      </Section>
      </>
      )}
      </div>{/* /space-y-5 (sections) */}
      </div>{/* /dim wrapper */}
    </div>
  );
}

type SortKey = "name" | "messaged" | "currentStep" | "daysInFlow" | "lastActivity";
function LeadsActivityTable({ rows }: { rows: LeadActivity[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "accepted" | "replied" | "pending" | "bounced">("all");
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "lastActivity", dir: -1 });
  const fmt = fmtDT;
  const replyColor: Record<string, string> = { positive: C.green, question: "#0EA5E9", followup: "#D97706", negative: C.red, other: C.textMuted };
  const filtered = rows.filter(r => {
    if (q.trim()) { const s = q.trim().toLowerCase(); if (!`${r.name} ${r.company ?? ""}`.toLowerCase().includes(s)) return false; }
    if (filter === "accepted") return r.accepted;
    if (filter === "replied") return !!r.replied;
    if (filter === "pending") return r.inviteSent && !r.accepted;
    if (filter === "bounced") return r.bounced;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    const k = sort.key;
    let av: string | number = ""; let bv: string | number = "";
    if (k === "name") { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (k === "messaged") { av = a.messaged; bv = b.messaged; }
    else if (k === "currentStep") { av = a.currentStep ?? -1; bv = b.currentStep ?? -1; }
    else if (k === "daysInFlow") { av = a.daysInFlow ?? -1; bv = b.daysInFlow ?? -1; }
    else { av = a.lastActivity ?? ""; bv = b.lastActivity ?? ""; }
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });
  const toggleSort = (key: SortKey) => setSort(s => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) } : { key, dir: key === "name" ? 1 : -1 }));
  const Sortable = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "center" }) => (
    <th className={`px-2 py-2.5 cursor-pointer select-none ${align === "center" ? "text-center" : "text-left"}`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-0.5">{label}{sort.key === k && (sort.dir === 1 ? <ChevronDown size={10} className="rotate-180" /> : <ChevronDown size={10} />)}</span>
    </th>
  );
  const downloadCsv = () => {
    const head = ["Lead", "Company", "Channels", "Conn.", "Accepted", "Messages", "Replied", "Bounced", "Status", "Step", "Days in flow", "Last activity"];
    const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")].concat(sorted.map(r => [
      r.name, r.company ?? "", r.channels.join("|"), r.inviteSent ? "yes" : "no", r.accepted ? "yes" : "no",
      String(r.messaged), r.replied ?? "", r.bounced ? "yes" : "no", r.status, r.currentStep ?? "", r.daysInFlow ?? "", r.lastActivity ?? "",
    ].map(x => esc(String(x))).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "leads-activity.csv"; a.click(); URL.revokeObjectURL(url);
  };

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
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.textDim }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / company…"
              className="text-xs rounded-lg border pl-7 pr-2.5 py-1.5 outline-none w-52" style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textPrimary }} />
          </div>
          <button type="button" onClick={downloadCsv} disabled={sorted.length === 0}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 hover:opacity-80"
            style={{ borderColor: C.border, color: C.textBody }}>
            <Download size={12} /> CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="max-h-[440px] overflow-y-auto min-w-[680px]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: C.bg, boxShadow: `inset 0 -1px 0 ${C.border}` }}>
              <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
                <Sortable k="name" label="Lead" />
                <th className="text-left px-2 py-2.5">Channels</th>
                <th className="text-left px-2 py-2.5">LinkedIn</th>
                <Sortable k="messaged" label="Msgs" align="center" />
                <th className="text-left px-2 py-2.5">Replied</th>
                <Sortable k="currentStep" label="Step" align="center" />
                <th className="text-left px-2 py-2.5">Status</th>
                <Sortable k="lastActivity" label="Last activity" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-xs" style={{ color: C.textDim }}>No leads match this filter.</td></tr>
              ) : sorted.map(r => {
                const rc = r.replied ? (replyColor[r.replied] ?? C.textMuted) : C.textMuted;
                const rlabel = r.replied === "followup" ? "follow-up" : r.replied;
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
                      <td className="px-2 py-2 text-[11px] font-semibold">
                        {r.accepted
                          ? <span style={{ color: C.green }}>Accepted</span>
                          : r.inviteSent
                            ? <span style={{ color: "#0A66C2" }}>Invited</span>
                            : <span style={{ color: C.textDim }}>—</span>}
                      </td>
                      <td className="text-center px-2 py-2 tabular-nums" style={{ color: r.messaged ? C.textBody : C.textDim }}>{r.messaged || "—"}</td>
                      <td className="px-2 py-2">
                        {r.replied
                          ? (r.replyText
                            ? <button type="button" onClick={() => setOpenLead(o => (o === r.id ? null : r.id))}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded capitalize"
                                style={{ color: rc, backgroundColor: `color-mix(in srgb, ${rc} 12%, transparent)` }}>
                                {rlabel} <ChevronRight size={10} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                              </button>
                            : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded capitalize" style={{ color: rc, backgroundColor: `color-mix(in srgb, ${rc} 12%, transparent)` }}>{rlabel}</span>)
                          : <span style={{ color: C.textDim }}>—</span>}
                        {r.bounced && <span className="text-[11px] font-semibold ml-1" style={{ color: C.red }}>bounced</span>}
                      </td>
                      <td className="text-center px-2 py-2 tabular-nums text-xs" style={{ color: r.currentStep != null ? C.textBody : C.textDim }}>{r.currentStep != null ? (r.currentStep === 0 ? "CR" : r.currentStep) : "—"}</td>
                      <td className="px-2 py-2 text-xs capitalize" style={{ color: C.textMuted }}>{r.status}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: C.textMuted }}>
                        {fmt(r.lastActivity)}
                        {r.daysInFlow != null && <span style={{ color: C.textDim }}> · {r.daysInFlow}d en flujo</span>}
                      </td>
                    </tr>
                    {expanded && r.replyText && (
                      <tr style={{ backgroundColor: C.bg }}>
                        <td colSpan={8} className="px-4 py-2.5">
                          <div className="rounded-lg border px-3 py-2" style={{ borderColor: `color-mix(in srgb, ${rc} 30%, ${C.border})`, backgroundColor: C.card }}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <MessageSquare size={11} style={{ color: rc }} />
                              <span className="text-[10px] font-bold uppercase tracking-wider capitalize" style={{ color: rc }}>{rlabel} reply</span>
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

function ChannelCard({ ch, stats, danger }: { ch: string; stats: [string, string | number, string?][]; danger?: boolean }) {
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
          {stats.map(([k, v, color]) => (
            <div key={k} className="flex items-baseline gap-1">
              <span className="text-[15px] font-bold tabular-nums" style={{ color: color ?? C.textPrimary, fontFamily: OUTFIT }}>{v}</span>
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

// Deterministic Buenos Aires formatting so server + client agree (no hydration mismatch).
function fmtDT(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }); } catch { return "—"; }
}

function VStat({ label, value, sub, color, small }: { label: string; value: string; sub: string; color: string; small?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: C.textDim }}>{label}</p>
      <p className={small ? "text-[13px] font-semibold leading-tight" : "text-[20px] font-bold leading-none tabular-nums"} style={{ color, fontFamily: small ? undefined : OUTFIT }}>{value}</p>
      <p className="text-[10px] mt-0.5" style={{ color: C.textMuted }}>{sub}</p>
    </div>
  );
}

function Sparkline({ data }: { data: { date: string; sent: number; replies: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.sent));
  return (
    <div className="flex items-end gap-[3px] h-10">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.sent} sent · ${d.replies} replies`}>
          {d.replies > 0 && <span className="w-1 h-1 rounded-full mb-0.5 shrink-0" style={{ backgroundColor: C.green }} />}
          <div className="w-full rounded-sm" style={{ height: `${Math.max(4, (d.sent / max) * 100)}%`, backgroundColor: d.sent ? "color-mix(in srgb, #0A66C2 70%, transparent)" : C.border }} />
        </div>
      ))}
    </div>
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
