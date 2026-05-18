// Generate first-draft per-step messages for a new template using Claude
// Sonnet 4.6 with document content blocks. Two modes (AUTHORED vs
// DETECTED) — see body below. Three new knobs since 2026-05-17:
//
//   * tone_preset    — Conservative/Balanced/Direct/Spicy/Custom — bolt the
//                      matching style guide onto the system prompt.
//   * voice_anchor   — optional seller_id. When set, we load that seller's
//                      voice_examples (3-shot) and embed them as anchor.
//   * source_excerpt — model returns the snippet from the PDFs that each
//                      step's body was anchored to, so the wizard can show
//                      "the AI didn't invent — here's the source".
//
// All generated bodies pass through `sanitize()` so what the wizard previews
// matches what the n8n dispatcher eventually sends (anti-fluff, anti-reintro,
// length cap, auto-signature).

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { sanitize } from "@/lib/sanitize-output";

const MODEL = "claude-sonnet-4-6";
const MAX_PDFS = 5;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export const maxDuration = 60;

type SeqStep = { channel: string; daysAfter: number };
type TonePreset = "conservative" | "balanced" | "direct" | "spicy" | "custom";

type Body = {
  name?: string;
  description?: string;
  channels?: string[];
  sequence?: SeqStep[];
  includesLinkedIn?: boolean;
  attachments: Array<{ filename: string; mimeType: string; base64: string }>;
  language?: string;
  tone_preset?: TonePreset;
  tone_custom_notes?: string;
  voice_anchor_seller_id?: string;
  icp_profile_id?: string;
};

const SYSTEM_PROMPT_BASE = `You are an elite B2B outbound copywriter inside a sales operating system. You read the tenant's supporting documents (sales decks, case studies, playbooks, one-pagers) and produce three things at once:

1. A SEQUENCE of touchpoints — channel + daysAfter for each step
2. The DRAFT MESSAGE for each step in that sequence
3. A SOURCE EXCERPT per step — the literal snippet from the PDFs (≤120 chars) that anchored each draft

You will be told whether the sequence is AUTHORED (the user already chose channels + days and you must honour them exactly) or DETECTED (you must extract it from the PDFs or propose a sensible default).

In DETECTED mode:
- If the PDF describes a cadence ("Day 1 LinkedIn invite, Day 3 follow-up email, Day 7 call"), use it verbatim.
- If multiple cadences appear, prefer the one for the specific ICP / role the tenant is targeting.
- If none is described, propose a default appropriate for the tenant's industry / ICP (3-6 steps).
  • Consultative: LinkedIn invite (day 0) → LinkedIn DM (day 3) → Email (day 7) → Call (day 12).
  • Transactional: Email (day 0) → LinkedIn invite (day 2) → Email (day 5).

Message rules (apply to both modes):
- Use {{first_name}}, {{company_name}}, {{seller_name}} where they feel natural. Never force.
- LinkedIn invite (step 0, channel=linkedin, includesLinkedIn=true): MAX 200 chars, opener-only, no value pitch.
- LinkedIn DMs (later steps, channel=linkedin): 400-700 chars, conversational, one specific hook tied to PDF content.
- Emails: subject ≤60 chars + body 80-150 words, scannable, one clear CTA.
- Calls: 2-3 short bullets the seller will say out loud, NOT a script.
- WhatsApp: 200-400 chars, friendly but professional.
- Never invent facts the PDFs don't support.
- Write in the language of the source PDFs unless the user explicitly requested a different language.
- Anti-fluff: do NOT start with "I hope this finds you well", "I came across your profile", "Quick question for you", "Sorry to bother". The system strips these post-hoc anyway.
- Anti-reintro for steps after step 1: do NOT re-introduce yourself ("I'm <name> from <company>") — the previous step already did that.
- Auto-signature: never close with "Best, <Name>" or "— <Name>" — leave the body unsigned; the dispatcher attaches the seller's name.

Output must be valid JSON exactly matching:
{
  "detected_sequence": [
    { "channel": "linkedin|email|call|whatsapp", "daysAfter": 0 },
    ...
  ],
  "connectionRequest": "string or empty if no linkedin invite",
  "connectionRequestSource": "≤120 char excerpt or empty",
  "steps": [
    { "step": 1, "channel": "...", "subject": "string or null", "body": "...", "source_excerpt": "≤120 char snippet or empty" },
    ...
  ]
}

- detected_sequence MUST equal what you used to draft the steps.
- In AUTHORED mode, detected_sequence MUST mirror the input sequence exactly.
- connectionRequest is the body of the LinkedIn invite when present. Empty string otherwise.
- steps must have one entry per item in detected_sequence (matching channel + order).
- source_excerpt: a verbatim ≤120-char chunk lifted from the PDFs that justifies that step's hook. Empty string ok if generic step. Do NOT paraphrase — copy literally.
- No prose outside the JSON. No markdown fence. Just the JSON object.`;

