// Generate first-draft per-step messages for a new template using Claude
// Sonnet 4.6 with document content blocks. Accepts up to 5 PDFs (≤8MB each)
// as base64 in the request body alongside the template's metadata + sequence.
//
// Claude reads the PDFs (sales decks, case studies, one-pagers) and drafts
// messages in the same language the user is writing in, using their company
// + ICP context. The output is editable in the UI — this just removes the
// blank-page problem.
//
// Cost: Sonnet 4.6 + ~5 PDFs at ~1500 tokens each = ~$0.03-0.05 per run.
// Cheap enough to be re-run with different sequences, expensive enough to
// not auto-fire — always button-triggered.

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const MODEL = "claude-sonnet-4-6";
const MAX_PDFS = 5;
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB per file — well under Anthropic's 32MB limit

export const maxDuration = 60;

type Body = {
  name: string;
  description?: string;
  channels?: string[];
  sequence: Array<{ channel: string; daysAfter: number }>;
  includesLinkedIn?: boolean;
  attachments: Array<{ filename: string; mimeType: string; base64: string }>;
  language?: string; // 'es' | 'en' | etc — drives output language
};

const SYSTEM_PROMPT = `You are an elite B2B outbound copywriter inside a sales operating system. Given:
- a tenant's company name + a description of what they sell,
- a sequence of touchpoints (channel + daysAfter),
- and supporting documents (sales decks, case studies, one-pagers) provided as PDFs,

your job is to draft the body of each step in the sequence so the seller can use it as a starting point. The output is editable in the UI; aim for a quality first draft, not perfection.

Rules:
- Match the tone of the source PDFs. If they're consultative and analytical, write that way. If they're sharp and direct, mirror that.
- Use the variables {{first_name}}, {{company_name}}, and {{seller_name}} where they make the message feel personal. Don't force them — natural placement only.
- LinkedIn invite (when step 0 channel = linkedin and the user opts in): MAX 280 characters, opener-only, no value pitch.
- LinkedIn DMs: 400-700 characters, conversational, one specific hook tied to the PDF content.
- Emails: subject + body. Subject ≤60 chars, no clickbait. Body 80-150 words, scannable, one clear CTA.
- Calls: 2-3 short bullets the seller will say out loud, NOT a script to read verbatim.
- WhatsApp: 200-400 characters, friendly but professional.
- Never invent facts the PDF doesn't support.
- Write in the language of the source PDFs unless the user explicitly requested a different language.

Output must be valid JSON exactly matching:
{
  "connectionRequest": "string or empty if includesLinkedIn=false",
  "steps": [
    { "step": 1, "channel": "...", "subject": "string or null", "body": "..." },
    ...
  ]
}

No prose outside the JSON. No markdown fence. Just the JSON object.`;

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

  if (!body.name?.trim() || !Array.isArray(body.sequence) || body.sequence.length === 0) {
    return NextResponse.json({ error: "name and non-empty sequence required" }, { status: 400 });
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
    // Rough byte estimate: base64 length * 3/4
    const estBytes = (a.base64.length * 3) / 4;
    if (estBytes > MAX_PDF_BYTES) {
      return NextResponse.json({ error: `${a.filename} exceeds ${MAX_PDF_BYTES / 1024 / 1024}MB limit` }, { status: 400 });
    }
    if (a.mimeType && a.mimeType !== "application/pdf") {
      return NextResponse.json({ error: `Only PDFs supported for now (${a.filename} is ${a.mimeType})` }, { status: 400 });
    }
  }

  // Pull the tenant's company bio so Claude has business context.
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("company_name, industry, description, value_proposition, main_services, tone_of_voice")
    .eq("id", scope.companyBioId)
    .maybeSingle();

  // Build the user message: structured spec + the PDFs as document blocks.
  const sequenceLines = body.sequence.map((s, i) =>
    `  Step ${i + 1}: ${s.channel} — daysAfter ${s.daysAfter}`
  ).join("\n");
  const includesLinkedIn = body.includesLinkedIn ?? body.sequence.some(s => s.channel === "linkedin");

  const specText = [
    `TEMPLATE: ${body.name}`,
    body.description ? `DESCRIPTION: ${body.description}` : null,
    "",
    "TENANT:",
    bio?.company_name ? `  Company: ${bio.company_name}` : null,
    bio?.industry ? `  Industry: ${bio.industry}` : null,
    bio?.description ? `  About: ${String(bio.description).slice(0, 500)}` : null,
    bio?.value_proposition ? `  Value prop: ${String(bio.value_proposition).slice(0, 300)}` : null,
    bio?.tone_of_voice ? `  Tone: ${bio.tone_of_voice}` : null,
    "",
    "SEQUENCE:",
    includesLinkedIn ? "  Step 0: linkedin connection request (max 280 chars)" : null,
    sequenceLines,
    "",
    body.language ? `LANGUAGE: ${body.language}` : "LANGUAGE: match the source PDFs",
    "",
    "Read the attached PDFs. Then return the JSON described in the system prompt — exactly that shape, no extras, no markdown.",
  ].filter(Boolean).join("\n");

  // Document blocks first, then the text instruction last (Claude pays
  // strongest attention to the most-recent message content).
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

  // Strip an accidental markdown fence — defensive even though the prompt
  // says no fences.
  const cleaned = rawOutput
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: { connectionRequest?: string; steps?: Array<{ step: number; channel: string; subject?: string | null; body: string }> };
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

  return NextResponse.json({
    connectionRequest: parsed.connectionRequest ?? "",
    steps: parsed.steps,
    model: MODEL,
  });
}
