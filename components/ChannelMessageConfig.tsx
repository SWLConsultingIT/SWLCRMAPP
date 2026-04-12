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
  connectionRequest?: string;
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
      // Connection request is handled separately — all LinkedIn steps here are DMs
      if (nth === 1) {
        if (!introduced) { introduced = true; return { type: "LINKEDIN_INTRO_DM", channel: s.channel, label: "First DM (Post-Connection)", hasSubject: false }; }
        return { type: "LINKEDIN_FOLLOWUP", channel: s.channel, label: "LinkedIn Follow-up 1", hasSubject: false };
      }
      return { type: "LINKEDIN_FOLLOWUP", channel: s.channel, label: `LinkedIn Follow-up ${introduced ? nth - 1 : nth}`, hasSubject: false };
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
  LINKEDIN_INTRO_DM: "First real message after they accept. Start with 'Gracias por conectar'. Introduce yourself, your company, what you offer, and ask if interested.",
  LINKEDIN_FOLLOWUP: "Follow-up message. Reference your previous message, bring new value (data, case study, trend). Don't re-introduce yourself.",
  EMAIL_INTRO: "First email. Subject + body. Introduce yourself and your company, connect their pain point to your solution, include proof, end with CTA.",
  EMAIL_FOLLOWUP_CROSS: "First email after contacting on another channel. Reference previous outreach, bring a new angle.",
  EMAIL_FOLLOWUP: "Follow-up email. Short, reference previous email, one new piece of value.",
  CALL_FIRST: "Call script in bullet points: Opener, Context, Questions, Pitch, Close.",
  CALL_FOLLOWUP: "Follow-up call script. Reference previous contact, new angle, ask for meeting.",
};

