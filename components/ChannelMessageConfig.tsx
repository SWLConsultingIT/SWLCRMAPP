"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import {
  Share2, Mail, Phone, Sparkles, Loader2,
  ThumbsUp, ThumbsDown, Maximize2, Minimize2,
} from "lucide-react";

const gold = C.gold;

// ── Types ──

export type StepMessage = {
  type: string;
  channel: string;
  label: string;
  /** Free-text prompt the client writes describing what THIS step should say. The
   * V7 Pro generator absorbs this + tone + lead context to write the actual
   * message at send-time, per lead. Source of truth in the new UX. */
  user_prompt?: string;
  /** Legacy: a written-out example message. Still saved for backwards-compat
   * with old campaigns and as a manual override / preview surface. */
  body: string;
  subject?: string;
};

export type AutoReplies = {
  /** Manual override / literal copy used when the lead replies positively. */
  positive: string;
  /** Manual override / literal copy used when the lead replies negatively. */
  negative: string;
  /** Free-text intent prompt — V7 Pro absorbs this + lead context to write
   * the actual reply per lead, mirroring the step prompts pattern. */
  positivePrompt?: string;
  negativePrompt?: string;
  question: string;
};

export type ChannelMessages = {
  /** Manual override / literal copy for the LinkedIn connection note. */
  connectionRequest?: string;
  /** Free-text intent prompt for the connection note. The V7 Pro generator
   * absorbs this + tone + lead context to write the actual note per lead. */
  connectionRequestPrompt?: string;
  steps: StepMessage[];
  autoReplies: AutoReplies;
};