const TONE_GUIDES: Record<TonePreset, string> = {
  conservative: `TONE: CONSERVATIVE. Formal register. No hype, no "transform", "10x", "game-changing". One concrete benefit per message, no superlatives. CTAs are soft asks ("would a 15-minute call next week be useful?"). For legal/healthcare/banking targets — never overpromise.`,
  balanced:     `TONE: BALANCED. Conversational professional. One hook tied to the PDF, one clear CTA. Allow light enthusiasm but no fluff. Default for most B2B outbound.`,
  direct:       `TONE: DIRECT. Blunt opener, sharp CTA. Skip pleasantries. Lead with the problem you solve in the first sentence. Use short sentences. Suitable for technical buyers and operators.`,
  spicy:        `TONE: SPICY. Contrarian opener. Challenge a common belief in their industry. Higher reply rates, higher unsubscribe risk — only use when the user explicitly picks this. Never insulting, never gossipy.`,
  custom:       `TONE: CUSTOM. Follow the additional style notes appended below verbatim.`,
};

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.attachments) || body.attachments.length === 0) {
    return NextResponse.json({ error: "At least one PDF attachment required" }, { status: 400 });
  }
  if (body.attachments.length > MAX_PDFS) {
    return NextResponse.json({ error: `Max ${MAX_PDFS} PDFs per generation` }, { status: 400 });
  }
  for (const a of body.attachments) {
    if (!a.base64 || !a.filename) {
      return NextResponse.json({ error: "Each attachment needs filename + base64" }, { status: 400 });
    }
    const estBytes = (a.base64.length * 3) / 4;
    if (estBytes > MAX_PDF_BYTES) {
      return NextResponse.json({ error: `${a.filename} exceeds ${MAX_PDF_BYTES / 1024 / 1024}MB limit` }, { status: 400 });
    }
    if (a.mimeType && a.mimeType !== "application/pdf") {
      return NextResponse.json({ error: `Only PDFs supported for now (${a.filename} is ${a.mimeType})` }, { status: 400 });
    }
  }

  const authoredSequence = Array.isArray(body.sequence) && body.sequence.length > 0;
  const includesLinkedIn = body.includesLinkedIn ?? (authoredSequence ? body.sequence!.some(s => s.channel === "linkedin") : true);
  const tonePreset: TonePreset = body.tone_preset ?? "balanced";

  const svc = getSupabaseService();
  const [bioRes, sellerRes, icpRes] = await Promise.all([
    svc.from("company_bios")
      .select("company_name, industry, description, value_proposition, main_services, tone_of_voice")
      .eq("id", scope.companyBioId)
      .maybeSingle(),
    body.voice_anchor_seller_id
      ? svc.from("sellers").select("id, name, voice_examples").eq("id", body.voice_anchor_seller_id).maybeSingle()
      : Promise.resolve({ data: null }),
    body.icp_profile_id
      ? svc.from("icp_profiles").select("id, profile_name, target_industries, target_roles").eq("id", body.icp_profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const bio = bioRes.data;
  const seller = sellerRes.data as { id: string; name: string; voice_examples: unknown } | null;
  const icp = icpRes.data as { id: string; profile_name: string; target_industries: unknown; target_roles: unknown } | null;

  const sequenceBlock = authoredSequence
    ? `MODE: AUTHORED\nSEQUENCE (use exactly):\n${body.sequence!.map((s, i) => `  Step ${i + 1}: ${s.channel} — daysAfter ${s.daysAfter}`).join("\n")}`
    : `MODE: DETECTED\nExtract the cadence from the PDFs. If none is described, propose a sensible default for the tenant's industry / ICP (3-6 steps). Return whatever you used in detected_sequence.`;

  // Voice anchor block (few-shot). Only added when the seller exposes
  // voice_examples — otherwise omitted entirely so the prompt doesn't carry
  // dead weight. Expected shape: array of { context?: string, sample: string }.
  let voiceBlock = "";
  if (seller && Array.isArray(seller.voice_examples) && seller.voice_examples.length > 0) {
    const examples = (seller.voice_examples as Array<{ context?: string; sample?: string }>).slice(0, 3);
    voiceBlock = [
      `VOICE ANCHOR: write in the voice of ${seller.name}. Match their cadence, slang, sentence length. Examples of how ${seller.name} actually writes:`,
      ...examples.map((ex, i) => `  Example ${i + 1}${ex.context ? ` (${ex.context})` : ""}: """${(ex.sample ?? "").slice(0, 400)}"""`),
    ].join("\n");
  }

  const toneBlock = TONE_GUIDES[tonePreset]
    + (tonePreset === "custom" && body.tone_custom_notes ? `\nADDITIONAL NOTES: ${body.tone_custom_notes.slice(0, 800)}` : "");

  const icpLines = icp ? [
    "",
    "ICP TARGET (this template is for THIS specific audience — if the PDF contains multiple campaigns, extract ONLY the one targeting this ICP):",
    `  ICP name: ${icp.profile_name}`,
    Array.isArray(icp.target_roles) && (icp.target_roles as string[]).length > 0
      ? `  Target roles: ${(icp.target_roles as string[]).join(", ")}`
      : null,
    Array.isArray(icp.target_industries) && (icp.target_industries as string[]).length > 0
      ? `  Target industries: ${(icp.target_industries as string[]).join(", ")}`
      : null,
  ].filter(v => v !== null) : [];

  const specText = [
    body.name ? `TEMPLATE: ${body.name}` : `TEMPLATE: (untitled — name comes later)`,
    body.description ? `DESCRIPTION: ${body.description}` : null,
    "",
    "TENANT:",
    bio?.company_name ? `  Company: ${bio.company_name}` : null,
    bio?.industry ? `  Industry: ${bio.industry}` : null,
    bio?.description ? `  About: ${String(bio.description).slice(0, 500)}` : null,
    bio?.value_proposition ? `  Value prop: ${String(bio.value_proposition).slice(0, 300)}` : null,
    bio?.tone_of_voice ? `  Tenant tone: ${bio.tone_of_voice}` : null,
    ...icpLines,
    "",
    toneBlock,
    "",
    voiceBlock || null,
    voiceBlock ? "" : null,
    sequenceBlock,
    "",
    `LINKEDIN INVITE: ${includesLinkedIn ? "include (step 0, max 280 chars)" : "omit"}`,
    "",
    body.language ? `LANGUAGE: ${body.language}` : "LANGUAGE: match the source PDFs",
    "",
    "Read the attached PDFs. Then return the JSON described in the system prompt — exactly that shape, no extras, no markdown.",
  ].filter(v => v !== null).join("\n");

  const userContent: Anthropic.ContentBlockParam[] = [
    ...body.attachments.map(a => ({
      type: "document" as const,
      source: {
        type: "base64" as const,
        media_type: "application/pdf" as const,
        data: a.base64,
      },
      title: a.filename,
    })),
    { type: "text" as const, text: specText },
  ];

  const anthropic = new Anthropic();
  let rawOutput: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4500,
      system: [{ type: "text", text: SYSTEM_PROMPT_BASE, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });
    rawOutput = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
  } catch (e: any) {
    return NextResponse.json({ error: `Generation failed: ${e?.message ?? "unknown"}` }, { status: 502 });
  }

  const cleaned = rawOutput
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "")
    .trim();

  type RawStep = { step: number; channel: string; subject?: string | null; body: string; source_excerpt?: string };
  let parsed: {
    detected_sequence?: SeqStep[];
    connectionRequest?: string;
    connectionRequestSource?: string;
    steps?: RawStep[];
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({
      error: "Couldn't parse model output as JSON. Try again or simplify the PDFs.",
      rawOutput: rawOutput.slice(0, 500),
    }, { status: 502 });
  }
  if (!Array.isArray(parsed.steps)) {
    return NextResponse.json({ error: "Model output missing steps[] array" }, { status: 502 });
  }

  const detected_sequence = Array.isArray(parsed.detected_sequence) && parsed.detected_sequence.length > 0
    ? parsed.detected_sequence
    : authoredSequence
      ? body.sequence!
      : parsed.steps.map(s => ({ channel: s.channel, daysAfter: 0 }));

  // Apply Sanitize parity to every body before returning. The wizard previews
  // exactly what the n8n dispatcher will send.
  const sanitizedSteps = parsed.steps.map((s, i) => ({
    step: s.step,
    channel: s.channel,
    subject: s.subject ?? null,
    body: sanitize(s.body ?? "", {
      channel: (s.channel as any) ?? "email",
      stepIndex: i,
      isConnectionRequest: false,
    }),
    source_excerpt: (s.source_excerpt ?? "").slice(0, 200),
  }));

  const sanitizedInvite = parsed.connectionRequest
    ? sanitize(parsed.connectionRequest, { channel: "linkedin", stepIndex: 0, isConnectionRequest: true })
    : "";

  return NextResponse.json({
    detected_sequence,
    connectionRequest: sanitizedInvite,
    connectionRequestSource: (parsed.connectionRequestSource ?? "").slice(0, 200),
    steps: sanitizedSteps,
    model: MODEL,
    tone_preset: tonePreset,
    voice_anchor_seller_id: seller?.id ?? null,
  });
}
