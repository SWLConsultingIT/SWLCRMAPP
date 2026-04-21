"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Share2, Mail, Phone, Check, PlayCircle, ChevronDown } from "lucide-react";

const gold = "#C9A83A";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e", label: "WhatsApp" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

type Step = { channel: string; daysAfter: number };
type Msg = { id: string; step_number: number; channel: string; content: string; status: string; sent_at: string | null };
type Tmpl = { channel: string; body: string; subject?: string };

export default function SequenceAccordion({
  sequence, messages, messageTemplates, connectionNote, dayPerStep, currentStep,
}: {
  sequence: Step[];
  messages: Msg[];
  messageTemplates: Tmpl[];
  connectionNote: string;
  dayPerStep: number[];
  currentStep: number;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Outreach Sequence</p>
      </div>
      {sequence.map((step, i) => {
        const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
        const Icon = meta.icon;
        const msg = messages.find(m => m.step_number === i + 1) ?? null;
        const tmpl = messageTemplates[i] ?? null;
        const displayBody: string | null = msg?.content ?? tmpl?.body ?? null;
        const displaySubject: string | null = msg ? null : (tmpl?.subject ?? null);
        const isSent = msg?.status === "sent";
        const isPast = i < currentStep;
        const isCurrent = i === currentStep;
        const showConnNote = i === 0 && step.channel === "linkedin" && !!connectionNote;
        const isOpen = expanded.has(i);
        const hasContent = !!displayBody || showConnNote;

        return (
          <div key={i} style={{ borderBottom: i < sequence.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <button
              onClick={() => hasContent && toggle(i)}
              className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-gray-50"
              style={{ cursor: hasContent ? "pointer" : "default" }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: isPast ? meta.color : isCurrent ? gold : "#E5E7EB" }}>
                {isPast ? <Check size={12} color="#fff" /> : isCurrent ? <PlayCircle size={12} color="#fff" /> : <span className="text-[10px] font-bold text-white">{i + 1}</span>}
              </div>
              <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${meta.color}12`, color: meta.color }}><Icon size={11} /> {meta.label}</span>
              <span className="text-xs" style={{ color: C.textDim }}>Day {dayPerStep[i] ?? 0}{i > 0 ? ` (+${step.daysAfter}d)` : ""}</span>
              {showConnNote && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#0A66C212", color: "#0A66C2" }}>+ connection note</span>}
              <div className="flex-1" />
              {isSent && <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: C.greenLight, color: C.green }}>Sent</span>}
              {!isSent && <span className="text-xs px-2 py-0.5 rounded-md" style={{ backgroundColor: isCurrent ? `${gold}15` : "#F3F4F6", color: isCurrent ? gold : C.textMuted }}>{isCurrent ? "Up Next" : "Pending"}</span>}
              {hasContent && (
                <ChevronDown
                  size={14}
                  style={{
                    color: C.textDim,
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                    flexShrink: 0,
                  }}
                />
              )}
            </button>

            {isOpen && (
              <div className="px-5 pb-4 pt-1 space-y-3">
                {showConnNote && (
                  <div className="rounded-lg border p-4" style={{ borderColor: "#0A66C220", backgroundColor: "#0A66C206" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Share2 size={12} style={{ color: "#0A66C2" }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#0A66C2" }}>Connection Request Note</span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{connectionNote}</p>
                  </div>
                )}

                {displayBody && (
                  <div className="rounded-lg border p-4" style={{ borderColor: isSent ? `${C.green}30` : isCurrent ? `${gold}30` : C.border, backgroundColor: isSent ? `${C.green}04` : isCurrent ? `${gold}04` : C.bg }}>
                    {displaySubject && (
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Subject: {displaySubject}</p>
                    )}
                    {!msg && tmpl && (
                      <p className="text-[10px] font-medium mb-2 px-2 py-0.5 rounded inline-block" style={{ backgroundColor: `${gold}12`, color: gold }}>Template</p>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{displayBody}</p>
                    {msg?.sent_at && (
                      <p className="text-[9px] mt-2" style={{ color: C.textDim }}>
                        Sent {new Date(msg.sent_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
