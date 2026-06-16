// POST /api/inbox/suggest/[leadId]
// ─────────────────────────────────────────────────────────────────────────
// On-demand draft generator for the inbox/lead-detail composer ("✨ Sugerir
// respuesta"). Mirrors the n8n reply-handlers' brain (Haiku + company_bio +
// the lead's ICP pains/solutions) but returns the draft to the SELLER instead
// of auto-sending. The seller edits and sends via /api/inbox/reply.
//
// Why this exists: the n8n handlers only auto-draft for clearly-positive
// replies; questions/ambiguous land in /queue with an empty reply for the
// human to write. This gives that human a one-click first draft grounded in
// the same tenant context, so they never stare at a blank box.
//
// Auth: logged-in user, scope-gated to their tenant's lead (same as thread).
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const runtime = "nodejs";

const SB = "https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1";

function joinList(v: unknown): string {
  if (Array.isArray(v)) return v.filter(Boolean).join("; ");
  return typeof v === "string" ? v : "";
}

// Languages the composer picker can force. "auto" (or absent) = detect from the
// conversation, the original behaviour.
const LANG_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  nl: "Dutch",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const svc = getSupabaseService();

  // Optional explicit language from the composer picker. Falls back to auto.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const forcedLang = typeof (body as any)?.lang === "string" ? ((body as any).lang as string).toLowerCase() : "";

  // Hydrate the lead (+ tenant + ICP) and enforce scope.
  const { data: lead } = await svc
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, company_bio_id, icp_profile_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if (scope.isScoped && scope.companyBioId && (lead as any).company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  // The message we're answering. Default to the latest inbound reply, but let
  // the caller override (e.g. answering a specific bubble in the thread).
  const { data: lastReply } = await svc
    .from("lead_replies")
    .select("reply_text, channel, received_at")
    .eq("lead_id", leadId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const leadMessage = ((lastReply as any)?.reply_text as string | null)?.trim() || "";
  if (!leadMessage) {
    return NextResponse.json({ error: "no lead message to answer" }, { status: 422 });
  }

  // Our last OUTBOUND message to this lead. A short reply like "Mucho gusto"
  // doesn't give Haiku enough to lock the language (it was defaulting to
  // English inside an English prompt). Our own message carries the real
  // conversation language, so we feed it in + detect the language explicitly.
  const { data: lastOutbound } = await svc
    .from("campaign_messages")
    .select("content, sent_at")
    .eq("lead_id", leadId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const outboundText = ((lastOutbound as any)?.content as string | null)?.trim() || "";

  // Lightweight Spanish detector over the whole conversation (our msg + theirs)
  // — accents/ñ/¿¡ or common ES words. Gives Haiku a hard, unambiguous directive
  // instead of relying on it to infer from a 3-word reply.
  const convoText = `${outboundText} ${leadMessage}`.toLowerCase();
  const esMarkers = /[ñáéíóú¿¡]|\b(hola|gracias|gusto|usted|trabajo|ventas|empresa|necesito|conectar|reunión|cómo|qué|para|porque|cuál|saludos|estimad|buenas|buenos d[ií]as)\b/;
  const looksSpanish = esMarkers.test(convoText);
  const forcedLangName = LANG_NAMES[forcedLang];
  const langDirective = forcedLangName
    ? `Write the ENTIRE reply in ${forcedLangName}, no matter what language the conversation has been in so far. Use natural, native ${forcedLangName} — never switch to another language.`
    : looksSpanish
    ? "The conversation is in SPANISH — write your entire reply in natural Spanish (match the lead's regional tone). Do NOT reply in English."
    : "Write the ENTIRE reply in the SAME language the lead used. Match their language exactly — never switch languages.";

  // Tenant brand voice.
  let bio: any = null;
  if ((lead as any).company_bio_id) {
    const { data } = await svc
      .from("company_bios")
      .select("company_name, company_description, description, value_proposition, differentiators, main_services, tone_of_voice")
      .eq("id", (lead as any).company_bio_id)
      .maybeSingle();
    bio = data;
  }
  // The lead's ICP — their specific pains + how we solve them.
  let icp: any = null;
  if ((lead as any).icp_profile_id) {
    const { data } = await svc
      .from("icp_profiles")
      .select("profile_name, pain_points, solutions_offered")
      .eq("id", (lead as any).icp_profile_id)
      .maybeSingle();
    icp = data;
  }

  const sellerCompany = bio?.company_name || "our team";
  const leadName = (lead as any).primary_first_name || "";
  const leadCompany = (lead as any).company_name || "";

  // Whether we actually have brand/ICP context. When empty (e.g. a tenant with
  // no company_bio loaded), the model must NOT apologise about "not having the
  // information" — it should just write a natural, helpful reply.
  const bioBits = [bio?.company_description || bio?.description, bio?.value_proposition, joinList(bio?.differentiators), joinList(bio?.main_services)].filter(Boolean);
  const icpBits = [joinList(icp?.pain_points), joinList(icp?.solutions_offered)].filter(Boolean);
  const hasContext = bioBits.length > 0 || icpBits.length > 0;

  const contextBlock = hasContext
    ? `WHO ${sellerCompany} IS (use this exact framing — never invent or substitute another company):
- Description: ${bio?.company_description || bio?.description || ""}
- Value proposition: ${bio?.value_proposition || ""}
- Differentiators: ${joinList(bio?.differentiators)}
- Main services: ${joinList(bio?.main_services)}
- Brand tone: ${bio?.tone_of_voice || ""}

THE LEAD'S ICP — ${icp?.profile_name || ""}:
- Their pains: ${joinList(icp?.pain_points)}
- What we solve for them: ${joinList(icp?.solutions_offered)}`
    : `(No extra company/ICP context is available for this tenant.)`;

  const guidance = hasContext
    ? `Write a reply that ANSWERS the lead's actual message directly, weaves in ONE of their ICP pains + how we solve it, and includes ONE concrete proof point ONLY if it appears verbatim in the context above (a client name or a hard metric — NEVER invent one). End with ONE soft next step.`
    : `Write a short, natural, helpful reply that ANSWERS the lead's actual message directly and ends with ONE soft next step (e.g. proposing a quick call). Keep it generic but warm — do NOT invent company facts, metrics, or client names.`;

  const system = `You are ${leadName ? "" : ""}drafting a sales reply on behalf of ${sellerCompany} to a B2B lead${leadCompany ? ` from ${leadCompany}` : ""}.

🔴 LANGUAGE — TOP PRIORITY: ${langDirective}

${contextBlock}

${guidance}

NEVER do this: do NOT write meta-commentary about yourself, about lacking information, about "our company's exact value proposition", about being an AI, or about what context you do or don't have. The lead must only see a normal human sales reply.

FORMAT: same language as the lead, no greeting line, no subject, no signature block (first name only if natural), 2-4 sentences max, peer-to-peer and specific, warm, no corporate filler. Output ONLY the reply text — no quotes, no preamble, no markdown.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0.5,
      system,
      messages: [{ role: "user", content: `${outboundText ? `Your last message to the lead${forcedLangName ? "" : " (this sets the conversation language — reply in this same language)"}:\n${outboundText}\n\n` : ""}Lead's reply (answer THIS):\n${leadMessage}` }],
    });
    const draft = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
    if (!draft) return NextResponse.json({ error: "empty draft" }, { status: 502 });
    return NextResponse.json({
      draft,
      channel: (lastReply as any)?.channel ?? null,
      answering: leadMessage,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "draft failed" }, { status: 502 });
  }
}
