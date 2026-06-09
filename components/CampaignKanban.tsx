"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable } from "@dnd-kit/core";
import { Share2, Mail, Phone, CheckCircle, Flag, User, Send, SkipForward, X, AlertTriangle } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

type SequenceStep = { channel: string; daysAfter: number };
type MsgState = {
  status: string;
  lastRateLimitAt: string | null;
  errorDetails: string | null;
  channel?: string;
  /** Set when the dispatcher skipped this message instead of failing — drives
   *  the friendlier kanban badge (ALREADY CONNECTED / INVITE PENDING / …). */
  skippedReason?: string | null;
} | null;
type Step0State = MsgState;
type Campaign = {
  id: string;
  status: string;
  current_step: number;
  sequence_steps: SequenceStep[] | null;
  /** Strongest reply classification for the lead (positive > question >
   *  negative > other), attached server-side. Drives the lifecycle badge so a
   *  lead that already answered reads as REPLIED/POSITIVE/NEGATIVE instead of
   *  showing stale dispatch plumbing. */
  reply_class?: string | null;
  leads: {
    id: string;
    primary_first_name: string | null;
    primary_last_name: string | null;
    company_name: string | null;
    primary_title_role?: string | null;
    lead_score?: number | null;
    is_priority?: boolean | null;
    primary_linkedin_url?: string | null;
    primary_work_email?: string | null;
    primary_phone?: string | null;
    allow_linkedin?: boolean | null;
    allow_email?: boolean | null;
    allow_call?: boolean | null;
  } | null;
  sellers: { name: string } | null;
  step_0?: Step0State;
  current_msg?: MsgState;
};

type CardBadge = { label: string; color: string; bg: string };

const CHANNEL_COLORS: Record<string, { color: string; bg: string }> = {
  linkedin: { color: "#0A66C2", bg: "#DBEAFE" },
  email:    { color: "#7C3AED", bg: "#EDE9FE" },
  call:     { color: "#F97316", bg: "#FFF7ED" },
};

// Status of the LinkedIn Connection Request slot (step 0).
function crBadge(camp: Campaign): CardBadge | null {
  const s = camp.step_0;
  if (!s) return null;
  if (s.status === "sent") return { label: "CR SENT", color: "#16A34A", bg: "#DCFCE7" };
  if (s.status === "failed") return { label: "CR FAILED", color: "#DC2626", bg: "#FEE2E2" };
  if (s.status === "dispatching") return { label: "CR SENDING…", color: "#7C3AED", bg: "#EDE9FE" };
  if (s.status === "skipped") {
    const reason = (s.skippedReason ?? "").toLowerCase();
    if (reason.includes("first_degree") || reason.includes("already a 1st")) return { label: "ALREADY CONNECTED", color: "#7C3AED", bg: "#EDE9FE" };
    if (reason.includes("pending") || reason.includes("invitation_sent")) return { label: "INVITE PENDING", color: "#D97706", bg: "#FEF3C7" };
    if (reason.includes("withdrawn") || reason.includes("ignored")) return { label: "INVITE WITHDRAWN", color: "#6B7280", bg: "#F3F4F6" };
    const url = camp.leads?.primary_linkedin_url ?? null;
    const looksLikeLinkedIn = !!url && /linkedin\.com\/in\//i.test(url);
    if (!url) return { label: "NO LINKEDIN", color: "#DC2626", bg: "#FEE2E2" };
    if (!looksLikeLinkedIn) return { label: "BAD URL", color: "#DC2626", bg: "#FEE2E2" };
    return { label: "LOCKED PROFILE", color: "#DC2626", bg: "#FEE2E2" };
  }
  if (s.status === "draft") return { label: "CR DRAFT", color: "#6B7280", bg: "#F3F4F6" };
  if (s.status === "queued") {
    if (s.lastRateLimitAt) {
      const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
      if (new Date(s.lastRateLimitAt).getTime() > fourHoursAgo) return { label: "CR COOLDOWN", color: "#D97706", bg: "#FFFBEB" };
    }
    return { label: "CR QUEUED", color: "#0A66C2", bg: "#DBEAFE" };
  }
  return null;
}

