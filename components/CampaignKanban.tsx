"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable } from "@dnd-kit/core";
import { Share2, Mail, Phone, CheckCircle, Flag, User } from "lucide-react";
import { C } from "@/lib/design";

const gold = "#C9A83A";

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
          style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
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
      className="shrink-0 w-64 rounded-xl border transition-colors"
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
export default function CampaignKanban({ sequence, campaigns }: Props) {
  const [list, setList] = useState(campaigns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Group campaigns by current_step (bucketed into sequence index)
  const buckets = useMemo(() => {
    const b: Campaign[][] = sequence.map(() => []);
    const done: Campaign[] = [];
    for (const c of list) {
      const idx = Math.min(c.current_step ?? 0, sequence.length - 1);
      if ((c.current_step ?? 0) >= sequence.length) done.push(c);
      else if (idx >= 0) b[idx].push(c);
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
    if (!camp || camp.current_step === targetStep) return;

    // Optimistic update
    setList(prev => prev.map(c => c.id === campId ? { ...c, current_step: targetStep } : c));

    try {
      const r = await fetch(`/api/campaigns/${campId}/step`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStep: targetStep }),
      });
      if (!r.ok) throw new Error("update failed");
    } catch {
      // Rollback
      setList(prev => prev.map(c => c.id === campId ? { ...c, current_step: camp.current_step } : c));
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
        <div className="flex gap-3 overflow-x-auto pb-4">
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
          <div className="shrink-0 w-64 rounded-xl border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
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

        <DragOverlay>
          {active ? (
            <div className="rounded-lg border p-3 shadow-xl" style={{ backgroundColor: C.card, borderColor: gold }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
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