type Props = {
  sequence: { channel: string; daysAfter: number }[];
  channelMessages: ChannelMessages;
  onChange: (msgs: ChannelMessages) => void;
  leadId?: string;
  /** Set for ICP-level generation (no specific lead) so the AI writes reusable templates. */
  icpProfileId?: string;
  language: string;
  /** Enrichment keys the rep ticked in SignalPicker — the AI is told to weave these in. */
  signals?: string[];
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

// Step descriptions — what each step is FOR (intent guidance, not template prescription).
// In the new prompt-per-step UX the user writes their own intent below; these are
// the contextual hint that sits above their textarea.
const typeDescriptionsByLocale: Record<"es" | "en", Record<string, string>> = {
  es: {
    LINKEDIN_INTRO_DM: "Primer mensaje real después de que aceptan la conexión. Decile a la AI qué querés transmitir.",
    LINKEDIN_FOLLOWUP: "Seguimiento sobre el mensaje anterior. ¿Qué ángulo nuevo querés traer? (data, caso, tendencia)",
    EMAIL_INTRO: "Primer email. Tendrá subject + body. ¿Qué pain conectar y qué CTA querés al final?",
    EMAIL_FOLLOWUP_CROSS: "Primer email después de tocarlos por otro canal. ¿Qué ángulo nuevo?",
    EMAIL_FOLLOWUP: "Email de seguimiento corto. ¿Qué pieza nueva de valor querés traer?",
    CALL_FIRST: "Script de llamada. ¿Qué tono, qué preguntas, qué pitch?",
    CALL_FOLLOWUP: "Script de seguimiento por teléfono. ¿Qué nuevo ángulo y cómo cerrar?",
  },
  en: {
    LINKEDIN_INTRO_DM: "First real message after they accept the connection. Tell the AI what you want this message to convey.",
    LINKEDIN_FOLLOWUP: "Follow-up to the previous message. What new angle should it bring? (data point, case, trend)",
    EMAIL_INTRO: "First email — will have subject + body. What pain to connect to, and what CTA at the end?",
    EMAIL_FOLLOWUP_CROSS: "First email after reaching out on another channel. What new angle?",
    EMAIL_FOLLOWUP: "Short follow-up email. What new value piece should it bring?",
    CALL_FIRST: "Call script. What tone, what questions, what pitch?",
    CALL_FOLLOWUP: "Follow-up call script. What new angle and how to close?",
  },
};

// Prompt-style placeholders. These show the user HOW to write their intent.
const typePlaceholdersByLocale: Record<"es" | "en", Record<string, string>> = {
  es: {
    LINKEDIN_INTRO_DM: "ej: Agradecé la conexión, mencioná que ayudamos a empresas de [industria] a [resultado], y proponé una charla de 15 min para ver si tiene sentido.",
    LINKEDIN_FOLLOWUP: "ej: Volvé al mensaje anterior con un dato concreto (ej: '6h/semana de tiempo recuperado' en una empresa similar), preguntá si les resuena.",
    EMAIL_INTRO: "ej: Subject corto y específico. Cuerpo: hook con un dato sobre su empresa, qué hacemos en una línea, conectá su pain con nuestra solución, una prueba social, CTA de 15 min.",
    EMAIL_FOLLOWUP_CROSS: "ej: Referenciá el ping de LinkedIn, traé un ángulo distinto (caso de cliente similar), CTA suave.",
    EMAIL_FOLLOWUP: "ej: Una pieza nueva de valor (artículo, dato, comparativa), volvé al CTA.",
    CALL_FIRST: "ej: Apertura cálida con su nombre y por qué llamás. Pregunta abierta sobre [tema]. Pitch en 2 líneas. Cierre proponiendo 15 min.",
    CALL_FOLLOWUP: "ej: Referenciá el contacto previo, traé un dato nuevo, cerrá pidiendo 15 min específicos esta semana.",
  },
  en: {
    LINKEDIN_INTRO_DM: "e.g. Thank them for connecting, mention we help [industry] companies achieve [outcome], propose a 15-min chat to see if it's relevant.",
    LINKEDIN_FOLLOWUP: "e.g. Refer back to the previous message with a concrete data point (e.g. '6h/week reclaimed at a similar company'), ask if it resonates.",
    EMAIL_INTRO: "e.g. Short, specific subject. Body: hook with a data point about their company, what we do in one line, connect their pain to our solution, one social proof, soft 15-min CTA.",
    EMAIL_FOLLOWUP_CROSS: "e.g. Reference the LinkedIn ping, bring a different angle (similar customer case), soft CTA.",
    EMAIL_FOLLOWUP: "e.g. One new piece of value (article, data point, comparison), bring the CTA back.",
    CALL_FIRST: "e.g. Warm opener with their name and why you're calling. Open question about [topic]. 2-line pitch. Close proposing 15 minutes.",
    CALL_FOLLOWUP: "e.g. Reference the previous contact, bring a new data point, close by asking for a specific 15-min slot this week.",
  },
};

const inlinePlaceholdersByLocale: Record<"es" | "en", Record<string, string>> = {
  es: {
    connectionRequest: "Hola [nombre], soy [vendedor] de SWL Consulting. Vi tu trabajo en [tema] y me gustaría conectar para intercambiar ideas.",
    subject: "Línea de asunto (max 60 caracteres)...",
    fallback: "Escribí tu mensaje...",
    replyPositive: "¡Excelente! Me alegra tu interés. Te propongo coordinar una llamada de 15 min...",
    replyNegative: "Entiendo perfectamente. Gracias por tu tiempo. Si en el futuro...",
  },
  en: {
    connectionRequest: "Hi [name], I'm [seller] from SWL Consulting. I saw your work on [topic] and I'd love to connect to share ideas.",
    subject: "Subject line (max 60 chars)...",
    fallback: "Write your message...",
    replyPositive: "Great! Glad you're interested. How about we book a quick 15-minute call...",
    replyNegative: "Totally understand. Thanks for your time. If in the future...",
  },
};

// ── Main Component ──

export default function ChannelMessageConfig({ sequence, channelMessages, onChange, leadId, icpProfileId, language, signals }: Props) {
  const { locale, t } = useLocale();
  const placeholderLocale: "es" | "en" = locale === "es" ? "es" : "en";
  const typePlaceholders = typePlaceholdersByLocale[placeholderLocale];
  const inlinePlaceholders = inlinePlaceholdersByLocale[placeholderLocale];
  const typeDescriptions = typeDescriptionsByLocale[placeholderLocale];
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const classified = classifySteps(sequence);

  // Ensure steps array matches sequence
  const steps = classified.map((cls, i) => channelMessages.steps?.[i] || {
    type: cls.type, channel: cls.channel, label: cls.label, body: "", subject: cls.hasSubject ? "" : undefined,
  });
  const autoReplies = channelMessages.autoReplies || { positive: "", negative: "", question: "" };

  function updateStep(idx: number, field: "body" | "subject" | "user_prompt", value: string) {
    const newSteps = [...steps];
    newSteps[idx] = { ...newSteps[idx], [field]: value };
    onChange({ ...channelMessages, steps: newSteps, autoReplies });
  }

  function updateAutoReply(field: keyof AutoReplies, value: string) {
    onChange({ ...channelMessages, steps, autoReplies: { ...autoReplies, [field]: value } });
  }

  // AI generation per field
  async function generateField(fieldType: string, idx?: number) {
    const key = `${fieldType}:${idx ?? ""}`;
    setAiLoading(key);
    try {
      const ch = idx !== undefined ? classified[idx]?.channel : "linkedin";
      const userPrompt =
        fieldType === "connectionNote"
          ? (channelMessages.connectionRequestPrompt ?? "")
          : fieldType === "replyPositive"
            ? (channelMessages.autoReplies?.positivePrompt ?? "")
            : fieldType === "replyNegative"
              ? (channelMessages.autoReplies?.negativePrompt ?? "")
              : idx !== undefined
                ? (channelMessages.steps?.[idx]?.user_prompt ?? "")
                : "";
      const res = await fetch("/api/campaigns/generate-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: ch || "linkedin", fieldType, idx, leadId, icpProfileId, language, signals, user_prompt: userPrompt, sequence_meta: sequence }),
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
            onChange({ ...channelMessages, steps: currentSteps, autoReplies: { ...currentReplies, [field]: data.content } });
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
          body: JSON.stringify({ channel: "linkedin", fieldType: "connectionNote", leadId, icpProfileId, language, signals, sequence_meta: sequence, user_prompt: channelMessages.connectionRequestPrompt ?? "" }),
        });
        const crData = await crRes.json();
        if (crData.content) connRequest = crData.content;
        onChange({ ...channelMessages, connectionRequest: connRequest, steps: [...allSteps], autoReplies: replies });
      }

      // Generate each step sequentially. Each one passes the user's prompt
      // for that step so the API can write the message to the user's intent.
      for (let i = 0; i < classified.length; i++) {
        const ft = stepToFieldType(classified[i].type);
        const stepUserPrompt = channelMessages.steps?.[i]?.user_prompt ?? "";
        const res = await fetch("/api/campaigns/generate-field", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: classified[i].channel, fieldType: ft, idx: i, leadId, icpProfileId, language, signals, user_prompt: stepUserPrompt, sequence_meta: sequence }),
        });
        const data = await res.json();
        if (data.content) {
          allSteps[i] = { ...allSteps[i], body: data.content, subject: data.subject || allSteps[i]?.subject };
          onChange({ ...channelMessages, connectionRequest: connRequest, steps: [...allSteps], autoReplies: replies });
        }
      }

      // Generate auto-replies
      for (const replyType of ["replyPositive", "replyNegative"] as const) {
        const promptField = replyType === "replyPositive" ? "positivePrompt" : "negativePrompt";
        const replyPrompt = (channelMessages.autoReplies && (channelMessages.autoReplies as Record<string, string | undefined>)[promptField]) ?? "";
        const res = await fetch("/api/campaigns/generate-field", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "linkedin", fieldType: replyType, leadId, icpProfileId, language, signals, user_prompt: replyPrompt }),
        });
        const data = await res.json();
        if (data.content) {
          const field = replyType === "replyPositive" ? "positive" : "negative";
          replies = { ...replies, [field]: data.content };
          onChange({ ...channelMessages, connectionRequest: connRequest, steps: [...allSteps], autoReplies: replies });
        }
      }
    } catch (err) {
      console.error("Generate all error:", err);
    }
    setAiLoading(null);
  }

  // Map step classification → AI fieldType. Our API expects the uppercase step type
  // directly (LINKEDIN_INTRO_DM, EMAIL_INTRO, CALL_FIRST, etc.).
  function stepToFieldType(type: string): string {
    const valid = new Set([
      "LINKEDIN_INTRO_DM", "LINKEDIN_FOLLOWUP",
      "EMAIL_INTRO", "EMAIL_FOLLOWUP_CROSS", "EMAIL_FOLLOWUP",
      "CALL_FIRST", "CALL_FOLLOWUP",
    ]);
    return valid.has(type) ? type : "LINKEDIN_FOLLOWUP";
  }

  // Cumulative days
  let cumDay = 0;
  const dayPerStep = sequence.map((s, i) => {
    cumDay += i === 0 ? 0 : s.daysAfter;
    return cumDay;
  });

  return (
    <div className="space-y-4">
      {/* ═══ AI ASSISTANT — preview generation using your prompts ═══ */}
      <div
        className="rounded-2xl border px-5 py-4 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 5%, var(--c-card)) 0%, var(--c-card) 100%)`,
          borderColor: `color-mix(in srgb, ${gold} 22%, transparent)`,
          boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 14%, transparent), color-mix(in srgb, ${gold} 4%, transparent))`,
                border: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
                boxShadow: `0 0 14px color-mix(in srgb, ${gold} 16%, transparent)`,
              }}
            >
              <Sparkles size={16} style={{ color: gold }} />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("wiz.gen.title")}</p>
              <p className="text-[11px]" style={{ color: C.textMuted }}>
                {t("wiz.gen.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={generateAll}
            disabled={!!aiLoading}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-[opacity,transform,box-shadow] duration-150 shrink-0 disabled:opacity-50 hover:opacity-95"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`,
              color: "#04070d",
              boxShadow: `0 2px 12px color-mix(in srgb, ${gold} 28%, transparent)`,
            }}
          >
            {aiLoading === "all" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {aiLoading === "all" ? t("wiz.gen.previewing") : t("wiz.gen.previewAll")}
          </button>
        </div>
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
                <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("wiz.connReq.title")}</span>
                <p className="text-xs" style={{ color: C.textMuted }}>{t("wiz.connReq.desc")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleExpand("conn")} title={expanded.has("conn") ? "Collapse" : "Expand"}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-opacity hover:opacity-80"
                style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}>
                {expanded.has("conn") ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
              </button>
              <button onClick={() => generateField("connectionNote", undefined)} disabled={!!aiLoading}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
                style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                {aiLoading === "connectionNote:" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                AI
              </button>
            </div>
          </div>
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs" style={{ color: C.textMuted }}>{t("wiz.connReq.hint")}</p>

            {/* PRIMARY: the message. AI generation lands here. Always editable. */}
            <textarea
              rows={expanded.has("conn") ? 10 : 2}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={channelMessages.connectionRequest || ""}
              onChange={e => onChange({ ...channelMessages, connectionRequest: e.target.value })}
              placeholder={inlinePlaceholders.connectionRequest}
            />
            <p className="text-xs text-right" style={{ color: (channelMessages.connectionRequest?.length || 0) > 300 ? C.red : C.textDim }}>
              {channelMessages.connectionRequest?.length || 0}/300
            </p>

            {/* SECONDARY: small prompt helper for AI — optional. */}
            <div className="pt-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={10} style={{ color: gold }} />
                <label className="text-[10px] font-semibold" style={{ color: C.textMuted }}>
                  {t("wiz.step.promptHelper")}
                </label>
              </div>
              <textarea
                rows={2}
                className="w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none resize-none"
                style={{
                  borderColor: `color-mix(in srgb, ${gold} 18%, transparent)`,
                  color: C.textPrimary,
                  backgroundColor: `color-mix(in srgb, ${gold} 2%, var(--c-bg))`,
                }}
                value={channelMessages.connectionRequestPrompt ?? ""}
                onChange={e => onChange({ ...channelMessages, connectionRequestPrompt: e.target.value })}
                placeholder={locale === "es"
                  ? "ej: Mencionar que vimos su perfil, presentación corta y por qué queremos conectar."
                  : "e.g. Mention we saw their profile, short intro, and why we want to connect."
                }
              />
              <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>
                {t("wiz.step.promptHelperHint")}
              </p>
            </div>
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums font-medium" style={{ color: C.textDim }}>Day {dayPerStep[i]}</span>
                    <button onClick={() => toggleExpand(`step-${i}`)} title={expanded.has(`step-${i}`) ? "Collapse" : "Expand"}
                      className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-opacity hover:opacity-80"
                      style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}>
                      {expanded.has(`step-${i}`) ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                    </button>
                    <button onClick={() => generateField(fieldType, i)} disabled={!!aiLoading}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                      {aiLoading === loadingKey ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      AI
                    </button>
                  </div>
                </div>

                {/* Description (intent guidance) */}
                <div className="px-5 pt-3">
                  <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
                    {typeDescriptions[cls.type] || "Write what this message should say."}
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
                      placeholder={inlinePlaceholders.subject}
                    />
                  )}

                  {/* PRIMARY: the message. AI generation lands here. Always editable. */}
                  <textarea
                    rows={expanded.has(`step-${i}`) ? 18 : (cls.type === "EMAIL_INTRO" ? 7 : cls.type.includes("CALL") ? 6 : 5)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                    style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                    value={step?.body || ""}
                    onChange={e => updateStep(i, "body", e.target.value)}
                    placeholder={inlinePlaceholders.fallback}
                  />

                  {/* SECONDARY: small prompt helper for AI — optional. */}
                  <div className="pt-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Sparkles size={10} style={{ color: gold }} />
                      <label className="text-[10px] font-semibold" style={{ color: C.textMuted }}>
                        {t("wiz.step.promptHelper")}
                      </label>
                    </div>
                    <textarea
                      rows={2}
                      className="w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none resize-none"
                      style={{
                        borderColor: `color-mix(in srgb, ${gold} 18%, transparent)`,
                        color: C.textPrimary,
                        backgroundColor: `color-mix(in srgb, ${gold} 2%, var(--c-bg))`,
                      }}
                      value={step?.user_prompt ?? ""}
                      onChange={e => updateStep(i, "user_prompt", e.target.value)}
                      placeholder={typePlaceholders[cls.type] || t("wiz.step.promptHelperPlaceholder")}
                    />
                    <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>
                      {t("wiz.step.promptHelperHint")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ AUTO-REPLIES (reactive, separate) ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("wiz.replies.title")}</p>
          <p className="text-xs" style={{ color: C.textMuted }}>{t("wiz.replies.desc")}</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Positive */}
          <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: C.border, backgroundColor: `${C.green}04` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ThumbsUp size={14} style={{ color: C.green }} />
                <p className="text-xs font-semibold" style={{ color: C.green }}>{t("wiz.replies.posTitle")}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => toggleExpand("replyPositive")} title={expanded.has("replyPositive") ? "Collapse" : "Expand"}
                  className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-black/5"
                  style={{ color: C.textMuted }}>
                  {expanded.has("replyPositive") ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                </button>
                <button onClick={() => generateField("replyPositive")} disabled={!!aiLoading}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                  style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                  {aiLoading === "replyPositive:" ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} AI
                </button>
              </div>
            </div>
            <p className="text-xs mb-2" style={{ color: C.textMuted }}>{t("wiz.replies.posHint")}</p>

            {/* PRIMARY: the reply message. AI lands here. Editable. */}
            <textarea rows={expanded.has("replyPositive") ? 10 : 3}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
              value={autoReplies.positive}
              onChange={e => updateAutoReply("positive", e.target.value)}
              placeholder={inlinePlaceholders.replyPositive}
            />

            {/* SECONDARY: small prompt helper — optional. */}
            <div className="pt-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={10} style={{ color: gold }} />
                <label className="text-[10px] font-semibold" style={{ color: C.textMuted }}>
                  {t("wiz.step.promptHelper")}
                </label>
              </div>
              <textarea
                rows={2}
                className="w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none resize-none"
                style={{
                  borderColor: `color-mix(in srgb, ${gold} 18%, transparent)`,
                  color: C.textPrimary,
                  backgroundColor: `color-mix(in srgb, ${gold} 2%, var(--c-card))`,
                }}
                value={autoReplies.positivePrompt ?? ""}
                onChange={e => updateAutoReply("positivePrompt", e.target.value)}
                placeholder={t("wiz.replies.posPromptPlaceholder")}
              />
              <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{t("wiz.step.promptHelperHint")}</p>
            </div>
          </div>

          {/* Negative */}
          <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: C.border, backgroundColor: `${C.red}04` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ThumbsDown size={14} style={{ color: C.red }} />
                <p className="text-xs font-semibold" style={{ color: C.red }}>{t("wiz.replies.negTitle")}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => toggleExpand("replyNegative")} title={expanded.has("replyNegative") ? "Collapse" : "Expand"}
                  className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-black/5"
                  style={{ color: C.textMuted }}>
                  {expanded.has("replyNegative") ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                </button>
                <button onClick={() => generateField("replyNegative")} disabled={!!aiLoading}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                  style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                  {aiLoading === "replyNegative:" ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} AI
                </button>
              </div>
            </div>
            <p className="text-xs mb-2" style={{ color: C.textMuted }}>{t("wiz.replies.negHint")}</p>

            {/* PRIMARY: the reply message. */}
            <textarea rows={expanded.has("replyNegative") ? 10 : 2}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
              value={autoReplies.negative}
              onChange={e => updateAutoReply("negative", e.target.value)}
              placeholder={inlinePlaceholders.replyNegative}
            />

            {/* SECONDARY: small prompt helper — optional. */}
            <div className="pt-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={10} style={{ color: gold }} />
                <label className="text-[10px] font-semibold" style={{ color: C.textMuted }}>
                  {t("wiz.step.promptHelper")}
                </label>
              </div>
              <textarea
                rows={2}
                className="w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none resize-none"
                style={{
                  borderColor: `color-mix(in srgb, ${gold} 18%, transparent)`,
                  color: C.textPrimary,
                  backgroundColor: `color-mix(in srgb, ${gold} 2%, var(--c-card))`,
                }}
                value={autoReplies.negativePrompt ?? ""}
                onChange={e => updateAutoReply("negativePrompt", e.target.value)}
                placeholder={t("wiz.replies.negPromptPlaceholder")}
              />
              <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{t("wiz.step.promptHelperHint")}</p>
            </div>
          </div>

          {/* Question — handled by AI agent in real-time */}
          <div className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <p className="text-xs" style={{ color: C.textMuted }}>
              {t("wiz.replies.questions")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
