// POST /api/templates/{id}/launch — bulk-create campaigns from a template.
//
// Body: { assignments: [{ lead_id, seller_id }, ...] }
//
// One assignment = one campaign. The template body (sequence_steps,
// step_messages, channels) is the template instance — the same content goes
// into every campaign and gets personalized per-lead by the n8n dispatcher
// at send time (honoring rewrite_mode).
//
// Validation:
//   - Template belongs to caller's tenant.
//   - Every lead is in the same tenant AND matches the template's
//     icp_profile_id (legacy templates without an ICP skip this check).
//   - Every seller is either tenant-owned or in the shared_with array.
//
// Returns: { campaigns_created, campaign_ids, errors? }

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { autoNormalizePlaceholders } from "@/lib/placeholders";

type Assignment = { lead_id: string; seller_id: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: templateId } = await params;
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { assignments?: Assignment[] };
  const assignments = (body.assignments ?? []).filter(a => a?.lead_id && a?.seller_id);
  if (assignments.length === 0) {
    return NextResponse.json({ error: "assignments[] is required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // 1. Load the template, scoped to tenant.
  const { data: tpl } = await svc
    .from("campaign_templates")
    .select("id, name, sequence_steps, step_messages, channels, icp_profile_id, tone_preset, rewrite_mode, voice_anchor_seller_id")
    .eq("id", templateId)
    .eq("company_bio_id", scope.companyBioId)
    .maybeSingle();
  if (!tpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const rawSequence = Array.isArray(tpl.sequence_steps) ? tpl.sequence_steps : [];
  const stepMessages = (tpl.step_messages ?? {}) as {
    connectionRequest?: string;
    steps?: Array<{
      step: number;
      channel: string;
      subject?: string | null;
      body: string;
      attachments?: Array<{ path: string; name: string; mimeType: string; sizeBytes: number }>;
    }>;
  };
  const channels = Array.isArray(tpl.channels) ? tpl.channels : [];

  // Templates persist per-step attachments inside step_messages.steps[i].attachments.
  // Copy them onto the sequence array so the row inserted into campaigns.sequence_steps
  // matches the shape the email + LinkedIn dispatchers read (signStepAttachments
  // looks at `sequence_steps[i].attachments`). Keep the original sequence_steps
  // intact for any non-attachment fields the template may carry (subject, etc.).
  const messageStepsForMerge = Array.isArray(stepMessages.steps) ? stepMessages.steps : [];
  const sequence: Array<{ channel: string; daysAfter: number; attachments?: unknown }> = rawSequence.map((raw: unknown, i: number) => {
    const step = raw as { channel: string; daysAfter: number };
    const msg = messageStepsForMerge.find(m => m.step === i + 1) ?? messageStepsForMerge[i];
    if (!msg || !Array.isArray(msg.attachments) || msg.attachments.length === 0) return step;
    return { ...step, attachments: msg.attachments };
  });

  if (sequence.length === 0) {
    return NextResponse.json({ error: "Template has no sequence steps" }, { status: 400 });
  }

  // 2. Validate leads: same tenant + same ICP as the template (if template
  //    has an ICP — legacy templates without one accept any tenant lead).
  const leadIds = Array.from(new Set(assignments.map(a => a.lead_id)));
  let leadQ = svc.from("leads").select("id, company_bio_id, icp_profile_id").in("id", leadIds);
  const { data: leadRows } = await leadQ;
  const leadById = new Map((leadRows ?? []).map(l => [l.id, l]));
  const invalidLeads: string[] = [];
  for (const lid of leadIds) {
    const l = leadById.get(lid);
    if (!l) { invalidLeads.push(lid); continue; }
    if (l.company_bio_id !== scope.companyBioId) { invalidLeads.push(lid); continue; }
    if (tpl.icp_profile_id && l.icp_profile_id !== tpl.icp_profile_id) { invalidLeads.push(lid); continue; }
  }
  if (invalidLeads.length > 0) {
    return NextResponse.json({
      error: `${invalidLeads.length} lead(s) don't belong to this tenant or template's ICP`,
      invalid_leads: invalidLeads,
    }, { status: 400 });
  }

  // 3. Validate sellers: must be tenant-owned OR shared with this tenant.
  const sellerIds = Array.from(new Set(assignments.map(a => a.seller_id)));
  const { data: sellerRows } = await svc
    .from("sellers")
    .select("id, company_bio_id, shared_with_company_bio_ids, active")
    .in("id", sellerIds);
  const validSellerIds = new Set<string>();
  for (const s of sellerRows ?? []) {
    const owned = s.company_bio_id === scope.companyBioId;
    const shared = Array.isArray(s.shared_with_company_bio_ids) && s.shared_with_company_bio_ids.includes(scope.companyBioId);
    if (s.active !== false && (owned || shared)) validSellerIds.add(s.id);
  }
  const invalidSellers = sellerIds.filter(s => !validSellerIds.has(s));
  if (invalidSellers.length > 0) {
    return NextResponse.json({
      error: `${invalidSellers.length} seller(s) are not accessible to this tenant`,
      invalid_sellers: invalidSellers,
    }, { status: 400 });
  }

  // Route through APPROVAL instead of auto-creating active campaigns. Build ONE
  // pending campaign_request carrying the template's sequence + messages + the
  // per-lead seller assignment. The admin approves it in /admin/review and
  // /api/campaigns/approve creates the per-lead campaigns — which (unlike the
  // old launch path) slices the LinkedIn connection-request slot correctly (no
  // empty step-1 DM) and never sends without an explicit approval. Before this,
  // "Use template" set status:"active" directly AND skipped the CR slicing →
  // 200 LATAM campaigns went live unapproved with a blank step-1 (2026-06-04).
  const effectiveChannels = channels.length > 0 ? channels : [...new Set(sequence.map((s) => s.channel))];
  const leadSellers: Record<string, string> = {};
  for (const a of assignments) leadSellers[a.lead_id] = a.seller_id;
  const sm = (tpl.step_messages ?? {}) as { connectionRequest?: string; steps?: unknown[]; autoReplies?: unknown };

  const { data: request, error: reqErr } = await svc.from("campaign_requests").insert({
    name: tpl.name,
    icp_profile_id: tpl.icp_profile_id ?? null,
    company_bio_id: scope.companyBioId,
    lead_id: null,
    channels: effectiveChannels,
    sequence_length: sequence.length,
    frequency_days: 0,
    target_leads_count: leadIds.length,
    message_prompts: {
      sequence,
      channelMessages: {
        connectionRequest: sm.connectionRequest ?? "",
        steps: Array.isArray(sm.steps) ? sm.steps : [],
        autoReplies: sm.autoReplies ?? {},
      },
      selectedLeadIds: leadIds,
      leadSellers,
      templateId: tpl.id,
    },
    status: "pending_review",
  }).select("id").single();

  if (reqErr || !request) {
    return NextResponse.json({ error: reqErr?.message ?? "Failed to create approval request" }, { status: 500 });
  }

  // Template usage bump (cosmetic, best-effort).
  try {
    const { data: cur } = await svc.from("campaign_templates").select("usage_count").eq("id", tpl.id).maybeSingle();
    await svc.from("campaign_templates")
      .update({ usage_count: (cur?.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", tpl.id).eq("company_bio_id", scope.companyBioId);
  } catch { /* swallow — cosmetic */ }

  return NextResponse.json({ pending: true, requestId: request.id, target_leads_count: leadIds.length });
}
