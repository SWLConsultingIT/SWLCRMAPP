// POST /api/campaigns/preview-tailor
//
// Wizard Step 4 "Sample messages" — full per-lead generation for 3
// sample leads via the V8 workflow (OpenAI gpt-5-mini). Same logic
// as wizard-batch-preview but capped to PREVIEW_MAX_LEADS and never
// persists. Lets the seller eyeball the AI output before paying for
// the full batch.
//
// Body: {
//   leadIds: string[],          // 1-PREVIEW_MAX_LEADS
//   companyBioId: string,
//   icpProfileId?: string,
//   sellerId?: string,
//   steps: Array<{ channel; body; subject?; user_prompt? }>,
//   connectionRequest?: string,
//   language?: string,
// }
//
// Returns: {
//   ok: true,
//   leads: Array<{
//     leadId, name, company, role,
//     rendered: { connectionRequest?: string, steps: { channel, subject?, body }[] }
//   }>
// }

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const maxDuration = 120;

const V8_WEBHOOK = "https://n8n.srv949269.hstgr.cloud/webhook/generate-campaign-messages-v3";
const PREVIEW_MAX_LEADS = 3;
const CONCURRENCY = 3;

type StepIn = { channel: string; body: string; subject?: string | null; user_prompt?: string };
type GeneratedStep = { step_number?: number; type?: string; channel: string; subject?: string | null; body: string };

async function bulkParallel<I, O>(items: I[], fn: (item: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
  return out;
}

async function callV8(payload: Record<string, unknown>): Promise<{ messages: GeneratedStep[]; connectionRequest: string | null } | null> {
  try {
    const res = await fetch(V8_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as { messages?: GeneratedStep[]; connectionRequest?: string | null } | null;
    if (!data) return null;
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      connectionRequest: data.connectionRequest ?? null,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  type Body = {
    leadIds?: string[];
    icpProfileId?: string;
    companyBioId?: string;
    sellerId?: string;
    steps?: StepIn[];
    connectionRequest?: string;
    language?: string;
  };
  const body = (await req.json().catch(() => ({}))) as Body;
  const { leadIds, icpProfileId, companyBioId, sellerId, steps, connectionRequest, language } = body;

  if (!Array.isArray(leadIds) || leadIds.length === 0) return NextResponse.json({ error: "leadIds required" }, { status: 400 });
  if (!companyBioId) return NextResponse.json({ error: "companyBioId required" }, { status: 400 });
  if (!Array.isArray(steps) || steps.length === 0) return NextResponse.json({ error: "steps required" }, { status: 400 });
  if (scope.isScoped && companyBioId !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = getSupabaseService();
  const limited = leadIds.slice(0, PREVIEW_MAX_LEADS);
  const { data: leadRows } = await svc.from("leads")
    .select("id, primary_first_name, primary_last_name, primary_title_role, company_name, company_bio_id")
    .in("id", limited);
  const leadsRaw = (leadRows ?? []) as Array<{ id: string; primary_first_name?: string | null; primary_last_name?: string | null; primary_title_role?: string | null; company_name?: string | null; company_bio_id?: string | null }>;
  const leak = leadsRaw.filter(l => l.company_bio_id !== companyBioId);
  if (leak.length > 0) return NextResponse.json({ error: `${leak.length} lead(s) belong to a different tenant` }, { status: 403 });

  const v8Sequence = steps.map((s, i) => ({
    channel: s.channel || "linkedin",
    daysAfter: i === 0 ? 0 : 3,
    body: s.body && s.body.trim().length > 0 ? s.body : undefined,
    user_prompt: s.user_prompt && s.user_prompt.trim().length > 0 ? s.user_prompt : undefined,
  }));
  const channelMessages = {
    steps: steps.map(s => ({ channel: s.channel, body: s.body ?? "", subject: s.subject ?? null, user_prompt: s.user_prompt ?? "" })),
    connectionRequest: connectionRequest ?? null,
  };

  const leads = await bulkParallel(leadsRaw, async (lead) => {
    const v8Res = await callV8({
      sequence: v8Sequence,
      lead_id: lead.id,
      icp_profile_id: icpProfileId ?? null,
      company_bio_id: companyBioId,
      language: language ?? "en",
      signals: [],
      flow_type: "generic",
      channelMessages,
      seller_id: sellerId ?? null,
      auto_reply_type: null,
    });

    const generatedSteps = v8Res?.messages ?? [];
    const generatedCR = v8Res?.connectionRequest ?? null;

    const renderedSteps = steps.map((s, i) => {
      const match = generatedSteps.find(g => g.step_number === i) ?? generatedSteps[i];
      return {
        channel: s.channel,
        subject: match?.subject ?? s.subject ?? null,
        body: match?.body ?? "",
      };
    });

    const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "(unnamed)";
    return {
      leadId: lead.id,
      name,
      company: lead.company_name ?? null,
      role: lead.primary_title_role ?? null,
      rendered: { ...(generatedCR ? { connectionRequest: generatedCR } : {}), steps: renderedSteps },
    };
  });

  return NextResponse.json({ ok: true, leads });
}
