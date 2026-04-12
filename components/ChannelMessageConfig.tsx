"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import {
  Share2, Mail, Phone, Sparkles, Loader2,
  ThumbsUp, ThumbsDown,
} from "lucide-react";

const gold = C.gold;

// ── Types ──

export type StepMessage = {
  type: string;
  channel: string;
  label: string;
  body: string;
  subject?: string;
};

export type AutoReplies = {
  positive: string;
  negative: string;
  question: string;
};

export type ChannelMessages = {
  steps: StepMessage[];
  autoReplies: AutoReplies;
};

type Props = {
  sequence: { channel: string; daysAfter: number }[];
  channelMessages: ChannelMessages;
  onChange: (msgs: ChannelMessages) => void;
  leadId?: string;
  language: string;
};

// ── Helpers ──

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:    { icon: Mail,   color: C.email,    label: "Email" },
  call:     { icon: Phone,  color: C.phone,    label: "Call" },
};

function classifySteps(sequence: { channel: string; daysAfter: number }[]): { type: string; channel: string; label: string; hasSubject: boolean }[] {
  const counters: Record<string, number> = {};
  let introduced = false;

  return sequence.map((s) => {
    counters[s.channel] = (counters[s.channel] || 0) + 1;
    const nth = counters[s.channel];

    if (s.channel === "linkedin") {
      if (nth === 1) return { type: "LINKEDIN_CONNECTION_REQUEST", channel: s.channel, label: "Connection Request + Note", hasSubject: false };
      if (!introduced) { introduced = true; return { type: "LINKEDIN_INTRO_DM", channel: s.channel, label: "First DM (Post-Connection)", hasSubject: false }; }
      return { type: "LINKEDIN_FOLLOWUP", channel: s.channel, label: `LinkedIn Follow-up ${nth - 2 + (introduced ? 1 : 0)}`, hasSubject: false };
    } else if (s.channel === "email") {
      if (!introduced) { introduced = true; return { type: "EMAIL_INTRO", channel: s.channel, label: "Introduction Email", hasSubject: true }; }
      if (nth === 1) return { type: "EMAIL_FOLLOWUP_CROSS", channel: s.channel, label: "Email (Cross-channel Follow-up)", hasSubject: true };
      return { type: "EMAIL_FOLLOWUP", channel: s.channel, label: `Email Follow-up ${nth > 1 ? nth - 1 : 1}`, hasSubject: true };
    } else if (s.channel === "call") {
      if (nth === 1) return { type: "CALL_FIRST", channel: s.channel, label: "First Call Script", hasSubject: false };
      return { type: "CALL_FOLLOWUP", channel: s.channel, label: "Follow-up Call Script", hasSubject: false };
    }
    return { type: "UNKNOWN", channel: s.channel, label: "Message", hasSubject: false };
  });
}

const typeDescriptions: Record<string, string> = {
  LINKEDIN_CONNECTION_REQUEST: "Short note with the connection request. Include a brief intro of who you are and why you want to connect. Max 300 chars.",
  LINKEDIN_INTRO_DM: "First real message after they accept. Start with 'Gracias por conectar'. Introduce yourself, your company, what you offer, and ask if interested.",
  LINKEDIN_FOLLOWUP: "Follow-up message. Reference your previous message, bring new value (data, case study, trend). Don't re-introduce yourself.",
  EMAIL_INTRO: "First email. Subject + body. Introduce yourself and your company, connect their pain point to your solution, include proof, end with CTA.",
  EMAIL_FOLLOWUP_CROSS: "First email after contacting on another channel. Reference previous outreach, bring a new angle.",
  EMAIL_FOLLOWUP: "Follow-up email. Short, reference previous email, one new piece of value.",
  CALL_FIRST: "Call script in bullet points: Opener, Context, Questions, Pitch, Close.",
  CALL_FOLLOWUP: "Follow-up call script. Reference previous contact, new angle, ask for meeting.",
};