const typePlaceholders: Record<string, string> = {
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
      const ch = idx !== undefined ? classified[idx]?.channel : "linkedin";
      const res = await fetch("/api/campaigns/generate-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: ch || "linkedin", fieldType, idx, leadId, language }),
      });
      const data = await res.json();
      if (data.content) {
        // Build fresh steps from current channelMessages to avoid stale closures
        const currentSteps = classified.map((cls, i) => channelMessages.steps?.[i] || {
          type: cls.type, channel: cls.channel, label: cls.label, body: "", subject: cls.hasSubject ? "" : undefined,
        });
        const currentReplies = channelMessages.autoReplies || { positive: "", negative: "", question: "" };

        if (fieldType === "connectionNote") {
          // Connection request is a separate field
          onChange({ ...channelMessages, connectionRequest: data.content, steps: currentSteps, autoReplies: currentReplies });
        } else if (idx !== undefined) {
          currentSteps[idx] = {
            ...currentSteps[idx],
            body: data.content,
            subject: data.subject || currentSteps[idx]?.subject,
          };
          onChange({ ...channelMessages, steps: currentSteps, autoReplies: currentReplies });
        } else {
          // Auto-reply field
          const replyMap: Record<string, string> = { replyPositive: "positive", replyNegative: "negative" };
          const field = replyMap[fieldType];
          if (field) {
            onChange({ steps: currentSteps, autoReplies: { ...currentReplies, [field]: data.content } });
          }
        }
      }
    } catch (err) {
      console.error("AI generation error:", err);
    }
    setAiLoading(null);
  }

  // Generate ALL fields at once
  async function generateAll() {
    setAiLoading("all");
    try {
      // Build working copy of steps
      const allSteps = classified.map((cls, i) => channelMessages.steps?.[i] || {
        type: cls.type, channel: cls.channel, label: cls.label, body: "", subject: cls.hasSubject ? "" : undefined,
      });
      let replies = { ...(channelMessages.autoReplies || { positive: "", negative: "", question: "" }) };

      // Generate connection request if LinkedIn is in sequence
      let connRequest = channelMessages.connectionRequest || "";
      if (sequence.some(s => s.channel === "linkedin")) {
        const crRes = await fetch("/api/campaigns/generate-field", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "linkedin", fieldType: "connectionNote", leadId, language }),
        });
        const crData = await crRes.json();
        if (crData.content) {
          connRequest = crData.content;
          onChange({ ...channelMessages, connectionRequest: connRequest, steps: [...allSteps], autoReplies: replies });
        }
      }

      // Generate each step sequentially
      for (let i = 0; i < classified.length; i++) {
        const ft = stepToFieldType(classified[i].type);
        const res = await fetch("/api/campaigns/generate-field", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: classified[i].channel, fieldType: ft, idx: i, leadId, language }),
        });
        const data = await res.json();
        if (data.content) {
          allSteps[i] = { ...allSteps[i], body: data.content, subject: data.subject || allSteps[i]?.subject };
          onChange({ steps: [...allSteps], autoReplies: replies });
        }
      }

      // Generate auto-replies
      for (const replyType of ["replyPositive", "replyNegative"] as const) {
        const res = await fetch("/api/campaigns/generate-field", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "linkedin", fieldType: replyType, leadId, language }),
        });
        const data = await res.json();
        if (data.content) {
          const field = replyType === "replyPositive" ? "positive" : "negative";
          replies = { ...replies, [field]: data.content };
          onChange({ steps: [...allSteps], autoReplies: replies });
        }
      }
    } catch (err) {
      console.error("Generate all error:", err);
    }
    setAiLoading(null);
  }

  // Map step type to AI fieldType
  function stepToFieldType(type: string): string {
    const map: Record<string, string> = {
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
      {/* ═══ GENERATE ALL ═══ */}
      <div className="rounded-xl border px-5 py-4 flex items-center justify-between"
        style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center gap-3">
          <Sparkles size={18} style={{ color: gold }} />
          <div>
            <p className="text-sm font-medium" style={{ color: C.textPrimary }}>AI Message Assistant</p>
            <p className="text-xs" style={{ color: C.textMuted }}>Auto-fill all outreach messages and auto-replies using company & lead data</p>
          </div>
        </div>
        <button onClick={generateAll} disabled={!!aiLoading}
          className="flex items-center gap-2 rounded-lg px-5 py-2 text-xs font-semibold transition-opacity shrink-0 disabled:opacity-50"
          style={{ backgroundColor: gold, color: "#04070d" }}>
          {aiLoading === "all" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {aiLoading === "all" ? "Generating..." : "Generate All with AI"}
        </button>
      </div>

      {/* ═══ LINKEDIN CONNECTION REQUEST (always shown if LinkedIn is in sequence) ═══ */}
      {sequence.some(s => s.channel === "linkedin") && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.linkedin}` }}>
          <div className="px-5 py-3 flex items-center justify-between border-b"
            style={{ borderColor: C.border, background: `${C.linkedin}06` }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: C.linkedin }}>
                <Share2 size={14} color="#fff" />
              </div>
              <div>
                <span className="text-sm font-bold" style={{ color: C.textPrimary }}>LinkedIn Connection Request</span>
                <p className="text-xs" style={{ color: C.textMuted }}>Sent when requesting to connect. The orchestrator skips this if already connected.</p>
              </div>
            </div>
            <button onClick={() => generateField("connectionNote", undefined)} disabled={!!aiLoading}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: `${gold}15`, color: gold }}>
              {aiLoading === "connectionNote:" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              AI
            </button>
          </div>
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs" style={{ color: C.textMuted }}>Short note: who you are + why you want to connect. Max 300 characters.</p>
            <textarea
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={channelMessages.connectionRequest || ""}
              onChange={e => onChange({ ...channelMessages, connectionRequest: e.target.value })}
              placeholder="Hola [nombre], soy [vendedor] de SWL Consulting. Vi tu trabajo en [tema] y me gustaría conectar para intercambiar ideas."
            />
            <p className="text-xs text-right" style={{ color: (channelMessages.connectionRequest?.length || 0) > 300 ? C.red : C.textDim }}>
              {channelMessages.connectionRequest?.length || 0}/300
            </p>
          </div>
        </div>
      )}

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
