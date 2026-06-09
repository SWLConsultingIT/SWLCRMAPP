"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import {
  Share2, Mail, Phone, MessageCircle, Sparkles, Loader2,
  ThumbsUp, ThumbsDown, Maximize2, Minimize2, Plus, ChevronUp, ChevronDown,
  AlertTriangle, Tag,
} from "lucide-react";
import StepAttachments, { type StepAttachment } from "@/components/StepAttachments";
import { PLACEHOLDER_GROUPS, unsupportedPlaceholdersIn, findSuspiciousPlaceholders, autoFixPlaceholders, findTailoredSlots } from "@/lib/placeholders";

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
  sequence: { channel: string; daysAfter: number; attachments?: StepAttachment[] }[];
  channelMessages: ChannelMessages;
  onChange: (msgs: ChannelMessages) => void;
  leadId?: string;
  /** Set for ICP-level generation (no specific lead) so the AI writes reusable templates. */
  icpProfileId?: string;
  language: string;
  /** Wizard flow mode. "tailored" tells the AI to embed {{tailored:hook}}
   * and {{tailored:fit}} slots in the templates so the post-approve
   * tailor pass can swap in per-lead copy at send time. */
  flowType?: "generic" | "tailored";
  /** Enrichment keys the rep ticked in SignalPicker — the AI is told to weave these in. */
  signals?: string[];
  /** Update attachments on sequence[stepIdx]. Optional so the component still
   * renders standalone (e.g. in template preview) without an attachment editor. */
  onAttachmentsChange?: (stepIdx: number, attachments: StepAttachment[]) => void;
  /** Reorder a step. When provided, the wizard shows ↑/↓ controls on each
   *  step header so sellers can swap step order without destroying the body.
   *  The caller is responsible for swapping BOTH `sequence` and
   *  `channelMessages.steps` so positions stay aligned. */
  onReorderStep?: (fromIdx: number, toIdx: number) => void;
};

// ── Helpers ──

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2,         color: C.linkedin, label: "LinkedIn" },
  email:    { icon: Mail,           color: C.email,    label: "Email" },
  call:     { icon: Phone,          color: C.phone,    label: "Call" },
  whatsapp: { icon: MessageCircle,  color: "#25D366",  label: "WhatsApp" },
};

// LinkedIn invite notes cap at 200 chars POST placeholder interpolation.
// If the AI returns 220 chars of template, expansion can push it to ~250+
// and the dispatcher will reject it (post 2026-05-11 dispatcher patch).
// Clamp client-side at the budget, cutting at the last sentence boundary
// so the text reads naturally instead of mid-word.
function clampToCharBudget(text: string, budget: number): string {
  if (!text) return text;
  if (text.length <= budget) return text;
  const trimmed = text.slice(0, budget);
  const lastPunct = Math.max(
    trimmed.lastIndexOf("."),
    trimmed.lastIndexOf("?"),
    trimmed.lastIndexOf("!"),
  );
  if (lastPunct > Math.floor(budget * 0.6)) return trimmed.slice(0, lastPunct + 1).trimEnd();
  const lastSpace = trimmed.lastIndexOf(" ");
  return (lastSpace > 30 ? trimmed.slice(0, lastSpace) : trimmed).trimEnd() + "…";
}

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
      if (nth === 1) return { type: "EMAIL_FOLLOWUP_CROSS", channel: s.channel, label: "Email follow-up (after other channel)", hasSubject: true };
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

// Tenant-agnostic placeholder examples. We avoid mentioning a specific company
// name (e.g. "SWL Consulting") so the wizard reads correctly for any client tenant.
const inlinePlaceholdersByLocale: Record<"es" | "en", Record<string, string>> = {
  es: {
    connectionRequest: "Hola [nombre], soy [vendedor] de [empresa]. Vi tu trabajo en [tema] y me gustaría conectar para intercambiar ideas.",
    subject: "Línea de asunto (max 60 caracteres)...",
    fallback: "Escribí tu mensaje...",
    replyPositive: "¡Excelente! Me alegra tu interés. Te propongo coordinar una llamada de 15 min...",
    replyNegative: "Entiendo perfectamente. Gracias por tu tiempo. Si en el futuro...",
  },
  en: {
    connectionRequest: "Hi [name], I'm [seller] from [company]. I saw your work on [topic] and I'd love to connect to share ideas.",
    subject: "Subject line (max 60 chars)...",
    fallback: "Write your message...",
    replyPositive: "Great! Glad you're interested. How about we book a quick 15-minute call...",
    replyNegative: "Totally understand. Thanks for your time. If in the future...",
  },
};

// ── Main Component ──

