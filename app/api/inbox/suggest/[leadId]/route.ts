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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const svc = getSupabaseService();

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

  const system = `You are drafting a sales reply on behalf of ${sellerCompany} to a B2B lead.
The lead is ${leadName} from ${leadCompany}.

WHO ${sellerCompany} IS (use this exact framing — never invent or substitute another company):
- Description: ${bio?.company_description || bio?.description || ""}
- Value proposition: ${bio?.value_proposition || ""}
- Differentiators: ${joinList(bio?.differentiators)}
- Main services: ${joinList(bio?.main_services)}
- Brand tone: ${bio?.tone_of_voice || ""}

THE LEAD'S ICP — ${icp?.profile_name || ""}:
- Their pains: ${joinList(icp?.pain_points)}
- What we solve for them: ${joinList(icp?.solutions_offered)}

Write a reply that ANSWERS the lead's actual message directly, weaves in ONE of their ICP pains + how we solve it, and includes ONE concrete proof point from the differentiators/services (a client name or a hard metric — never invent one). End with ONE soft next step.

FORMAT: same language as the lead's message, no greeting line, no subject, no signature block (first name only if any), 2-4 sentences max, peer-to-peer and specific, no corporate filler. Output ONLY the reply text — no quotes, no preamble, no markdown.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0.5,
      system,
      messages: [{ role: "user", content: `Lead's message:\n${leadMessage}` }],
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
