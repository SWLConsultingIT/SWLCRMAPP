// POST /api/campaigns/tailor
//
// FULL PER-LEAD tailor pass (Fran 2026-06-09 spec rewrite).
//
// For every (lead, step) in a campaign, write a per-lead body into
// campaign_messages.content. Two paths:
//
//   A) FAST: the wizard already ran "Validate full batch" and persisted
//      preview_outputs[leadId].full_messages on the campaign_request.
//      The approve route forwards these as `previewOutputs` and we
//      just copy them into campaign_messages — zero AI calls here.
//
//   B) FALLBACK: the seller submitted without validating. We call the
//      V8 workflow once per lead with that lead's specific data and
//      get back the full sequence. The V8 uses OpenAI gpt-5-mini and
//      respects the n8n-workflows law (no direct LLM calls from this
//      route). Concurrency-capped so 500-lead campaigns don't melt
//      the webhook.
//
// Body: {
//   campaignId: string,
//   dryRun?: boolean,
//   leadIdsLimit?: number,        // sample cap for preview UIs
//   previewOutputs?: {            // wizard hand-off (path A)
//     [leadId]: {
//       full_messages?: Array<{ channel; subject?; body }>,
//       connectionRequest?: string | null,
//     }
//   }
// }

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const V8_WEBHOOK = "https://n8n.srv949269.hstgr.cloud/webhook/generate-campaign-messages-v3";
const CONCURRENCY = 8;