// Status of the step the card currently sits in (the next thing to fire,
// not the CR). Returns null when nothing's queued/draft/failed for that
// step yet — typical when current_step=0 and the dispatcher hasn't queued
// the first followup yet.
function stepBadge(camp: Campaign): CardBadge | null {
  const m = camp.current_msg;
  if (!m) return null;
  const channel = (m.channel ?? "linkedin").toUpperCase();
  const colors = CHANNEL_COLORS[m.channel] ?? CHANNEL_COLORS.linkedin;
  if (m.status === "failed") return { label: `${channel} FAILED`, color: "#DC2626", bg: "#FEE2E2" };
  if (m.status === "dispatching") return { label: `${channel} SENDING…`, color: "#7C3AED", bg: "#EDE9FE" };
  if (m.status === "sent") return { label: `${channel} SENT`, color: "#16A34A", bg: "#DCFCE7" };
  if (m.status === "queued") {
    if (m.lastRateLimitAt) {
      const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
      if (new Date(m.lastRateLimitAt).getTime() > fourHoursAgo) return { label: `${channel} COOLDOWN`, color: "#D97706", bg: "#FFFBEB" };
    }
    return { label: `${channel} QUEUED`, color: colors.color, bg: colors.bg };
  }
  if (m.status === "draft") return { label: `${channel} DRAFT`, color: "#6B7280", bg: "#F3F4F6" };
  return null;
}

// Lifecycle badge — the lead's REAL state, takes priority over dispatch
// plumbing. A lead that replied / a paused or finished campaign should read
// as REPLIED / POSITIVE / NEGATIVE / PAUSED / DONE, not "LINKEDIN QUEUED"
// (which is stale once the lead is out of the active send loop). Returns null
// for in-flight active campaigns so the dispatch badges still show.
function lifecycleBadge(camp: Campaign): CardBadge | null {
  const rc = (camp.reply_class ?? "").toLowerCase();
  if (rc === "positive") return { label: "POSITIVE REPLY", color: "#15803D", bg: "#DCFCE7" };
  if (rc === "negative") return { label: "NEGATIVE REPLY", color: "#DC2626", bg: "#FEE2E2" };
  if (rc === "question") return { label: "REPLIED · QUESTION", color: "#7C3AED", bg: "#EDE9FE" };
  if (rc === "followup") return { label: "FOLLOW-UP · BAD TIMING", color: "#D97706", bg: "#FEF3C7" };
  if (rc === "not_now") return { label: "NOT NOW", color: "#D97706", bg: "#FEF3C7" };
  if (rc === "voicemail") return { label: "VOICEMAIL", color: "#0EA5E9", bg: "#E0F2FE" };
  if (rc && rc !== "other") return { label: "REPLIED", color: "#0A66C2", bg: "#DBEAFE" };
  if (rc === "other") return { label: "REPLIED", color: "#0A66C2", bg: "#DBEAFE" };
  if (camp.status === "paused") return { label: "PAUSED", color: "#D97706", bg: "#FEF3C7" };
  if (camp.status === "completed") return { label: "DONE", color: "#15803D", bg: "#DCFCE7" };
  if (camp.status === "failed") return { label: "FLOW FAILED", color: "#DC2626", bg: "#FEE2E2" };
  return null;
}

