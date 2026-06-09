// POST /api/campaigns/wizard-batch-preview
//
// FULL PER-LEAD generation (Fran 2026-06-09 spec). For every lead in
// the batch, calls the V8 workflow once and gets back a complete
// sequence (one body per step) UNIQUE to that lead — bio + ICP +
// the lead's specific signals (LinkedIn post, news, tech stack, etc).
// NO template + slot substitution: every message body is generated
// fresh per lead, so leads with different signals receive different
// pitches, openers, and CTAs.
//
// Persists into campaign_requests.message_prompts.preview_outputs
// (jsonb existing column). The approve route's tailor pass reads from
// here and writes the body directly to campaign_messages.content —
// no slot substitution at that stage either.
//
// Body: {
//   campaignRequestId?: string,
//   leadIds: string[],
//   companyBioId: string,
//   icpProfileId?: string,
//   sellerId?: string,
//   steps: Array<{ channel; body; subject?; user_prompt? }>,
//                          // step bodies act as INTENT references; the workflow
//                          // generates fresh bodies per lead. user_prompt per
//                          // step is honored as the seller's intent.
//   connectionRequest?: string,
// }

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { validateMessage, type ViolationCode } from "@/lib/message-validator";

export const maxDuration = 300;

const V8_WEBHOOK = "https://n8n.srv949269.hstgr.cloud/webhook/generate-campaign-messages-v3";
const CONCURRENCY = 8; // V8 + Pinecone tolerates moderate concurrency

type StepIn = { channel: string; body: string; subject?: string | null; user_prompt?: string };

type GeneratedStep = { step_number?: number; type?: string; channel: string; subject?: string | null; body: string };

type ResultRow = {
  leadId: string;
  name: string;
  company: string | null;
  role: string | null;
  rendered: { connectionRequest?: string; steps: Array<{ channel: string; subject?: string | null; body: string }> };
  violations: ViolationCode[];
};

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
    campaignRequestId?: string;
    leadIds?: string[];
    companyBioId?: string;
    icpProfileId?: string;
    sellerId?: string;
    steps?: StepIn[];
    connectionRequest?: string;
    language?: string;
  };
  const body = (await req.json().catch(() => ({}))) as Body;
  const { campaignRequestId, leadIds, companyBioId, icpProfileId, sellerId, steps, connectionRequest, language } = body;

  if (!Array.isArray(leadIds) || leadIds.length === 0) return NextResponse.json({ error: "leadIds required" }, { status: 400 });
  if (!companyBioId) return NextResponse.json({ error: "companyBioId required" }, { status: 400 });
  if (!Array.isArray(steps) || steps.length === 0) return NextResponse.json({ error: "steps required" }, { status: 400 });
  if (scope.isScoped && companyBioId !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = getSupabaseService();
  // Tenant guard via leads.
  const { data: leadRows } = await svc.from("leads")
    .select("id, primary_first_name, primary_last_name, primary_title_role, company_name, company_bio_id")
    .in("id", leadIds);
  const leadsRaw = (leadRows ?? []) as Array<{ id: string; primary_first_name?: string | null; primary_last_name?: string | null; primary_title_role?: string | null; company_name?: string | null; company_bio_id?: string | null }>;
  const leak = leadsRaw.filter(l => l.company_bio_id !== companyBioId);
  if (leak.length > 0) return NextResponse.json({ error: `${leak.length} lead(s) belong to a different tenant` }, { status: 403 });

  // Build the V8 sequence payload from the wizard's step list.
  const v8Sequence = steps.map((s, i) => ({
    channel: s.channel || "linkedin",
    daysAfter: i === 0 ? 0 : 3,
    body: s.body && s.body.trim().length > 0 ? s.body : undefined,
    user_prompt: s.user_prompt && s.user_prompt.trim().length > 0 ? s.user_prompt : undefined,
  }));
  // channelMessages mirror so the workflow can apply [WIZARD OVERRIDE]
  // if the seller wrote a body to use verbatim for some step.
  const channelMessages = {
    steps: steps.map(s => ({ channel: s.channel, body: s.body ?? "", subject: s.subject ?? null, user_prompt: s.user_prompt ?? "" })),
    connectionRequest: connectionRequest ?? null,
  };

  const results: ResultRow[] = await bulkParallel(leadsRaw, async (lead) => {
    const v8Res = await callV8({
      sequence: v8Sequence,
      lead_id: lead.id,
      icp_profile_id: icpProfileId ?? null,
      company_bio_id: companyBioId,
      language: language ?? "en",
      signals: [],
      // flow_type 'generic' here — we don't want the workflow to embed
      // tailored slots. Every body IS the per-lead final body; no
      // downstream substitution.
      flow_type: "generic",
      channelMessages,
      seller_id: sellerId ?? null,
      auto_reply_type: null,
    });

    const generatedSteps = v8Res?.messages ?? [];
    const generatedCR = v8Res?.connectionRequest ?? null;

    // Map back to the wizard's step order. The V8 returns messages with
    // step_number — fall back to position if missing.
    const renderedSteps: Array<{ channel: string; subject?: string | null; body: string }> = steps.map((s, i) => {
      const match = generatedSteps.find(g => g.step_number === i) ?? generatedSteps[i];
      return {
        channel: s.channel,
        subject: match?.subject ?? s.subject ?? null,
        body: match?.body ?? "",
      };
    });

    // Validate
    const allCodes = new Set<ViolationCode>();
    if (generatedCR) {
      const r = validateMessage({ type: "LINKEDIN_CONNECTION_REQUEST", body: generatedCR }, undefined);
      r.violations.forEach(v => allCodes.add(v.code));
    }
    for (const rs of renderedSteps) {
      const r = validateMessage({ type: undefined, body: rs.body }, undefined);
      r.violations.forEach(v => allCodes.add(v.code));
    }

    const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "(unnamed)";
    return {
      leadId: lead.id,
      name,
      company: lead.company_name ?? null,
      role: lead.primary_title_role ?? null,
      rendered: { ...(generatedCR ? { connectionRequest: generatedCR } : {}), steps: renderedSteps },
      violations: Array.from(allCodes),
    };
  });

  // Persist for the approve hand-off so the tailor pass can write
  // straight to campaign_messages.content without a second AI call.
  if (campaignRequestId) {
    const previewOutputs: Record<string, unknown> = {};
    for (const r of results) {
      previewOutputs[r.leadId] = {
        full_messages: r.rendered.steps,
        connectionRequest: r.rendered.connectionRequest ?? null,
        violations: r.violations,
        generated_at: new Date().toISOString(),
      };
    }
    const { data: existing } = await svc.from("campaign_requests")
      .select("message_prompts")
      .eq("id", campaignRequestId)
      .maybeSingle();
    const currentMessagePrompts = ((existing?.message_prompts as Record<string, unknown> | null) ?? {});
    const next = { ...currentMessagePrompts, preview_outputs: previewOutputs };
    await svc.from("campaign_requests").update({ message_prompts: next }).eq("id", campaignRequestId);
  }

  const byCode: Partial<Record<ViolationCode, number>> = {};
  let withIssues = 0;
  for (const r of results) {
    if (r.violations.length > 0) withIssues++;
    for (const c of r.violations) byCode[c] = (byCode[c] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    results,
    summary: { total: results.length, ok: results.length - withIssues, withIssues, byCode },
  });
}