type CampaignMessageRow = {
  id: string;
  lead_id: string;
  campaign_id: string;
  step_number: number;
  channel: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

type GeneratedStep = { step_number?: number; type?: string; channel: string; subject?: string | null; body: string };

type PreviewOutput = {
  full_messages?: Array<{ channel: string; subject?: string | null; body: string }>;
  connectionRequest?: string | null;
  // Legacy hook/fit shape for backward-compat reads — no longer written.
  hook?: string | null;
  fit?: string | null;
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

async function callV8ForLead(args: {
  leadId: string;
  icpProfileId: string | null;
  companyBioId: string;
  language: string;
  sequence: Array<{ channel: string; daysAfter: number; body?: string; user_prompt?: string }>;
  channelMessages: { steps: Array<{ channel: string; body: string; subject?: string | null; user_prompt?: string }>; connectionRequest: string | null };
  sellerId: string | null;
}): Promise<{ messages: GeneratedStep[]; connectionRequest: string | null } | null> {
  try {
    const res = await fetch(V8_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequence: args.sequence,
        lead_id: args.leadId,
        icp_profile_id: args.icpProfileId,
        company_bio_id: args.companyBioId,
        language: args.language,
        signals: [],
        flow_type: "generic", // already per-lead — no template slots needed
        channelMessages: args.channelMessages,
        seller_id: args.sellerId,
        auto_reply_type: null,
      }),
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

  const body = (await req.json().catch(() => ({}))) as {
    campaignId?: string;
    dryRun?: boolean;
    leadIdsLimit?: number;
    previewOutputs?: Record<string, PreviewOutput>;
  };
  const { campaignId, dryRun = false, leadIdsLimit, previewOutputs } = body;
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const svc = getSupabaseService();

  // Campaign + tenant guard.
  const { data: campaign } = await svc
    .from("campaigns")
    .select("id, name, company_bio_id, seller_id, icp_profile_id, message_prompts")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (scope.isScoped && campaign.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Pull every campaign_messages row for this campaign.
  const { data: msgsRaw } = await svc
    .from("campaign_messages")
    .select("id, lead_id, campaign_id, step_number, channel, content, metadata")
    .eq("campaign_id", campaignId);
  const allMsgs = (msgsRaw ?? []) as CampaignMessageRow[];
  if (allMsgs.length === 0) {
    return NextResponse.json({ ok: true, tailored: 0, reason: "no campaign_messages rows" });
  }

  // Unique leads in this campaign.
  const uniqueLeadIds = Array.from(new Set(allMsgs.map(m => m.lead_id)));
  const sampledLeadIds = leadIdsLimit && leadIdsLimit > 0
    ? uniqueLeadIds.slice(0, leadIdsLimit)
    : uniqueLeadIds;

  // Build full_messages map: wizard hand-off first, then V8 fallback
  // for any lead the wizard didn't pre-generate.
  const messagesByLead = new Map<string, PreviewOutput>();
  const leadsNeedingGeneration: string[] = [];
  for (const lid of sampledLeadIds) {
    const cached = previewOutputs?.[lid];
    if (cached?.full_messages && cached.full_messages.length > 0) {
      messagesByLead.set(lid, cached);
    } else {
      leadsNeedingGeneration.push(lid);
    }
  }

  // Fallback path: V8 call per lead we didn't get from the wizard.
  if (leadsNeedingGeneration.length > 0) {
    // We need the wizard's sequence template to seed the V8 call.
    // Pull it from campaign.message_prompts if the approve route
    // copied it there; otherwise fall back to inferring from the
    // existing campaign_messages rows.
    const prompts = (campaign.message_prompts as Record<string, unknown> | null) ?? {};
    const wizardSequence = Array.isArray(prompts.sequence)
      ? prompts.sequence as Array<{ channel: string; daysAfter: number; user_prompt?: string }>
      : [];
    const wizardChannelMessages = (prompts.channelMessages && typeof prompts.channelMessages === "object")
      ? prompts.channelMessages as { steps: Array<{ channel: string; body: string; subject?: string | null; user_prompt?: string }>; connectionRequest?: string | null }
      : { steps: [], connectionRequest: null };
    const language = typeof prompts.language === "string" ? prompts.language : "en";

    const v8Results = await bulkParallel(leadsNeedingGeneration, async (leadId) => {
      const res = await callV8ForLead({
        leadId,
        icpProfileId: campaign.icp_profile_id ?? null,
        companyBioId: campaign.company_bio_id,
        language,
        sequence: wizardSequence.length > 0 ? wizardSequence : (wizardChannelMessages.steps ?? []).map((s, i) => ({ channel: s.channel, daysAfter: i === 0 ? 0 : 3, body: s.body, user_prompt: s.user_prompt })),
        channelMessages: { steps: wizardChannelMessages.steps ?? [], connectionRequest: wizardChannelMessages.connectionRequest ?? null },
        sellerId: campaign.seller_id ?? null,
      });
      return { leadId, res };
    });

    for (const { leadId, res } of v8Results) {
      if (!res) continue;
      // Map V8 messages back to the wizard step shape.
      const full = res.messages.map((m, i) => ({
        channel: m.channel,
        subject: m.subject ?? null,
        body: m.body,
        step_number: m.step_number ?? i,
      }));
      messagesByLead.set(leadId, { full_messages: full, connectionRequest: res.connectionRequest });
    }
  }

  // Apply per (lead, step_number): find the matching generated body
  // and write to campaign_messages.content.
  type ApplyResult = { rowId: string; leadId: string; step_number: number; channel: string; renderedContent: string | null };
  const sampledIdSet = new Set(sampledLeadIds);
  const applyTargets = allMsgs.filter(m => sampledIdSet.has(m.lead_id));

  const results: ApplyResult[] = applyTargets.map(row => {
    const preview = messagesByLead.get(row.lead_id);
    if (!preview?.full_messages) return { rowId: row.id, leadId: row.lead_id, step_number: row.step_number, channel: row.channel, renderedContent: null };
    // step_number in DB is 1-indexed (CR = 0). The wizard's full_messages
    // array is in step order — match by index, with a small fudge: if
    // the row.step_number maps cleanly to an index, use it.
    const idx = row.step_number; // we're matching the body at position N to step N
    const generated = preview.full_messages[idx] ?? preview.full_messages.find(m => (m as { step_number?: number }).step_number === idx);
    if (!generated || !generated.body) return { rowId: row.id, leadId: row.lead_id, step_number: row.step_number, channel: row.channel, renderedContent: null };
    return { rowId: row.id, leadId: row.lead_id, step_number: row.step_number, channel: row.channel, renderedContent: generated.body };
  });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      tailored: results.filter(r => r.renderedContent).length,
      results,
    });
  }

  // Persist.
  let written = 0;
  for (const r of results) {
    if (!r.renderedContent) continue;
    const row = applyTargets.find(m => m.id === r.rowId);
    const prevMeta = (row?.metadata && typeof row.metadata === "object") ? row.metadata : {};
    await svc.from("campaign_messages").update({
      content: r.renderedContent,
      metadata: {
        ...prevMeta,
        rendered_content: r.renderedContent,
        tailored: { full_per_lead: true, tailored_at: new Date().toISOString() },
      },
    }).eq("id", r.rowId);
    written += 1;
  }

  return NextResponse.json({
    ok: true,
    tailored: written,
    failed: results.length - written,
    totalCandidates: applyTargets.length,
    fromWizardCache: sampledLeadIds.length - leadsNeedingGeneration.length,
    generatedHere: leadsNeedingGeneration.length,
    processed: results.length,
  });
}