// Up to 2 badges per card:
//   - If the lead has a terminal/lifecycle state (replied / paused / done /
//     failed): show ONLY that — the dispatch plumbing is irrelevant once the
//     lead left the active send loop, and showing "CR SENT · LINKEDIN QUEUED"
//     on a lead who already replied is what read as "flojo" (Fran 2026-06-02).
//   - On step 0 columns (CR not yet "done"): show the CR badge only.
//   - On step 1+ columns: show the column step's status (e.g. EMAIL QUEUED)
//     PLUS the CR result (e.g. CR SENT / ALREADY CONNECTED) as a secondary
//     reference so the seller can see both "what's about to fire" and
//     "what already happened on LinkedIn". Fran flagged this on 2026-05-27
//     because the previous logic only surfaced the CR status while the
//     card visually sat in the Email column — looked like the wrong state.
function deriveCardBadges(camp: Campaign): CardBadge[] {
  const life = lifecycleBadge(camp);
  if (life) return [life];
  const cs = camp.current_step ?? 0;
  const cr = crBadge(camp);
  if (cs === 0) {
    // Pre-acceptance phase. Primary = CR status. If a followup somehow
    // already has a draft/queued state (legacy data), surface it too.
    const step = stepBadge(camp);
    return [cr, step].filter((b): b is CardBadge => !!b);
  }
  // Past the connection phase — primary is the column step's status.
  const step = stepBadge(camp);
  // CR badge becomes a small secondary marker (typically CR SENT / ALREADY
  // CONNECTED). Skip the trivial CR SENT once we're a couple of steps in
  // to keep the card clean.
  const showCrSecondary = !!cr && cr.label !== "CR SENT" || cs <= 1;
  const secondary = showCrSecondary ? cr : null;
  return [step, secondary].filter((b): b is CardBadge => !!b);
}

// Per-channel status chips (boss 2026-06-09: "4 status, uno por canal — que se
// entienda"). One chip per channel the flow uses (CR / LinkedIn / Email / Call),
// each showing that channel's own state, instead of one mixed badge. Derived
// from the sequence position vs current_step (+ the CR badge for connection
// state, + the call outcome / wrong-number flag for the call channel).
const CHIP_STYLE: Record<string, { c: string; bg: string }> = {
  done:   { c: "#15803D", bg: "#DCFCE7" },
  sent:   { c: "#0A66C2", bg: "#DBEAFE" },
  queued: { c: "#B45309", bg: "#FEF3C7" },
  warn:   { c: "#B45309", bg: "#FEF3C7" },
  info:   { c: "#0369A1", bg: "#E0F2FE" },
  fail:   { c: "#DC2626", bg: "#FEE2E2" },
  none:   { c: "#9CA3AF", bg: "#F3F4F6" },
};
type Chip = { channel: string; label: string; tone: keyof typeof CHIP_STYLE };
function channelChips(camp: Campaign): Chip[] {
  const seq = Array.isArray(camp.sequence_steps) ? camp.sequence_steps : [];
  const cur = camp.current_step ?? 0;
  const rc = (camp.reply_class ?? "").toLowerCase();
  const chips: Chip[] = [];
  const prog = (channel: string): { label: string; tone: keyof typeof CHIP_STYLE } | null => {
    const idxs = seq.map((s, i) => (s.channel === channel ? i : -1)).filter(i => i >= 0);
    if (idxs.length === 0) return null;
    if (idxs.some(i => i < cur)) return { label: "Sent", tone: "sent" };
    if (idxs.some(i => i === cur)) return { label: "Queued", tone: "queued" };
    return { label: "—", tone: "none" };
  };
  // CR — only when the flow uses LinkedIn at all.
  if (seq.some(s => s.channel === "linkedin") || camp.step_0) {
    const cr = crBadge(camp);
    let label = "Pending", tone: keyof typeof CHIP_STYLE = "warn";
    if (cr) {
      if (/ACCEPT|CONNECT/i.test(cr.label)) { label = "Accepted"; tone = "done"; }
      else if (/SENT/i.test(cr.label)) { label = "Sent"; tone = "sent"; }
      else if (/FAIL/i.test(cr.label)) { label = "Failed"; tone = "fail"; }
      else if (/PENDING|QUEUED/i.test(cr.label)) { label = "Pending"; tone = "warn"; }
    }
    chips.push({ channel: "CR", label, tone });
  }
  const li = prog("linkedin"); if (li) chips.push({ channel: "LinkedIn", label: li.label, tone: li.tone });
  const em = prog("email");    if (em) chips.push({ channel: "Email", label: em.label, tone: em.tone });
  if (seq.some(s => s.channel === "call")) {
    let label: string, tone: keyof typeof CHIP_STYLE;
    if (camp.leads?.allow_call === false) { label = "Wrong #"; tone = "fail"; }
    else if (rc === "not_now") { label = "Not now"; tone = "warn"; }
    else if (rc === "voicemail") { label = "Voicemail"; tone = "info"; }
    else if (rc === "followup") { label = "Bad timing"; tone = "warn"; }
    else { const c = prog("call"); label = c?.label ?? "—"; tone = c?.tone ?? "none"; }
    chips.push({ channel: "Call", label, tone });
  }
  return chips;
}