// Collapsible reference for the placeholders the dispatcher supports + a
// live warning if any body contains a `{{…}}` we won't render. Click any
// token to copy.
//
// 2026-05-27 (PE Spain): two camelCase `{{firstName}}` shipped raw to
//   8 leads. → Added unsupportedPlaceholdersIn() warning.
// 2026-05-31 (Craig Wilson): a LinkedIn DM shipped with literal
//   `[First Name]` because the bracket form bypassed every check.
//   → Added findSuspiciousPlaceholders() detection here + a one-click
//   "Auto-fix" button that rewrites every recognised foreign token to
//   its canonical {{snake_case}} form. The button calls back into the
//   parent so the actual message bodies update in state.
function PlaceholdersHint({
  bodies,
  onAutoFix,
}: {
  bodies: string[];
  /** Called when the operator clicks the "Auto-fix" button. The parent
   *  decides how to apply the rewrite (each body has different state).
   *  We pass a function that maps the original body to its normalized
   *  form — parent picks which slot each body belongs to. */
  onAutoFix?: (rewriter: (body: string) => string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const allText = bodies.join("\n");
  const bad = unsupportedPlaceholdersIn(allText);
  const suspicious = findSuspiciousPlaceholders(allText);
  // How many tokens the one-click fix can resolve (foreign syntax +
  // valid-but-unsupported {{…}} like {{seller}} → {{seller_name}}).
  const autoFixable = autoFixPlaceholders(allText).changes.length;

  function copy(token: string) {
    try {
      navigator.clipboard.writeText(token);
      setCopied(token);
      setTimeout(() => setCopied(c => (c === token ? null : c)), 1200);
    } catch { /* ignore */ }
  }

  const hasProblem = bad.length > 0 || suspicious.length > 0;
  return (
    <div className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: hasProblem ? "color-mix(in srgb, #DC2626 5%, var(--c-card))" : C.card,
        borderColor: hasProblem ? "color-mix(in srgb, #DC2626 35%, var(--c-border))" : C.border,
      }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center gap-2.5 text-left transition-colors hover:bg-black/[0.02]">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{
            backgroundColor: hasProblem ? "color-mix(in srgb, #DC2626 14%, transparent)" : `color-mix(in srgb, ${gold} 12%, transparent)`,
            color: hasProblem ? "#DC2626" : gold,
          }}>
          {hasProblem ? <AlertTriangle size={13} /> : <Tag size={13} />}
        </div>
        <div className="flex-1 min-w-0">
          {suspicious.length > 0 ? (
            <>
              <p className="text-[12px] font-bold" style={{ color: "#DC2626" }}>
                Foreign placeholder syntax detected — the dispatcher won&apos;t render these
              </p>
              <p className="text-[10px]" style={{ color: C.textMuted }}>
                Found: <span className="font-mono">{suspicious.slice(0, 6).map(s => s.token).join(", ")}{suspicious.length > 6 ? ` +${suspicious.length - 6} more` : ""}</span>.
                Use <span className="font-mono">{"{{first_name}}"}</span>, <span className="font-mono">{"{{company_name}}"}</span> etc. — not <span className="font-mono">[First Name]</span> or <span className="font-mono">%FIRST_NAME%</span>.
              </p>
            </>
          ) : bad.length > 0 ? (
            <>
              <p className="text-[12px] font-bold" style={{ color: "#DC2626" }}>
                Unsupported placeholders in your messages — fix before launch
              </p>
              <p className="text-[10px]" style={{ color: C.textMuted }}>
                These tokens won&apos;t render and the dispatcher will refuse to send: <span className="font-mono">{bad.join(", ")}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-[12px] font-bold" style={{ color: C.textPrimary }}>
                Supported placeholders {open ? "" : "(click to expand)"}
              </p>
              <p className="text-[10px]" style={{ color: C.textMuted }}>
                Use any of these in the message body or subject — they&apos;ll be replaced per-lead at send time.
              </p>
            </>
          )}
        </div>
        {autoFixable > 0 && onAutoFix && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAutoFix((body) => autoFixPlaceholders(body).normalized);
            }}
            className="shrink-0 text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-85"
            style={{ backgroundColor: gold, color: "#1A1A2E" }}
            title={`Rewrite ${autoFixable} token${autoFixable === 1 ? "" : "s"} to the correct {{placeholder}}`}
          >
            Fix automatically ({autoFixable})
          </button>
        )}
        {open ? <ChevronUp size={14} style={{ color: C.textMuted }} /> : <ChevronDown size={14} style={{ color: C.textMuted }} />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3"
          style={{ borderTop: `1px solid ${C.border}` }}>
          {PLACEHOLDER_GROUPS.map(g => {
            // Tailored AI slots get the gold pill + sparkle treatment so
            // the seller can tell at a glance they're AI-filled per lead,
            // not static substitution. Detection is structural (any token
            // starting with `{{tailored:` or `{{tailored` camelCase) to
            // future-proof against new slot names.
            const isTailored = g.tokens.some(t => /^\{\{tailored/i.test(t));
            return (
            <div key={g.label} className="rounded-lg p-2.5"
              style={{
                backgroundColor: isTailored ? `color-mix(in srgb, ${gold} 6%, transparent)` : C.bg,
                border: `1px solid ${isTailored ? `color-mix(in srgb, ${gold} 35%, transparent)` : C.border}`,
              }}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-[11px] font-bold" style={{ color: isTailored ? gold : C.textPrimary }}>{g.label}</p>
                {isTailored && (
                  <span className="text-[8.5px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                    style={{ backgroundColor: gold, color: "#1A1A2E" }}>
                    AI · per lead
                  </span>
                )}
              </div>
              <p className="text-[10px] mb-1.5" style={{ color: C.textMuted }}>{g.description}</p>
              <div className="flex flex-wrap gap-1">
                {g.tokens.map(tok => (
                  <button key={tok} onClick={() => copy(tok)}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border transition-[background-color,color]"
                    style={{
                      borderColor: copied === tok ? gold : (isTailored ? `color-mix(in srgb, ${gold} 50%, transparent)` : C.border),
                      color: copied === tok || isTailored ? gold : C.textBody,
                      backgroundColor: copied === tok ? `color-mix(in srgb, ${gold} 15%, transparent)` : (isTailored ? `color-mix(in srgb, ${gold} 4%, var(--c-card))` : C.card),
                    }}
                    title={isTailored ? "Click to copy. AI fills this per lead at campaign approve (one Haiku call per lead × first-touch step)." : "Click to copy"}>
                    {copied === tok ? "Copied!" : tok}
                  </button>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ChannelMessageConfig({ sequence, channelMessages, onChange, leadId, icpProfileId, language, flowType = "generic", signals, onAttachmentsChange, onReorderStep }: Props) {
  const { locale, t } = useLocale();
  const placeholderLocale: "es" | "en" = locale === "es" ? "es" : "en";
  const typePlaceholders = typePlaceholdersByLocale[placeholderLocale];
  const inlinePlaceholders = inlinePlaceholdersByLocale[placeholderLocale];
  const typeDescriptions = typeDescriptionsByLocale[placeholderLocale];
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // Helper that turns whatever the API returns (string, nested object,
  // nothing) into a readable message — without this we got
  // "[object Object]" in the wizard banner when the V8 webhook
  // returned an error object instead of a string.
  function readableErr(data: any, status: number): string {
    if (!data) return `HTTP ${status}`;
    const raw = data.error ?? data.message ?? data;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      if (typeof raw.message === "string") return raw.message;
      if (typeof raw.error === "string") return raw.error;
      try { return JSON.stringify(raw).slice(0, 300); } catch { return `HTTP ${status}`; }
    }
    return `HTTP ${status}`;
  }
  // Generate All progress — shown in the button while the multi-call loop
  // runs so sellers don't think the page is frozen during the ~20-30s wait.
  const [genProgress, setGenProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // AI prompt is hidden by default to declutter each step card. Auto-expands
  // when there's existing content so users with saved prompts always see them.
  const [aiPromptOpen, setAiPromptOpen] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const toggleAiPrompt = (key: string) => setAiPromptOpen(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const isAiPromptOpen = (key: string, content: string | undefined | null) =>
    aiPromptOpen.has(key) || (content !== undefined && content !== null && content.length > 0);

  // DISPLAY-ONLY CR slice. When sequence[0] is a LinkedIn day-0 step, that
  // entry is the Connection Request — its body lives in
  // channelMessages.connectionRequest, NOT in the numbered list. We hide that
  // row from the numbered display and classify the remaining followups as if
  // sequence[1] were the first message (so an email at sequence[1] gets the
  // "Introduction Email" label, not "Email follow-up (after other channel)").
  //
  // CRITICAL: storage indices stay 1:1 with sequence — channelMessages.steps[i]
  // is always the body for sequence[i]. The dispatcher depends on this. Only
  // the RENDER skips index 0 when hasCR. All updateStep / generateField /
  // onReorderStep / onAttachmentsChange calls pass the REAL sequence index.
  const hasCR = sequence[0]?.channel === "linkedin" && sequence[0]?.daysAfter === 0;
  const followupSequence = hasCR ? sequence.slice(1) : sequence;
  const classifiedFU = classifySteps(followupSequence);
  // Full-length labels aligned with sequence positions. CR slot (i=0 when
  // hasCR) gets a placeholder — never rendered, never written to.
  const classified = sequence.map((s, i) => {
    if (hasCR && i === 0) {
      return { type: "CR_SLOT", channel: s.channel, label: "Connection Request", hasSubject: false };
    }
    const j = hasCR ? i - 1 : i;
    return classifiedFU[j] ?? { type: "UNKNOWN", channel: s.channel, label: "Message", hasSubject: false };
  });

  // Ensure steps array matches sequence positionally (storage contract).
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
    setAiError(null);
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
        body: JSON.stringify({ channel: ch || "linkedin", fieldType, idx, leadId, icpProfileId, language, flowType, signals, user_prompt: userPrompt, sequence_meta: sequence }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = readableErr(data, res.status);
        console.error("[AI generate]", msg, data);
        setAiError(`AI couldn't draft this step: ${msg}`);
        setAiLoading(null);
        return;
      }
      if (data.content) {
        // Build fresh steps from current channelMessages to avoid stale closures
        const currentSteps = classified.map((cls, i) => channelMessages.steps?.[i] || {
          type: cls.type, channel: cls.channel, label: cls.label, body: "", subject: cls.hasSubject ? "" : undefined,
        });
        const currentReplies = channelMessages.autoReplies || { positive: "", negative: "", question: "" };

        if (fieldType === "connectionNote") {
          // Connection request is a separate field. Even though V7 Pro's
          // Sanitize Output v2 caps at 195 chars projected, ENFORCE here too —
          // (a) belt-and-braces if the workflow ever drifts, (b) keeps the
          // wizard internally consistent with the 200-char textarea maxLength.
          const trimmed = clampToCharBudget(data.content, 200);
          onChange({ ...channelMessages, connectionRequest: trimmed, steps: currentSteps, autoReplies: currentReplies });
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
      const msg = err instanceof Error ? err.message : String(err);
      console.error("AI generation error:", err);
      setAiError(`Network error reaching AI: ${msg}`);
    }
    setAiLoading(null);
  }

  // Generate ALL fields at once. Reports per-step progress through
  // `genProgress` so the button can show "Step 3 of 6 · Email Follow-up"
  // instead of an unbounded spinner. Stops the "is it frozen?" worry
  // sellers reported on 20-30s waits.
  async function generateAll() {
    const hasLinkedin = sequence.some(s => s.channel === "linkedin");
    const replyTypes = hasLinkedin ? (["replyPositive", "replyNegative"] as const) : ([] as const);
    // Followup count excludes the CR slot — that's generated separately as the
    // Connection Request, not via the per-step loop.
    const followupCount = hasCR ? classified.length - 1 : classified.length;
    const totalSteps = (hasLinkedin ? 1 : 0) + followupCount + replyTypes.length;
    let stepIndex = 0;

    setAiLoading("all");
    setAiError(null);
    setGenProgress({ current: 0, total: totalSteps, label: "Starting…" });

    let failedLabel: string | null = null;
    let failedReason: string | null = null;

    try {
      // Build working copy of steps
      const allSteps = classified.map((cls, i) => channelMessages.steps?.[i] || {
        type: cls.type, channel: cls.channel, label: cls.label, body: "", subject: cls.hasSubject ? "" : undefined,
      });
      let replies = { ...(channelMessages.autoReplies || { positive: "", negative: "", question: "" }) };

      // Generate connection request if LinkedIn is in sequence
      let connRequest = channelMessages.connectionRequest || "";
      if (hasLinkedin) {
        stepIndex++;
        setGenProgress({ current: stepIndex, total: totalSteps, label: "Connection request" });
        try {
          const crRes = await fetch("/api/campaigns/generate-field", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: "linkedin", fieldType: "connectionNote", leadId, icpProfileId, language, flowType, signals, sequence_meta: sequence, user_prompt: channelMessages.connectionRequestPrompt ?? "" }),
          });
          const crData = await crRes.json().catch(() => ({}));
          if (!crRes.ok) {
            failedLabel = "Connection request";
            failedReason = readableErr(crData, crRes.status);
          } else {
            if (crData.content) connRequest = clampToCharBudget(crData.content, 200);
            onChange({ ...channelMessages, connectionRequest: connRequest, steps: [...allSteps], autoReplies: replies });
          }
        } catch (e: any) {
          failedLabel = "Connection request";
          failedReason = e?.message ?? "network error";
        }
      }

      // Generate each step sequentially. Each one passes the user's prompt
      // for that step so the API can write the message to the user's intent.
      // Skip the CR slot (i=0 when hasCR) — that body lives in connectionRequest,
      // not in the numbered list.
      for (let i = 0; i < classified.length; i++) {
        if (failedLabel) break;
        if (hasCR && i === 0) continue;
        stepIndex++;
        setGenProgress({ current: stepIndex, total: totalSteps, label: classified[i].label });
        const ft = stepToFieldType(classified[i].type);
        const stepUserPrompt = channelMessages.steps?.[i]?.user_prompt ?? "";
        try {
          const res = await fetch("/api/campaigns/generate-field", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: classified[i].channel, fieldType: ft, idx: i, leadId, icpProfileId, language, flowType, signals, user_prompt: stepUserPrompt, sequence_meta: sequence }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            failedLabel = classified[i].label;
            failedReason = readableErr(data, res.status);
          } else if (data.content) {
            allSteps[i] = { ...allSteps[i], body: data.content, subject: data.subject || allSteps[i]?.subject };
            onChange({ ...channelMessages, connectionRequest: connRequest, steps: [...allSteps], autoReplies: replies });
          }
        } catch (e: any) {
          failedLabel = classified[i].label;
          failedReason = e?.message ?? "network error";
        }
      }

      // Generate auto-replies
      for (const replyType of replyTypes) {
        if (failedLabel) break;
        stepIndex++;
        const human = replyType === "replyPositive" ? "Positive auto-reply" : "Negative auto-reply";
        setGenProgress({ current: stepIndex, total: totalSteps, label: human });
        const promptField = replyType === "replyPositive" ? "positivePrompt" : "negativePrompt";
        const replyPrompt = (channelMessages.autoReplies && (channelMessages.autoReplies as Record<string, string | undefined>)[promptField]) ?? "";
        try {
          const res = await fetch("/api/campaigns/generate-field", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: "linkedin", fieldType: replyType, leadId, icpProfileId, language, flowType, signals, user_prompt: replyPrompt }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            failedLabel = human;
            failedReason = readableErr(data, res.status);
          } else if (data.content) {
            const field = replyType === "replyPositive" ? "positive" : "negative";
            replies = { ...replies, [field]: data.content };
            onChange({ ...channelMessages, connectionRequest: connRequest, steps: [...allSteps], autoReplies: replies });
          }
        } catch (e: any) {
          failedLabel = human;
          failedReason = e?.message ?? "network error";
        }
      }
    } catch (err) {
      console.error("Generate all error:", err);
      failedReason = (err as any)?.message ?? "unexpected error";
    }

    if (failedLabel) {
      const msg = failedReason ? `Failed at "${failedLabel}": ${failedReason}` : `Generation stopped at "${failedLabel}"`;
      console.error(msg);
      setAiError(msg);
    }
    setAiLoading(null);
    setGenProgress(null);
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
            {aiLoading === "all"
              ? (genProgress ? `Step ${genProgress.current} of ${genProgress.total}` : t("wiz.gen.previewing"))
              : t("wiz.gen.previewAll")}
          </button>
        </div>
        {/* Error banner — without this, when the AI endpoint 500s the
            button just stops spinning and the seller has no idea what
            happened. Dismissable on next attempt (setAiError(null) at
            generateField/generateAll entry). */}
        {aiError && (
          <div className="mt-3 px-3 py-2 rounded-lg border flex items-start gap-2 text-[11px]"
            style={{ backgroundColor: "color-mix(in srgb, #DC2626 8%, transparent)", borderColor: "color-mix(in srgb, #DC2626 30%, transparent)", color: "#DC2626" }}>
            <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span className="flex-1 break-words"><strong>AI generator error:</strong> {aiError}</span>
            <button onClick={() => setAiError(null)} className="text-[10px] opacity-70 hover:opacity-100">dismiss</button>
          </div>
        )}
        {/* Progress bar — surfaces what AI is generating right now so the
            seller sees real movement during the 20-30s loop. Hidden when
            idle. */}
        {genProgress && (
          <div className="mt-3 px-1">
            <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: C.textMuted }}>
              <span className="font-medium truncate" style={{ color: C.textBody }}>{genProgress.label}</span>
              <span className="tabular-nums shrink-0 ml-2">{genProgress.current}/{genProgress.total}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)` }}>
              <div
                className="h-full transition-[width] duration-300"
                style={{
                  width: `${(genProgress.current / Math.max(1, genProgress.total)) * 100}%`,
                  background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ═══ PLACEHOLDERS REFERENCE + VALIDATION ═══
          Single source of truth for which `{{…}}` tokens render correctly.
          Click to copy. Renders an inline warning under any step body that
          contains an unsupported token so the author fixes it before the
          dispatcher silently fails the message (PE Spain incident
          2026-05-27). */}
      <PlaceholdersHint
        bodies={[
          channelMessages.connectionRequest ?? "",
          ...(channelMessages.steps ?? []).map(s => s?.body ?? ""),
          ...(channelMessages.steps ?? []).map(s => s?.subject ?? ""),
        ].filter(Boolean)}
        onAutoFix={(rewriter) => {
          // Apply the rewriter to every slot that holds free-text copy:
          // the connection request, plus every step's body + subject.
          // Steps stay 1:1 with sequence indices (wizard storage invariant
          // memory, LAW) — we map in place, never reorder.
          const nextSteps = (channelMessages.steps ?? []).map((s): StepMessage => ({
            ...s,
            body: rewriter(s?.body ?? ""),
            subject: s?.subject ? rewriter(s.subject) : s?.subject,
          }));
          const nextReplies = channelMessages.autoReplies
            ? {
                ...channelMessages.autoReplies,
                positive: channelMessages.autoReplies.positive ? rewriter(channelMessages.autoReplies.positive) : channelMessages.autoReplies.positive,
                negative: channelMessages.autoReplies.negative ? rewriter(channelMessages.autoReplies.negative) : channelMessages.autoReplies.negative,
              }
            : channelMessages.autoReplies;
          onChange({
            ...channelMessages,
            connectionRequest: rewriter(channelMessages.connectionRequest ?? ""),
            steps: nextSteps,
            autoReplies: nextReplies,
          });
        }}
      />

      {/* ═══ LINKEDIN CONNECTION REQUEST (always shown if LinkedIn is in sequence) ═══ */}
      {sequence.some(s => s.channel === "linkedin") && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.linkedin}` }}>
          {/* Single-row header — title + Day + AI button. Description moved into
              textarea placeholder/title attr to claw back ~32px of vertical space. */}
          <div className="px-4 py-2.5 flex items-center gap-2.5 border-b"
            style={{ borderColor: C.border, background: `${C.linkedin}06` }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: C.linkedin }}>
              <Share2 size={12} color="#fff" />
            </div>
            <span className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>
              {t("wiz.connReq.title")}
            </span>
            <span className="text-[11px] shrink-0" style={{ color: C.textMuted }}>· Max 200</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => toggleExpand("conn")} title={expanded.has("conn") ? "Collapse" : "Expand"}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-opacity hover:opacity-80"
                style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}>
                {expanded.has("conn") ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
              </button>
              <button onClick={() => generateField("connectionNote", undefined)} disabled={!!aiLoading}
                title="Draft the LinkedIn invite note with AI from the lead's enrichment + your tone of voice"
                className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-[opacity,box-shadow] disabled:opacity-50 hover:shadow-sm"
                style={{
                  background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
                  color: "#04070d",
                  boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 28%, transparent)`,
                  letterSpacing: "0.06em",
                }}>
                {aiLoading === "connectionNote:" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {aiLoading === "connectionNote:" ? "Drafting" : "AI Draft"}
              </button>
            </div>
          </div>
          <div className="px-4 py-3 space-y-1.5">
            {/* PRIMARY: the message. Char counter folded into a single line
                with the label so the float-right counter doesn't take its own row. */}
            <textarea
              rows={expanded.has("conn") ? 10 : 2}
              maxLength={200}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={channelMessages.connectionRequest || ""}
              onChange={e => onChange({ ...channelMessages, connectionRequest: e.target.value })}
              placeholder={inlinePlaceholders.connectionRequest}
              title={t("wiz.connReq.hint")}
            />
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: C.textDim }}>{t("wiz.connReq.hint")}</span>
              <span style={{ color: (channelMessages.connectionRequest?.length || 0) > 200 ? C.red : C.textDim }}>
                {channelMessages.connectionRequest?.length || 0}/200
              </span>
            </div>
            {(channelMessages.connectionRequest?.length || 0) > 195 && (
              <p className="text-[11px]" style={{ color: C.red }}>
                Heads up: placeholder expansion (first name + company) may push this past LinkedIn&apos;s 200-char cap. Tighten to ~180 to leave margin.
              </p>
            )}

            {/* SECONDARY: AI prompt — hidden by default. Click "+ Customize"
                to reveal. Auto-stays open when there's saved content so users
                with existing prompts never lose them. */}
            {!isAiPromptOpen("conn", channelMessages.connectionRequestPrompt) ? (
              <button onClick={() => toggleAiPrompt("conn")}
                className="inline-flex items-center gap-1 text-[10px] font-medium hover:underline pt-1"
                style={{ color: gold }}>
                <Plus size={10} /> {t("wiz.step.promptHelper")}
              </button>
            ) : (
              <div className="pt-1.5">
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ OUTREACH SEQUENCE (in order) ═══ */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-8 bottom-8 w-0.5" style={{ backgroundColor: C.border }} />

        {classified.map((cls, i) => {
          // Skip the CR slot (sequence[0] when hasCR) — it's rendered as the
          // dedicated Connection Request card above, not as a numbered step.
          if (hasCR && i === 0) return null;
          const meta = channelMeta[cls.channel] || channelMeta.linkedin;
          const Icon = meta.icon;
          const step = steps[i];
          const fieldType = stepToFieldType(cls.type);
          const isEmail = cls.hasSubject;
          const loadingKey = `${fieldType}:${i}`;
          // Display number: when hasCR, sequence[1] is "Step 1" to the user.
          const displayNum = hasCR ? i : i + 1;
          // For reorder bounds, compute the first/last *renderable* indices.
          const firstRenderableIdx = hasCR ? 1 : 0;
          const lastRenderableIdx = classified.length - 1;

          return (
            <div key={i} className="relative flex gap-3 mb-3">
              {/* Step indicator */}
              <div className="relative z-10 shrink-0">
                <div className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: meta.color, border: "3px solid #fff" }}>
                  <Icon size={14} color="#fff" />
                </div>
              </div>

              {/* Content — in tailored mode we add a gold left-edge strip
                  + warmer card tint so the AI-per-lead identity reads
                  immediately from the step card, not just from a chip. */}
              <div className="flex-1 rounded-xl border overflow-hidden relative" style={flowType === "tailored"
                ? { backgroundColor: C.card, borderColor: `color-mix(in srgb, ${gold} 35%, ${C.border})`, boxShadow: `0 2px 8px -4px color-mix(in srgb, ${gold} 25%, transparent)` }
                : { backgroundColor: C.card, borderColor: C.border }}>
                {flowType === "tailored" && (
                  <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: `linear-gradient(180deg, ${gold}, color-mix(in srgb, ${gold} 55%, transparent))` }} />
                )}
                <div className="px-4 py-2.5 flex items-center gap-2 border-b"
                  style={flowType === "tailored"
                    ? { borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`, background: `color-mix(in srgb, ${gold} 4%, ${meta.color}06)` }
                    : { borderColor: C.border, background: `${meta.color}06` }}>
                  <span className="text-sm font-semibold shrink-0" style={{ color: C.textPrimary }}>Step {displayNum}</span>
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                    {cls.label}
                  </span>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: C.textDim }}>· Day {dayPerStep[i]}</span>
                  {/* Tailored status chip — shows the seller, at a glance,
                      whether THIS step body has per-lead AI slots in it.
                      Gold pill when present (the wizard generation auto-
                      inserted them). Amber warning when tailored mode is
                      on but the body has no slots so this step will ship
                      as a static template (still works, just not tailored). */}
                  {flowType === "tailored" && (() => {
                    const body = steps[i]?.body ?? "";
                    const subject = steps[i]?.subject ?? "";
                    const slots = [...findTailoredSlots(body), ...findTailoredSlots(subject)];
                    if (slots.length > 0) {
                      return (
                        <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1"
                          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}
                          title={`Per-lead slots in body: ${slots.join(", ")}`}>
                          ✨ Per-lead AI
                        </span>
                      );
                    }
                    if (body.trim().length > 0) {
                      return (
                        <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1"
                          style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#D97706", border: "1px solid color-mix(in srgb, #D97706 30%, transparent)" }}
                          title="Tailored mode is on but this step has no {{tailored:hook}} / {{tailored:fit}}. Re-draft with AI to insert them or it'll ship as a generic step.">
                          ⚠ Generic body
                        </span>
                      );
                    }
                    return null;
                  })()}
                  <div className="ml-auto flex items-center gap-1.5">
                    {onReorderStep && (
                      <div className="flex items-center rounded-md overflow-hidden border" style={{ borderColor: C.border }}>
                        <button
                          type="button"
                          onClick={() => onReorderStep(i, i - 1)}
                          disabled={i <= firstRenderableIdx}
                          title="Move step up"
                          className="px-1.5 py-1 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ backgroundColor: C.bg, color: C.textMuted, borderRight: `1px solid ${C.border}` }}
                        >
                          <ChevronUp size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onReorderStep(i, i + 1)}
                          disabled={i === lastRenderableIdx}
                          title="Move step down"
                          className="px-1.5 py-1 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ backgroundColor: C.bg, color: C.textMuted }}
                        >
                          <ChevronDown size={11} />
                        </button>
                      </div>
                    )}
                    <button onClick={() => toggleExpand(`step-${i}`)} title={expanded.has(`step-${i}`) ? "Collapse" : "Expand"}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-opacity hover:opacity-80"
                      style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}>
                      {expanded.has(`step-${i}`) ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
                    </button>
                    <button onClick={() => generateField(fieldType, i)} disabled={!!aiLoading}
                      title="Draft this step's copy with AI from the lead's enrichment + your tone of voice"
                      className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-[opacity,box-shadow] disabled:opacity-50 hover:shadow-sm"
                      style={{
                        background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
                        color: "#04070d",
                        boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 28%, transparent)`,
                        letterSpacing: "0.06em",
                      }}>
                      {aiLoading === loadingKey ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      {aiLoading === loadingKey ? "Drafting" : "AI Draft"}
                    </button>
                  </div>
                </div>

                <div className="px-4 py-2.5 space-y-1.5">
                  {isEmail && (() => {
                    const subjectMissing = !step?.subject?.trim();
                    const hasBody = !!step?.body?.trim();
                    // Warn (red border) only after the seller has started writing
                    // the body — silence on a freshly-added step that hasn't been
                    // touched yet. Sellers used to ship emails with blank subjects
                    // because the field looked optional.
                    const showWarning = subjectMissing && hasBody;
                    return (
                      <div className="space-y-1">
                        <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: showWarning ? C.red : C.textDim }}>
                          Subject <span style={{ color: C.red }}>*</span>
                          {showWarning && <span className="font-normal normal-case tracking-normal text-[10px]" style={{ color: C.red }}>· required for email steps</span>}
                        </label>
                        <input
                          required
                          aria-required="true"
                          aria-invalid={showWarning}
                          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                          style={{
                            borderColor: showWarning ? C.red : C.border,
                            color: C.textPrimary,
                            backgroundColor: showWarning ? `${C.red}08` : C.bg,
                          }}
                          value={step?.subject || ""}
                          onChange={e => updateStep(i, "subject", e.target.value)}
                          placeholder={inlinePlaceholders.subject}
                        />
                      </div>
                    );
                  })()}

                  {/* PRIMARY: the message. The intent description that used to
                      live above is now the placeholder + title attr — same info,
                      contextual to the empty input, doesn't waste vertical space. */}
                  <textarea
                    rows={expanded.has(`step-${i}`) ? 18 : (cls.type === "EMAIL_INTRO" ? 6 : cls.type.includes("CALL") ? 5 : 4)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                    style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                    value={step?.body || ""}
                    onChange={e => updateStep(i, "body", e.target.value)}
                    placeholder={typeDescriptions[cls.type] || inlinePlaceholders.fallback}
                    title={typeDescriptions[cls.type] || ""}
                  />

                  {/* Tailored-slot reassurance bar — only shown when the
                      step body actually contains per-lead slots so the
                      seller doesn't think the textarea is "the message"
                      that goes literally to every lead. The same chip
                      logic the header uses, surfaced inline near the body. */}
                  {flowType === "tailored" && (() => {
                    const present = findTailoredSlots(step?.body ?? "");
                    if (present.length === 0) return null;
                    return (
                      <div className="mt-1.5 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[10.5px]"
                        style={{ background: `color-mix(in srgb, ${gold} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${gold} 25%, transparent)`, color: gold }}>
                        <Sparkles size={10} />
                        <span><strong>Per-lead:</strong> {present.map(s => <code key={s} className="px-1 py-0.5 rounded font-mono" style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)` }}>{`{{${s}}}`}</code>).reduce((acc, el, idx) => idx === 0 ? [el] : [...acc, " · ", el], [] as React.ReactNode[])}</span>
                        <span className="ml-auto" style={{ color: C.textMuted }}>The rest of the text is identical for every lead · per-lead result lives in Step 4</span>
                      </div>
                    );
                  })()}

                  {/* SECONDARY: AI prompt — collapsed by default. */}
                  {!isAiPromptOpen(`step-${i}`, step?.user_prompt) ? (
                    <button onClick={() => toggleAiPrompt(`step-${i}`)}
                      className="inline-flex items-center gap-1 text-[10px] font-medium hover:underline pt-0.5"
                      style={{ color: gold }}>
                      <Plus size={10} /> {t("wiz.step.promptHelper")}
                    </button>
                  ) : (
                    <div className="pt-1">
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
                    </div>
                  )}

                  {/* ATTACHMENTS — file pickers live next to the message body
                      because that's where the seller's brain is at when they
                      think "this message needs a PDF". Wired back into the
                      parent's sequence_steps[i].attachments, which the email +
                      LinkedIn dispatchers consume at send time. */}
                  {onAttachmentsChange && cls.channel !== "call" && (
                    <div className="pt-1">
                      <StepAttachments
                        channel={cls.channel}
                        attachments={sequence[i]?.attachments ?? []}
                        onChange={(next) => onAttachmentsChange(i, next)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ AUTO-REPLIES (reactive, separate) ═══
          Only the LinkedIn Response Handler (h2uBZscVnZy0utLD) reads the
          positive/negative templates from campaign_request.message_prompts.
          The Email Reply Handler (EartyXv9hlVVFqvt) ignores them entirely
          and always generates AI replies in the tenant's voice. Hide the
          whole block for sequences that don't include LinkedIn so sellers
          don't waste time filling fields that get ignored. */}
      {sequence.some(s => s.channel === "linkedin") && (
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
                  title="Draft this reply with AI from the lead's positive answer + your tone of voice"
                  className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-[opacity,box-shadow] disabled:opacity-50 hover:shadow-sm"
                  style={{
                    background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
                    color: "#04070d",
                    boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 28%, transparent)`,
                    letterSpacing: "0.06em",
                  }}>
                  {aiLoading === "replyPositive:" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {aiLoading === "replyPositive:" ? "Drafting" : "AI Draft"}
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
                  title="Draft this reply with AI from the lead's negative answer + your tone of voice"
                  className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-[opacity,box-shadow] disabled:opacity-50 hover:shadow-sm"
                  style={{
                    background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`,
                    color: "#04070d",
                    boxShadow: `0 1px 6px color-mix(in srgb, ${gold} 28%, transparent)`,
                    letterSpacing: "0.06em",
                  }}>
                  {aiLoading === "replyNegative:" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {aiLoading === "replyNegative:" ? "Drafting" : "AI Draft"}
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
      )}
    </div>
  );
}