const typePlaceholders: Record<string, string> = {
  LINKEDIN_CONNECTION_REQUEST: "Hola [nombre], soy [vendedor] de SWL Consulting. Vi tu trabajo en [tema] y me gustaría conectar para intercambiar ideas sobre [tema relevante].",
  LINKEDIN_INTRO_DM: "Gracias por conectar, [nombre].\n\nSoy [vendedor] de SWL Consulting, donde ayudamos a empresas de [industria] a...\n\n¿Te interesaría coordinar una charla breve?\n\nGracias,\n[vendedor]\nSWL Consulting",
  LINKEDIN_FOLLOWUP: "[nombre], volviendo a lo que te comenté sobre [tema].\n\n[Nuevo dato/caso/tendencia relevante]\n\n¿Te resulta relevante?\n\nGracias,\n[vendedor]",
  EMAIL_INTRO: "Hola [nombre],\n\n[Hook sobre su empresa]\n\nSoy [vendedor] de SWL Consulting — [qué hacemos].\n\n[Pain point → Solución]\n\n[Prueba social]\n\n¿Tendría sentido coordinar 15 min?\n\nGracias,\n[vendedor]",
  EMAIL_FOLLOWUP_CROSS: "Hola [nombre], te contacté por LinkedIn hace unos días sobre [tema]...",
  EMAIL_FOLLOWUP: "[nombre], siguiendo con mi email anterior...",
  CALL_FIRST: "• Apertura: Hola [nombre], soy [vendedor] de SWL Consulting...\n• Contexto: ...\n• Preguntas: ...\n• Pitch: ...\n• Cierre: ¿Coordinamos 15 min?",
  CALL_FOLLOWUP: "• Apertura: [nombre], soy [vendedor] de SWL Consulting, te escribí por [canal]...\n• Nuevo ángulo: ...\n• Cierre: ...",
};

// ── Main Component ──