type Props = {
  sequence: SequenceStep[];
  campaigns: Campaign[];
};

function leadInitials(lead: Campaign["leads"]): string {
  if (!lead) return "?";
  const f = (lead.primary_first_name || "").trim()[0] || "";
  const l = (lead.primary_last_name || "").trim()[0] || "";
  return (f + l).toUpperCase() || "?";
}

function fullName(lead: Campaign["leads"]): string {
  if (!lead) return "Unknown";
  return `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
}

// ─── Draggable card ─────────────────────────────────────────
function LeadCard({ camp, isDragging }: { camp: Campaign; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: camp.id,
    data: { currentStep: camp.current_step },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const isPriority = !!camp.leads?.is_priority;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, backgroundColor: C.card, borderColor: isPriority ? gold : C.border, opacity: isDragging ? 0.4 : 1 }}
      {...listeners}
      {...attributes}
      className="rounded-lg border p-3 mb-2 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow select-none"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
          {leadInitials(camp.leads)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <Link
              href={camp.leads ? `/leads/${camp.leads.id}` : "#"}
              className="text-xs font-semibold truncate hover:underline"
              style={{ color: C.textPrimary }}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
            >
              {fullName(camp.leads)}
            </Link>
            {isPriority && <Flag size={9} style={{ color: gold }} />}
          </div>
          {camp.leads?.company_name && (
            <p className="text-[10px] truncate" style={{ color: C.textMuted }}>
              {camp.leads.company_name}
            </p>
          )}
          {camp.leads?.primary_title_role && (
            <p className="text-[10px] truncate" style={{ color: C.textDim }}>
              {camp.leads.primary_title_role}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 pt-2 border-t" style={{ borderColor: C.border }}>
        {/* Top line: seller + the terminal outcome (reply / paused / done) so
            the big signal stays prominent above the per-channel detail. */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {camp.sellers?.name ? (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: C.textMuted }}>
              <User size={9} /> {camp.sellers.name}
            </span>
          ) : <span />}
          {(() => {
            const rc = (camp.reply_class ?? "").toLowerCase();
            const lc = lifecycleBadge(camp);
            // Only surface the terminal/important outcomes here — the softer
            // per-channel states (queued, not-now, voicemail…) live in the chips.
            const show = lc && (rc === "positive" || rc === "negative" || camp.status === "paused" || camp.status === "completed" || camp.status === "failed");
            if (!show || !lc) return null;
            return (
              <span className="text-[8.5px] font-bold tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: lc.bg, color: lc.color, letterSpacing: "0.04em" }}>
                {camp.status === "completed" && rc === "positive" ? <CheckCircle size={9} className="inline mr-0.5" /> : null}
                {lc.label}
              </span>
            );
          })()}
        </div>
        {/* Per-channel status strip — one chip per channel the flow uses. */}
        <div className="flex items-center gap-1 flex-wrap">
          {channelChips(camp).map((chip) => {
            const s = CHIP_STYLE[chip.tone];
            return (
              <span key={chip.channel}
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                style={{ backgroundColor: s.bg, color: s.c }}
                title={chip.channel === "CR" ? (camp.step_0?.errorDetails ?? undefined) : undefined}>
                <span style={{ opacity: 0.65 }}>{chip.channel}</span>
                {chip.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Droppable column ──────────────────────────────────────
function Column({ stepIndex, step, children, count, activeDragStep, isPast }: { stepIndex: number; step: SequenceStep; children: React.ReactNode; count: number; activeDragStep: number | null; isPast: boolean }) {
  // Past columns are not droppable at all — registering an inactive
  // useDroppable would still highlight on hover, which is the opposite
  // of the message we want to send ("nothing can land here").
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${stepIndex}`,
    data: { stepIndex },
    disabled: isPast,
  });
  const meta = channelMeta[step.channel] ?? { icon: Phone, color: C.textMuted, label: step.channel };
  const Icon = meta.icon;
  const isBackward = activeDragStep !== null && stepIndex < activeDragStep;
  const isSameStep = activeDragStep !== null && stepIndex === activeDragStep;
  const isValidTarget = !isBackward && !isSameStep && !isPast;

  return (
    <div
      ref={setNodeRef}
      className="rounded-xl border transition-colors overflow-hidden shrink-0"
      style={{
        width: 210,
        backgroundColor: isPast ? C.bg : isBackward ? C.bg : isOver && isValidTarget ? `${meta.color}08` : C.bg,
        borderColor: isPast ? C.border : isBackward ? C.border : isOver && isValidTarget ? meta.color : C.border,
        borderWidth: isOver && isValidTarget ? 2 : 1,
        opacity: isPast || isBackward ? 0.55 : 1,
        cursor: isPast || isBackward ? "not-allowed" : undefined,
      }}
    >
      <div className="px-3 py-2.5 border-b flex items-center justify-between sticky top-0 z-10"
        style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `${meta.color}15` }}>
            <Icon size={12} style={{ color: meta.color }} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
              style={{ color: C.textDim }}>
              Step {stepIndex + 1}
              {isPast && (
                <span className="text-[8px] font-bold px-1 py-px rounded" style={{ backgroundColor: C.surface, color: C.textDim }}>
                  PAST
                </span>
              )}
            </p>
            <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>
              {meta.label}
            </p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: C.border, color: C.textMuted }}>
          {count}
        </span>
      </div>
      <div className="p-2 min-h-[120px] max-h-[560px] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

