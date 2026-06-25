import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

// Lead Copilot — a grounded Q&A chat about a single lead. The seller asks
// questions ("how do I handle the price objection?", "what's the strongest
// angle?", "summarise the last call") and gets a tactical answer grounded ONLY
// in this lead's data: enrichment, company, ICP/our offering, call transcripts,
// replies, notes, plus the cached pre-call brief and deep-dive.
//
// Memory: each turn is appended to leads.ai_chat (a JSONB array) so the seller
// has a persistent per-lead conversation — the seed of the cross-prospect
// "strategic memory" the team wants.
//
// LinkedIn is NOT fetched per question (one profile view per brief, human pace
// — never per chat turn). The brief/deep-dive already encode the LinkedIn read.
//
// NOTE: LLM is called directly here (read-time, on-demand), consistent with the
// brief/deep-dive. n8n migration deferred.

type Turn = { role: "user" | "assistant"; text: string; at: string };
const MAX_TURNS = 40;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const svc = getSupabaseService();
  const { data } = await svc.from("leads").select("ai_chat").eq("id", id).single();
  const history = Array.isArray((data as any)?.ai_chat) ? (data as any).ai_chat as Turn[] : [];
  return NextResponse.json({ history });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Empty question" }, { status: 400 });
  const locale: string = typeof body?.locale === "string" ? body.locale : "en";
  const langInstruction = locale === "es" ? " Respond in Spanish." : " Respond in English.";

  const svc = getSupabaseService();
  const { data: leadRow } = await svc.from("leads").select("*").eq("id", id).single();
  if (!leadRow) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  let lead: Record<string, unknown> = leadRow;
  if (leadRow.source === "client" && leadRow.encrypted_payload && leadRow.company_bio_id) {
    try {
      const { key } = await resolveTenantKey(leadRow.company_bio_id as string);
      lead = { ...leadRow, ...decryptWithResolvedKey(bufferFromSupabaseBytea(leadRow.encrypted_payload), key) };
    } catch { /* keep redacted */ }
  }

  const history: Turn[] = Array.isArray((leadRow as any).ai_chat) ? (leadRow as any).ai_chat : [];

  // Gather grounding context (all already-stored — no live LinkedIn fetch).
  const [icpRes, bioRes, callsRes, repliesRes, notesRes] = await Promise.all([
    lead.icp_profile_id ? svc.from("icp_profiles").select("profile_name, solutions_offered, pain_points").eq("id", lead.icp_profile_id as string).single() : Promise.resolve({ data: null }),
    lead.company_bio_id ? svc.from("company_bios").select("value_proposition, main_services").eq("id", lead.company_bio_id as string).single() : Promise.resolve({ data: null }),
    svc.from("calls").select("classification, ai_summary, summary, transcript, started_at").eq("lead_id", id).order("started_at", { ascending: false }).limit(5),
    svc.from("lead_replies").select("channel, classification, reply_text, received_at").eq("lead_id", id).order("received_at", { ascending: false }).limit(8),
    svc.from("lead_notes").select("content, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(8),
  ]);
  const icp = (icpRes as any).data; const bio = (bioRes as any).data;
  const calls = ((callsRes as any).data ?? []) as any[];
  const replies = ((repliesRes as any).data ?? []) as any[];
  const notes = ((notesRes as any).data ?? []) as any[];

  const enrichment = (lead.enrichment as Record<string, unknown> | null) ?? {};
  const enrDump = Object.entries(enrichment).filter(([k, v]) => k !== "source_file" && v != null && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");

  const brief = Array.isArray(lead.call_talking_points)
    ? (lead.call_talking_points as any[]).map((p) => typeof p === "object" ? `${p.type}: ${p.text}` : String(p)).join("\n")
    : "";
  let deepDive = "";
  if (typeof lead.ai_summary === "string" && lead.ai_summary) {
    try { const s = JSON.parse(lead.ai_summary); if (Array.isArray(s)) deepDive = s.map((x: any) => `${x.heading}: ${x.body}`).join("\n"); else deepDive = lead.ai_summary as string; }
    catch { deepDive = lead.ai_summary as string; }
  }

  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "the lead";
  const context = [
    `LEAD: ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}`,
    `Industry: ${lead.company_industry ?? "—"} · Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ") || "—"} · Status: ${lead.status ?? "—"}`,
    lead.primary_headline ? `Headline: ${lead.primary_headline}` : "",
    lead.organization_description ? `Company: ${String(lead.organization_description).slice(0, 600)}` : "",
    lead.website_summary ? `Website summary: ${String(lead.website_summary).slice(0, 400)}` : "",
    lead.seller_notes ? `Seller notes: ${lead.seller_notes}` : "",
    enrDump ? `ENRICHMENT:\n${enrDump}` : "",
    (icp || bio) ? `OUR OFFERING — offering: ${icp?.solutions_offered ?? bio?.main_services ?? ""} | value prop: ${bio?.value_proposition ?? ""} | pain we solve: ${icp?.pain_points ?? ""}` : "",
    brief ? `PRE-CALL BRIEF:\n${brief}` : "",
    deepDive ? `DEEP-DIVE RESEARCH:\n${deepDive.slice(0, 1800)}` : "",
    calls.length ? `RECENT CALLS:\n${calls.map((c) => `- [${c.classification ?? "?"}] ${(c.ai_summary || c.summary || (c.transcript ? String(c.transcript).slice(0, 400) : "")) || "(no detail)"}`).join("\n")}` : "",
    replies.length ? `REPLIES:\n${replies.map((r) => `- [${r.channel}/${r.classification ?? "?"}] ${String(r.reply_text ?? "").slice(0, 300)}`).join("\n")}` : "",
    notes.length ? `NOTES:\n${notes.map((n) => `- ${String(n.content ?? "").slice(0, 300)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const priorTurns = history.slice(-6).map((t) => ({ role: t.role, content: t.text }));

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      temperature: 0.4,
      system: `You are a sharp B2B sales strategist embedded in a CRM, helping a seller work ONE specific lead. Answer the seller's question using ONLY the CONTEXT about this lead. Be concise and tactical — 2-6 sentences or short bullets, no preamble. If the question is about psychology/approach, give a concrete, human read. If something isn't in the data, say so briefly and give your best inference clearly flagged as inference. NEVER invent specific facts (names, companies, numbers) that aren't in the context.${langInstruction}\n\nCONTEXT:\n${context}`,
      messages: [...priorTurns, { role: "user", content: question }] as any,
    });
    const answer = (res.content[0].type === "text" ? res.content[0].text : "").trim();
    if (!answer) return NextResponse.json({ error: "Empty answer" }, { status: 500 });

    const now = new Date().toISOString();
    const updated: Turn[] = [...history, { role: "user" as const, text: question, at: now }, { role: "assistant" as const, text: answer, at: now }].slice(-MAX_TURNS);
    await svc.from("leads").update({ ai_chat: updated }).eq("id", id);

    return NextResponse.json({ answer, history: updated });
  } catch (e) {
    console.error("[lead-ask] failed", id, e);
    return NextResponse.json({ error: "AI call failed" }, { status: 500 });
  }
}