export default function ChannelMessageConfig({ sequence, channelMessages, onChange, leadId, language }: Props) {
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const classified = classifySteps(sequence);

  // Ensure steps array matches sequence
  const steps = classified.map((cls, i) => channelMessages.steps?.[i] || {
    type: cls.type, channel: cls.channel, label: cls.label, body: "", subject: cls.hasSubject ? "" : undefined,
  });
  const autoReplies = channelMessages.autoReplies || { positive: "", negative: "", question: "" };

  function updateStep(idx: number, field: "body" | "subject", value: string) {
    const newSteps = [...steps];
    newSteps[idx] = { ...newSteps[idx], [field]: value };
    onChange({ steps: newSteps, autoReplies });
  }

  function updateAutoReply(field: keyof AutoReplies, value: string) {
    onChange({ steps, autoReplies: { ...autoReplies, [field]: value } });
  }

  // AI generation per field
  async function generateField(fieldType: string, idx?: number) {
    const key = `${fieldType}:${idx ?? ""}`;
    setAiLoading(key);
    try {
      const res = await fetch("/api/campaigns/generate-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: classified[idx ?? 0]?.channel || "linkedin", fieldType, idx, leadId, language }),
      });
      const data = await res.json();
      if (data.content) {
        if (fieldType === "introEmail" && idx !== undefined) {
          const newSteps = [...steps];
          newSteps[idx] = { ...newSteps[idx], body: data.content, subject: data.subject || newSteps[idx].subject };
          onChange({ steps: newSteps, autoReplies });
        } else if (idx !== undefined) {
          updateStep(idx, "body", data.content);
        } else {
          updateAutoReply(fieldType as keyof AutoReplies, data.content);
        }
      }
    } catch { /* silent */ }
    setAiLoading(null);
  }

  // Map step type to AI fieldType
  function stepToFieldType(type: string): string {
    const map: Record<string, string> = {
      LINKEDIN_CONNECTION_REQUEST: "connectionNote",
      LINKEDIN_INTRO_DM: "introDM",
      LINKEDIN_FOLLOWUP: "followUp",
      EMAIL_INTRO: "introEmail",
      EMAIL_FOLLOWUP_CROSS: "introEmail",
      EMAIL_FOLLOWUP: "followUp",
      CALL_FIRST: "callScript",
      CALL_FOLLOWUP: "callFollowUp",
    };
    return map[type] || "followUp";
  }

  // Cumulative days
  let cumDay = 0;
  const dayPerStep = sequence.map((s, i) => {
    cumDay += i === 0 ? 0 : s.daysAfter;
    return cumDay;
  });

  return (
    <div className="space-y-4">
      {/* ═══ OUTREACH SEQUENCE (in order) ═══ */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-8 bottom-8 w-0.5" style={{ backgroundColor: C.border }} />

        {classified.map((cls, i) => {
          const meta = channelMeta[cls.channel] || channelMeta.linkedin;
          const Icon = meta.icon;
          const step = steps[i];
          const fieldType = stepToFieldType(cls.type);
          const isEmail = cls.hasSubject;
          const loadingKey = `${fieldType}:${i}`;

          return (
            <div key={i} className="relative flex gap-4 mb-4">
              {/* Step indicator */}
              <div className="relative z-10 shrink-0">
                <div className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: meta.color, border: "3px solid #fff" }}>
                  <Icon size={16} color="#fff" />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                {/* Header */}
                <div className="px-5 py-3 flex items-center justify-between border-b"
                  style={{ borderColor: C.border, background: `${meta.color}06` }}>
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold" style={{ color: C.textPrimary }}>Step {i + 1}</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                      {cls.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs tabular-nums font-medium" style={{ color: C.textDim }}>Day {dayPerStep[i]}</span>
                    <button onClick={() => generateField(fieldType, i)} disabled={!!aiLoading}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: `${gold}15`, color: gold }}>
                      {aiLoading === loadingKey ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      AI
                    </button>
                  </div>
                </div>

                {/* Description */}
                <div className="px-5 pt-3">
                  <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
                    {typeDescriptions[cls.type] || "Write your message"}
                  </p>
                </div>

                {/* Fields */}
                <div className="px-5 py-3 space-y-2">
                  {isEmail && (
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                      value={step?.subject || ""}
                      onChange={e => updateStep(i, "subject", e.target.value)}
                      placeholder="Subject line (max 60 chars)..."
                    />
                  )}
                  <textarea
                    rows={cls.type === "EMAIL_INTRO" ? 7 : cls.type.includes("CALL") ? 6 : cls.type === "LINKEDIN_CONNECTION_REQUEST" ? 2 : 5}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                    style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                    value={step?.body || ""}
                    onChange={e => updateStep(i, "body", e.target.value)}
                    placeholder={typePlaceholders[cls.type] || "Write your message..."}
                  />
                  {cls.type === "LINKEDIN_CONNECTION_REQUEST" && (
                    <p className="text-xs text-right" style={{ color: (step?.body?.length || 0) > 300 ? C.red : C.textDim }}>
                      {step?.body?.length || 0}/300
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ AUTO-REPLIES (reactive, separate) ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>Auto-Replies</p>
          <p className="text-xs" style={{ color: C.textMuted }}>When the lead responds, these templates are used automatically. The campaign stops after any response.</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Positive */}
          <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: `${C.green}04` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ThumbsUp size={14} style={{ color: C.green }} />
                <p className="text-xs font-semibold" style={{ color: C.green }}>Positive Response</p>
              </div>
              <button onClick={() => generateField("replyPositive")} disabled={!!aiLoading}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: `${gold}15`, color: gold }}>
                {aiLoading === "replyPositive:" ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} AI
              </button>
            </div>
            <p className="text-xs mb-2" style={{ color: C.textMuted }}>Lead says yes / interested → propose meeting</p>
            <textarea rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
              value={autoReplies.positive} onChange={e => updateAutoReply("positive", e.target.value)}
              placeholder="¡Excelente! Me alegra tu interés. Te propongo coordinar una llamada de 15 min..."
            />
          </div>

          {/* Negative */}
          <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: `${C.red}04` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ThumbsDown size={14} style={{ color: C.red }} />
                <p className="text-xs font-semibold" style={{ color: C.red }}>Negative Response</p>
              </div>
              <button onClick={() => generateField("replyNegative")} disabled={!!aiLoading}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: `${gold}15`, color: gold }}>
                {aiLoading === "replyNegative:" ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} AI
              </button>
            </div>
            <p className="text-xs mb-2" style={{ color: C.textMuted }}>Lead says no → close respectfully, leave door open</p>
            <textarea rows={2}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
              value={autoReplies.negative} onChange={e => updateAutoReply("negative", e.target.value)}
              placeholder="Entiendo perfectamente. Gracias por tu tiempo. Si en el futuro..."
            />
          </div>

          {/* Question — handled by AI agent in real-time */}
          <div className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <p className="text-xs" style={{ color: C.textMuted }}>
              <strong>Questions:</strong> When a lead asks a question, the AI agent responds automatically using your Company Bio data. No template needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
