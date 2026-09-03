import { NextRequest, NextResponse } from "next/server";
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

  const historyStr = history.slice(-6).map((t) => `${t.role === "assistant" ? "Copilot" : "User"}: ${t.text}`).join("\n");

  try {
    // AI runs in n8n (workflow "SWL - CRM - Copilot"), NOT a direct LLM call —
    // per the "AI generation via n8n only" rule. The app assembles the corpus
    // (tenant-scoped replies + calls); n8n runs the model with the multilingual
    // + topic-gated system prompt and returns { answer }.
    const base = process.env.N8N_API_BASE_URL || "https://n8n.srv949269.hstgr.cloud";
    const res = await fetch(`${base}/webhook/copilot-ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, corpus, history: historyStr }),
    });
    if (!res.ok) throw new Error(`n8n copilot webhook ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { answer?: unknown };
    const answer = (typeof data.answer === "string" ? data.answer : "").trim();
    if (!answer) return NextResponse.json({ error: "Empty answer" }, { status: 500 });
    return NextResponse.json({ answer, corpusSize: replyLines.length + callLines.length });
  } catch (e) {
    console.error("[copilot-ask] failed", e);
    return NextResponse.json({ error: "AI call failed" }, { status: 500 });
  }
}
