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
import { getTenantSummary, getAllTenantSummaries, buildGlobalSummary } from "@/lib/reliability-summary";
import { getTenantHistory } from "@/lib/reliability-history";
import { getSupabaseService } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 60;

// n8n webhook for the Q&A bot. The workflow lives at
// `SWL - CRM - Reliability Q&A` (yD8iKMNg9grcRMs7) and uses Anthropic
// Haiku grounded on the payload we POST here. Hardcoded (same pattern
// as other n8n webhooks the repo calls — keeps everything portable
// across hosting platforms instead of behind a Vercel env var).
const N8N_BASE = (process.env.N8N_API_BASE_URL ?? "https://n8n.srv949269.hstgr.cloud").replace(/\/+$/, "");
const QA_WEBHOOK_URL = `${N8N_BASE}/webhook/swl-crm-reliability-qa`;

export async function POST(req: Request) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null) as { bioId?: string; question?: string } | null;
  if (!body?.bioId || !body.question?.trim()) {
    return NextResponse.json({ error: "bioId + question required" }, { status: 400 });
  }
  const url = QA_WEBHOOK_URL;

  // 'general' = ask about the whole org (all tenants). Otherwise scoped
  // to one tenant.
  let payload: Record<string, unknown>;
  if (body.bioId === "general") {
    const all = await getAllTenantSummaries();
    const global = buildGlobalSummary(all);
    // Per-tenant histories sampled (top 10 each) to keep the payload small.
    const histories = await Promise.all(all.map(async t => {
      const h = await getTenantHistory(t.bioId);
      return { bioId: t.bioId, bioName: t.bioName, events: h.slice(0, 10) };
    }));
    payload = {
      bio_id: "general",
      bio_name: "Todos los tenants",
      question: body.question.trim(),
      scope: "global",
      global,         // GlobalSummary (KPIs + tenant verdicts + sellers)
      tenants: all,   // full per-tenant summaries
      histories,      // per-tenant top-10 events
    };
  } else {
    const svc = getSupabaseService();
    const { data: bioRow } = await svc.from("company_bios").select("company_name").eq("id", body.bioId).maybeSingle();
    const bioName = (bioRow as { company_name: string | null } | null)?.company_name ?? "Unknown";
    const [summary, history] = await Promise.all([
      getTenantSummary(body.bioId, bioName),
      getTenantHistory(body.bioId),
    ]);
    payload = {
      bio_id: body.bioId,
      bio_name: bioName,
      question: body.question.trim(),
      scope: "tenant",
      summary, // full TenantSummary
      history, // last 50 events
    };
  }

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
