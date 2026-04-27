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
type Campaign = {
  id: string;
  status: string;
  current_step: number;
  sequence_steps: SequenceStep[] | null;
  leads: {
    id: string;
    primary_first_name: string | null;
    primary_last_name: string | null;
    company_name: string | null;
    primary_title_role?: string | null;
    lead_score?: number | null;
    is_priority?: boolean | null;
  } | null;
  sellers: { name: string } | null;
};

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

      <div className="flex items-center justify-between mt-2 pt-2 border-t" style={{ borderColor: C.border }}>
        {camp.sellers?.name ? (
          <span className="flex items-center gap-1 text-[10px]" style={{ color: C.textMuted }}>
            <User size={9} /> {camp.sellers.name}
          </span>
        ) : <span />}
        {camp.status === "completed" && <CheckCircle size={11} style={{ color: C.green }} />}
        {camp.status === "paused" && <span className="text-[9px] font-bold" style={{ color: "#D97706" }}>PAUSED</span>}
      </div>
    </div>
  );
}

// ─── Droppable column ──────────────────────────────────────
function Column({ stepIndex, step, children, count }: { stepIndex: number; step: SequenceStep; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${stepIndex}`, data: { stepIndex } });
  const meta = channelMeta[step.channel] ?? { icon: Phone, color: C.textMuted, label: step.channel };
  const Icon = meta.icon;

  return (
    <div
      ref={setNodeRef}
      className="flex-1 min-w-0 rounded-xl border transition-colors"
      style={{
        backgroundColor: isOver ? `${meta.color}08` : C.bg,
        borderColor: isOver ? meta.color : C.border,
        borderWidth: isOver ? 2 : 1,
      }}
    >
      <div className="px-3 py-2.5 border-b flex items-center justify-between sticky top-0 z-10"
        style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `${meta.color}15` }}>
            <Icon size={12} style={{ color: meta.color }} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
              Step {stepIndex + 1}
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
  isForward: boolean;
};

export default function CampaignKanban({ sequence, campaigns }: Props) {
  const router = useRouter();
  const [list, setList] = useState(campaigns);
  const [activeId, setActiveId] = useState<string | null>(null);
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
      const idx = Math.max(0, Math.min(cs - 1, sequence.length - 1));
      b[idx].push(c);
    }
    return { stepBuckets: b, done };
  }, [list, sequence]);

  const active = activeId ? list.find(c => c.id === activeId) : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const targetStep = Number(over.data.current?.stepIndex ?? -1);
    if (!Number.isFinite(targetStep) || targetStep < 0) return;

    const campId = String(active.id);
    const camp = list.find(c => c.id === campId);
    if (!camp) return;

    // Column Step N = "Nth DM sent". Column 0-indexed, so target current_step = targetStep + 1.
    const newCurrentStep = targetStep + 1;
    const currentStep = camp.current_step ?? 0;
    if (currentStep === newCurrentStep) return;

    // Restrict to adjacent step moves. Multi-step jumps create ambiguity
    // (send only target vs send all pending vs re-send when going backward).
    if (Math.abs(newCurrentStep - currentStep) > 1) {
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
      isForward: newCurrentStep > (camp.current_step ?? 0),
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
          <span className="font-semibold" style={{ color: C.textBody }}>Drag a lead</span> to move it to a different step. Useful to skip ahead or force a specific action. Changes apply on the next orchestrator cycle.
        </p>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 pb-4 w-full">
          {sequence.map((step, i) => (
            <Column key={i} stepIndex={i} step={step} count={buckets.stepBuckets[i].length}>
              {buckets.stepBuckets[i].map(c => (
                <LeadCard key={c.id} camp={c} isDragging={activeId === c.id} />
              ))}
              {buckets.stepBuckets[i].length === 0 && (
                <p className="text-[11px] italic text-center py-6" style={{ color: C.textDim }}>
                  Drop leads here
                </p>
              )}
            </Column>
          ))}

          {/* Completed column */}
          <div className="flex-1 min-w-0 rounded-xl border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
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
                {pending.isForward
                  ? `Advance to Step ${pending.targetStep}. Decide what happens with the pending ${noun}.`
                  : `Move back to Step ${pending.targetStep}.`}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-black/5">
            <X size={14} style={{ color: C.textMuted }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {pending.isForward ? (
            <>
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
            </>
          ) : (
            <>
              <p className="text-xs" style={{ color: C.textMuted }}>
                This rolls back their progress. No messages will be re-sent.
              </p>
              <button onClick={() => onCommit("skip")} disabled={busy}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: C.gold, color: "#1A1A2E" }}>
                Move back to Step {pending.targetStep}
              </button>
            </>
          )}
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
