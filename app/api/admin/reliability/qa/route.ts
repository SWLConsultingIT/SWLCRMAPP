// /api/admin/reliability/qa — relay endpoint for the Reliability Q&A bot.
// Frontend (QABot.tsx) sends { bioId, question } here; we collect a fresh
// tenant summary + history (so the LLM has grounded context) and forward
// the bundle to an n8n webhook that runs the actual LLM (LAW: all AI
// calls MUST go through n8n workflows, NEVER direct from Next.js to
// Anthropic/OpenAI — see feedback_always_use_n8n_workflows.md).
//
// The n8n side is the workflow `SWL - CRM - Reliability Q&A` (to be
// created with n8n-MCP). Until that workflow exists + the env var
// `RELIABILITY_QA_WEBHOOK_URL` is wired in Vercel, this endpoint
// returns a friendly 503 so the UI says "not configured yet".

import { NextResponse } from "next/server";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { getTenantSummary } from "@/lib/reliability-summary";
import { getTenantHistory } from "@/lib/reliability-history";
import { getSupabaseService } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null) as { bioId?: string; question?: string } | null;
  if (!body?.bioId || !body.question?.trim()) {
    return NextResponse.json({ error: "bioId + question required" }, { status: 400 });
  }
  const url = process.env.RELIABILITY_QA_WEBHOOK_URL;
  if (!url) {
    return NextResponse.json({ error: "RELIABILITY_QA_WEBHOOK_URL not set — create the n8n workflow first" }, { status: 503 });
  }

  // Look up tenant name (for the LLM context).
  const svc = getSupabaseService();
  const { data: bioRow } = await svc.from("company_bios").select("company_name").eq("id", body.bioId).maybeSingle();
  const bioName = (bioRow as { company_name: string | null } | null)?.company_name ?? "Unknown";

  // Collect the grounded context — same data the page already renders.
  const [summary, history] = await Promise.all([
    getTenantSummary(body.bioId, bioName),
    getTenantHistory(body.bioId),
  ]);

  const payload = {
    bio_id: body.bioId,
    bio_name: bioName,
    question: body.question.trim(),
    summary, // full TenantSummary
    history, // last 50 events
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return NextResponse.json({ error: `n8n returned ${r.status}: ${txt.slice(0, 200)}` }, { status: 502 });
    }
    const data = await r.json().catch(() => null) as { answer?: string } | null;
    return NextResponse.json({ answer: data?.answer ?? "(workflow returned no `answer` field)" });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "n8n call failed" }, { status: 502 });
  }
}
