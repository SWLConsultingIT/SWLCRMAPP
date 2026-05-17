// Generate first-draft per-step messages for a new template using Claude
// Sonnet 4.6 with document content blocks. Accepts up to 5 PDFs (≤8MB each)
// as base64 in the request body alongside the template's metadata.
//
// Two modes, controlled by whether the caller passes a `sequence`:
//   1. AUTHORED sequence — user already picked channels + days; AI fills in
//      message bodies. (Legacy behavior.)
//   2. DETECTED sequence — caller omits `sequence`; AI reads the PDFs to
//      extract the cadence (e.g. "Day 1 LinkedIn invite → Day 3 follow-up
//      email → Day 7 call") and drafts messages for the detected steps. If
//      the PDFs don't describe a cadence, AI proposes a sensible default for
//      the tenant's industry + the detected ICP.
//
// The output JSON always includes `detected_sequence` so the UI can render
// the cadence in both modes without branching.
//
// Cost: Sonnet 4.6 + ~5 PDFs at ~1500 tokens each = ~$0.03-0.05 per run.

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const MODEL = "claude-sonnet-4-6";
const MAX_PDFS = 5;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export const maxDuration = 60;

type SeqStep = { channel: string; daysAfter: number };

type Body = {
  name?: string;
  description?: string;
  channels?: string[];
  /** Optional. When omitted/empty, AI proposes a sequence from the PDFs. */
  sequence?: SeqStep[];
  includesLinkedIn?: boolean;
  attachments: Array<{ filename: string; mimeType: string; base64: string }>;
  language?: string;
};

const SYSTEM_PROMPT = `You are an elite B2B outbound copywriter inside a sales operating system. You read the tenant's supporting documents (sales decks, case studies, playbooks, one-pagers) and produce two things at once:

1. A SEQUENCE of touchpoints — channel + daysAfter for each step
2. The DRAFT MESSAGE for each step in that sequence

You will be told whether the sequence is AUTHORED (the user already chose channels + days and you must honour them exactly) or DETECTED (you must extract it from the PDFs or propose a sensible default).

In DETECTED mode:
- If the PDF describes a cadence ("Day 1 LinkedIn invite, Day 3 follow-up email, Day 7 call"), use it verbatim — same channels, same day numbers.
- If multiple cadences appear, prefer the one for the specific ICP / role the tenant is targeting.
- If no cadence is described, propose a default appropriate for the tenant's industry and the ICP described in the PDFs:
    • Professional services / consultative: LinkedIn invite (day 0) → LinkedIn DM (day 3) → Email (day 7) → Call (day 12).
    • High-volume / transactional: Email (day 0) → LinkedIn invite (day 2) → Email (day 5).
  Pick 3-6 steps total. Use channels: linkedin, email, call, whatsapp.

Message rules (apply to both modes):
- Match the tone of the source PDFs. Consultative? Write consultative. Direct? Mirror that.
- Use {{first_name}}, {{company_name}}, {{seller_name}} where they feel natural. Never force.
- LinkedIn invite (step 0 channel = linkedin and includesLinkedIn=true): MAX 280 chars, opener-only, no value pitch.
- LinkedIn DMs (step N>0, channel=linkedin): 400-700 chars, conversational, one specific hook tied to PDF content.
- Emails: subject ≤60 chars + body 80-150 words, scannable, one clear CTA.
- Calls: 2-3 short bullets the seller will say out loud, NOT a script.
- WhatsApp: 200-400 chars, friendly but professional.
- Never invent facts the PDFs don't support.
- Write in the language of the source PDFs unless the user explicitly requested a different language.

Output must be valid JSON exactly matching:
{
  "detected_sequence": [
    { "channel": "linkedin|email|call|whatsapp", "daysAfter": 0 },
    ...
  ],
  "connectionRequest": "string or empty if no linkedin invite",
  "steps": [
    { "step": 1, "channel": "...", "subject": "string or null", "body": "..." },
    ...
  ]
}

- detected_sequence MUST equal what you used to draft the steps.
- In AUTHORED mode, detected_sequence MUST mirror the input sequence exactly.
- connectionRequest is the body of the LinkedIn invite when present (step 0). Empty string otherwise.
- steps must have one entry per item in detected_sequence (matching channel + order).
- No prose outside the JSON. No markdown fence. Just the JSON object.`;

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

  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("company_name, industry, description, value_proposition, main_services, tone_of_voice")
    .eq("id", scope.companyBioId)
    .maybeSingle();

  const sequenceBlock = authoredSequence
    ? `MODE: AUTHORED\nSEQUENCE (use exactly):\n${body.sequence!.map((s, i) => `  Step ${i + 1}: ${s.channel} — daysAfter ${s.daysAfter}`).join("\n")}`
    : `MODE: DETECTED\nExtract the cadence from the PDFs. If none is described, propose a sensible default for the tenant's industry / ICP (3-6 steps). Return whatever you used in detected_sequence.`;

  const specText = [
    body.name ? `TEMPLATE: ${body.name}` : `TEMPLATE: (untitled — name comes later)`,
    body.description ? `DESCRIPTION: ${body.description}` : null,
    "",
    "TENANT:",
    bio?.company_name ? `  Company: ${bio.company_name}` : null,
    bio?.industry ? `  Industry: ${bio.industry}` : null,
    bio?.description ? `  About: ${String(bio.description).slice(0, 500)}` : null,
    bio?.value_proposition ? `  Value prop: ${String(bio.value_proposition).slice(0, 300)}` : null,
    bio?.tone_of_voice ? `  Tone: ${bio.tone_of_voice}` : null,
    "",
    sequenceBlock,
    "",
    `LINKEDIN INVITE: ${includesLinkedIn ? "include (step 0, max 280 chars)" : "omit"}`,
    "",
    body.language ? `LANGUAGE: ${body.language}` : "LANGUAGE: match the source PDFs",
    "",
    "Read the attached PDFs. Then return the JSON described in the system prompt — exactly that shape, no extras, no markdown.",
  ].filter(Boolean).join("\n");

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
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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

  let parsed: {
    detected_sequence?: SeqStep[];
    connectionRequest?: string;
    steps?: Array<{ step: number; channel: string; subject?: string | null; body: string }>;
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

  // Defensive: in AUTHORED mode the detected_sequence should mirror input.
  // If the model omitted it or returned something off, fall back to the
  // authored sequence — the steps[] already carries the channel per step.
  const detected_sequence = Array.isArray(parsed.detected_sequence) && parsed.detected_sequence.length > 0
    ? parsed.detected_sequence
    : authoredSequence
      ? body.sequence!
      : parsed.steps.map(s => ({ channel: s.channel, daysAfter: 0 }));

  return NextResponse.json({
    detected_sequence,
    connectionRequest: parsed.connectionRequest ?? "",
    steps: parsed.steps,
    model: MODEL,
  });
}