// ─── Main kanban ───────────────────────────────────────────
type PendingMove = {
  campId: string;
  targetStep: number;
  targetChannel: string;
  fromStep: number;
  leadName: string;
};

export default function CampaignKanban({ sequence, campaigns }: Props) {
  const router = useRouter();
  const [list, setList] = useState(campaigns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragStep, setActiveDragStep] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, setBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Step N column = Nth DM has been sent. Orchestrator semantics:
  //   current_step=0 → nothing sent (still in connection phase)
  //   current_step=1 → 1st DM sent
  //   current_step=2 → 2nd DM sent
  //   current_step=3 → 3rd DM sent (final, orchestrator treats as done)
  const buckets = useMemo(() => {
    const b: Campaign[][] = sequence.map(() => []);
    const done: Campaign[] = [];
    for (const c of list) {
      const cs = c.current_step ?? 0;
      if (cs > sequence.length) { done.push(c); continue; }
      // Column i = cs=i: "i steps done, step i+1 is next".
      // After step 1 fires (cs=1) the lead moves to column 1, not column 0.
      const idx = Math.min(cs, sequence.length - 1);
      // Wrong number (boss 2026-06-08): a lead whose phone was flagged
      // (allow_call=false) can't be called, so it's dropped from Call-step
      // columns. It still flows on LinkedIn/Email and carries a WRONG # badge
      // there. The classify route already skips its queued call messages, so
      // the orchestrator advances it past this step on the next run.
      if (sequence[idx]?.channel === "call" && c.leads?.allow_call === false) continue;
      b[idx].push(c);
    }
    return { stepBuckets: b, done };
  }, [list, sequence]);

  // The earliest column any visible lead currently sits at. Columns to the
  // left of this index are "past" — leads can only move forward, so they
  // can never receive a drop, and showing "Drop leads here" on them is a
  // lie that confuses sellers. We use this to dim those columns and swap
  // the empty-state copy.
  const minActiveStep = useMemo(() => {
    let m = sequence.length; // start past-the-end
    for (let i = 0; i < buckets.stepBuckets.length; i++) {
      if (buckets.stepBuckets[i].length > 0) { m = i; break; }
    }
    return m;
  }, [buckets, sequence.length]);

  const active = activeId ? list.find(c => c.id === activeId) : null;

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    const camp = list.find(c => c.id === id);
    setActiveDragStep(camp?.current_step ?? 0);
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setActiveDragStep(null);
    const { active, over } = e;
    if (!over) return;
    const targetStep = Number(over.data.current?.stepIndex ?? -1);
    if (!Number.isFinite(targetStep) || targetStep < 0) return;

    const campId = String(active.id);
    const camp = list.find(c => c.id === campId);
    if (!camp) return;

    const newCurrentStep = targetStep;
    const currentStep = camp.current_step ?? 0;
    if (currentStep === newCurrentStep) return;

    // Backward moves are never allowed — leads only move forward.
    if (newCurrentStep < currentStep) return;

    // Restrict to adjacent forward moves to avoid ambiguity.
    if (newCurrentStep - currentStep > 1) {
      alert("Move one step at a time. To skip several, drag twice.");
      return;
    }

    const leadName = `${camp.leads?.primary_first_name ?? ""} ${camp.leads?.primary_last_name ?? ""}`.trim() || "this lead";
    const targetChannel = sequence[targetStep]?.channel ?? "linkedin";
    setPending({
      campId,
      targetStep: newCurrentStep,
      targetChannel,
      fromStep: camp.current_step ?? 0,
      leadName,
    });
  }

  async function commitMove(action: "skip" | "send") {
    if (!pending) return;
    setBusy(true);
    const { campId, targetStep, fromStep } = pending;
    // Always move to target column visually for immediate feedback.
    // For Send the backend actually holds current_step at target-1 (so orchestrator sends
    // and then advances). The client stays at target until the user reloads.
    setList(prev => prev.map(c => c.id === campId ? { ...c, current_step: targetStep } : c));
    try {
      const r = await fetch(`/api/campaigns/${campId}/step`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStep: targetStep, action }),
      });
      if (!r.ok) throw new Error("update failed");
      setPending(null);
      // Skip → refresh immediately (backend matches UI).
      // Send → delay refresh so the optimistic target column stays put until orchestrator runs.
      if (action === "skip") router.refresh();
    } catch {
      setList(prev => prev.map(c => c.id === campId ? { ...c, current_step: fromStep } : c));
    } finally {
      setBusy(false);
    }
  }

  if (sequence.length === 0) {
    return (
      <div className="rounded-xl border py-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textMuted }}>No sequence steps defined.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-xl border p-4 mb-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textMuted }}>
          <span className="font-semibold" style={{ color: C.textBody }}>Drag a lead</span> to advance it to a later step.
          Steps marked <span className="font-semibold" style={{ color: C.textBody }}>PAST</span> have already been completed and can&apos;t receive drops.
          Changes apply on the next orchestrator cycle.
        </p>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 pb-4" style={{ minWidth: "max-content" }}>
          {sequence.map((step, i) => {
            const isPast = i < minActiveStep;
            const isEmpty = buckets.stepBuckets[i].length === 0;
            return (
              <Column key={i} stepIndex={i} step={step} count={buckets.stepBuckets[i].length} activeDragStep={activeDragStep} isPast={isPast}>
                {buckets.stepBuckets[i].map(c => (
                  <LeadCard key={c.id} camp={c} isDragging={activeId === c.id} />
                ))}
                {isEmpty && !isPast && (
                  <p className="text-[11px] italic text-center py-6" style={{ color: C.textDim }}>
                    Drop leads here
                  </p>
                )}
                {isEmpty && isPast && (
                  <p className="text-[11px] italic text-center py-6" style={{ color: C.textDim }}>
                    Already passed
                  </p>
                )}
              </Column>
            );
          })}

          {/* Completed column */}
          <div className="rounded-xl border overflow-hidden shrink-0" style={{ width: 210, backgroundColor: C.bg, borderColor: C.border }}>
            <div className="px-3 py-2.5 border-b flex items-center justify-between"
              style={{ borderColor: C.border, backgroundColor: C.card }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `${C.green}15` }}>
                  <CheckCircle size={12} style={{ color: C.green }} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
                    Final
                  </p>
                  <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>
                    Completed
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: C.border, color: C.textMuted }}>
                {buckets.done.length}
              </span>
            </div>
            <div className="p-2 min-h-[120px] max-h-[560px] overflow-y-auto">
              {buckets.done.map(c => <LeadCard key={c.id} camp={c} />)}
              {buckets.done.length === 0 && (
                <p className="text-[11px] italic text-center py-6" style={{ color: C.textDim }}>
                  Leads that finished the flow land here.
                </p>
              )}
            </div>
          </div>
        </div>

        </div>{/* end overflow-x-auto */}

        {pending && <MoveModal pending={pending} busy={busy} onCommit={commitMove} onCancel={() => setPending(null)} />}

        <DragOverlay>
          {active ? (
            <div className="rounded-lg border p-3 shadow-xl" style={{ backgroundColor: C.card, borderColor: gold }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                  {leadInitials(active.leads)}
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{fullName(active.leads)}</p>
                  {active.leads?.company_name && (
                    <p className="text-[10px]" style={{ color: C.textMuted }}>{active.leads.company_name}</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ─── Move confirmation modal ──────────────────────────────────────
function MoveModal({
  pending, busy, onCommit, onCancel,
}: {
  pending: PendingMove;
  busy: boolean;
  onCommit: (action: "skip" | "send") => void;
  onCancel: () => void;
}) {
  const chMeta = channelMeta[pending.targetChannel] ?? channelMeta.linkedin;
  const ChIcon = chMeta.icon;

  // Channel-specific copy
  const channelNoun: Record<string, string> = {
    linkedin: "LinkedIn message",
    email: "email",
    call: "call",
  };
  const sendVerb: Record<string, string> = {
    linkedin: "Send LinkedIn message now",
    email: "Send email now",
    call: "Make the call now",
  };
  const skipVerb: Record<string, string> = {
    linkedin: "Skip LinkedIn message",
    email: "Skip email",
    call: "Skip call",
  };
  const noun = channelNoun[pending.targetChannel] ?? "message";
  const sendLabel = sendVerb[pending.targetChannel] ?? "Send now";
  const skipLabel = skipVerb[pending.targetChannel] ?? "Skip";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onCancel}>
      <div className="rounded-2xl border w-full max-w-md overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${chMeta.color}15` }}>
              <ChIcon size={15} style={{ color: chMeta.color }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>
                Moving {pending.leadName}
              </h2>
              <p className="text-xs" style={{ color: C.textMuted }}>
                Advance to Step {pending.targetStep}. Decide what happens with the pending {noun}.
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-black/5">
            <X size={14} style={{ color: C.textMuted }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg border p-3" style={{ borderColor: "#FCD34D", backgroundColor: "#FFFBEB" }}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "#D97706" }} />
              <p className="text-[11px] leading-relaxed" style={{ color: "#92400E" }}>
                <strong>Send</strong> will deliver the {noun} to the lead&apos;s inbox on the next orchestrator cycle (up to 1h).
                <br />
                <strong>Skip</strong> advances the step without sending — the {noun} is never delivered.
              </p>
            </div>
          </div>

          <button onClick={() => onCommit("send")} disabled={busy}
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm disabled:opacity-50"
            style={{ borderColor: `${chMeta.color}50`, backgroundColor: `${chMeta.color}08`, color: chMeta.color }}>
            <span className="flex items-center gap-2.5">
              <Send size={14} />
              <span className="text-sm font-semibold">{sendLabel}</span>
            </span>
            <span className="text-[10px] font-medium opacity-70">Lead receives it</span>
          </button>

          <button onClick={() => onCommit("skip")} disabled={busy}
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm disabled:opacity-50"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textBody }}>
            <span className="flex items-center gap-2.5">
              <SkipForward size={14} style={{ color: C.textMuted }} />
              <span className="text-sm font-semibold">{skipLabel}</span>
            </span>
            <span className="text-[10px] font-medium" style={{ color: C.textDim }}>Lead gets nothing</span>
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <button onClick={onCancel} disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded transition-opacity hover:opacity-80"
            style={{ color: C.textMuted }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
