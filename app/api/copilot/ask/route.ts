import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { hydrateClientLeads } from "@/lib/leads-crypto";

// Cross-prospect Copilot — the "strategic memory" over ALL of a tenant's
// prospects. Answers questions that span the book: "compare the objections from
// my last 10 construction prospects", "what's working in our openers?", "which
// prospects mentioned budget?". Grounded in the actual interaction corpus
// (replies + classified calls) across the tenant, scoped by company_bio_id.
//
// v1 is "RAG-lite": instead of a vector store we pull the recent interaction
// corpus (replies + calls, which hold the objections/reactions) and let Haiku
// reason + compare across it. Plenty for a book of recent interactions; a
// vector index can come later if the corpus outgrows the context window.

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Empty question" }, { status: 400 });
  const history: { role: "user" | "assistant"; text: string }[] = Array.isArray(body?.history) ? body.history : [];

  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId : null;
  if (!bioId) return NextResponse.json({ error: "No tenant in scope" }, { status: 400 });

  const svc = getSupabaseService();

  // Interaction corpus, tenant-scoped via the leads join. Replies + classified
  // calls are where objections/reactions live.
  const leadSel = "id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, company_industry, primary_title_role, company_bio_id";
  const [repliesRes, callsRes] = await Promise.all([
    svc.from("lead_replies")
      .select(`reply_text, classification, channel, received_at, leads!inner(${leadSel})`)
      .eq("leads.company_bio_id", bioId)
      .neq("classification", "auto_reply")
      .order("received_at", { ascending: false })
      .limit(90),
    svc.from("calls")
      .select(`classification, summary, ai_summary, started_at, leads!inner(${leadSel})`)
      .eq("leads.company_bio_id", bioId)
      .not("classification", "is", null)
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  const replies = ((repliesRes as any).data ?? []) as any[];
  const calls = ((callsRes as any).data ?? []) as any[];

  // Decrypt client-source lead names so the corpus isn't full of "Unknown".
  const allNested = [...replies, ...calls].map(r => r.leads).filter(Boolean);
  const hydrated = await hydrateClientLeads(allNested);
  const byId = new Map(hydrated.map((l: any) => [l.id, l]));
  const nameOf = (lead: any) => {
    const h = lead ? byId.get(lead.id) ?? lead : null;
    const nm = h ? `${h.primary_first_name ?? ""} ${h.primary_last_name ?? ""}`.trim() : "";
    const co = h?.company_name ?? "";
    const ind = h?.company_industry ?? "";
    return { who: nm || "Unknown", co, ind };
  };

  const replyLines = replies.map((r) => {
    const { who, co, ind } = nameOf(r.leads);
    return `- ${who}${co ? ` @ ${co}` : ""}${ind ? ` [${ind}]` : ""} · ${r.channel}/${r.classification ?? "?"}: ${String(r.reply_text ?? "").replace(/\s+/g, " ").slice(0, 260)}`;
  });
  const callLines = calls.map((c) => {
    const { who, co, ind } = nameOf(c.leads);
    const detail = (c.ai_summary || c.summary || "").replace(/\s+/g, " ").slice(0, 220);
    return `- ${who}${co ? ` @ ${co}` : ""}${ind ? ` [${ind}]` : ""} · call/${c.classification}${detail ? `: ${detail}` : ""}`;
  });

  if (replyLines.length === 0 && callLines.length === 0) {
    return NextResponse.json({ answer: "No interaction history yet across your prospects — once replies and calls come in, I can compare objections, reactions and what's working." });
  }

  const corpus = [
    replyLines.length ? `REPLIES (most recent first):\n${replyLines.join("\n")}` : "",
    callLines.length ? `CALL OUTCOMES (most recent first):\n${callLines.join("\n")}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 14000);

  const priorTurns = history.slice(-6).map((t) => ({ role: t.role, content: t.text }));

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1100,
      temperature: 0.4,
      system: `You are the team's sales Copilot with memory across ALL their prospects. Answer the question by analysing and comparing the INTERACTION CORPUS below (replies + call outcomes across the book). Look for patterns: common objections, what messaging gets positive reactions, by industry/seniority where relevant. Be concrete and cite specific prospects (name @ company) as evidence. Concise and structured (short bullets). Use ONLY the corpus; if it doesn't cover something, say so. Never invent prospects or quotes.\n\nINTERACTION CORPUS:\n${corpus}`,
      messages: [...priorTurns, { role: "user", content: question }] as any,
    });
    const answer = (res.content[0].type === "text" ? res.content[0].text : "").trim();
    if (!answer) return NextResponse.json({ error: "Empty answer" }, { status: 500 });
    return NextResponse.json({ answer, corpusSize: replyLines.length + callLines.length });
  } catch (e) {
    console.error("[copilot-ask] failed", e);
    return NextResponse.json({ error: "AI call failed" }, { status: 500 });
  }
}
