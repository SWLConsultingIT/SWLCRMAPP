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

  // 4. Compute the connection-request scheduling once for the template (same
  //    sequence for every assignment). Connection request fires ~24h before
  //    the first LinkedIn step (Day 0 if LinkedIn is the first step).
  let firstLinkedinCumDay: number | null = null;
  {
    let cum = 0;
    for (let i = 0; i < sequence.length; i++) {
      cum += i === 0 ? 0 : (sequence[i].daysAfter ?? 0);
      if (sequence[i].channel === "linkedin" && firstLinkedinCumDay === null) {
        firstLinkedinCumDay = cum;
        break;
      }
    }
  }
  const connectionRequest = stepMessages.connectionRequest ?? "";
  const hasInvite = connectionRequest.length > 0 && channels.includes("linkedin");
  const messageSteps = Array.isArray(stepMessages.steps) ? stepMessages.steps : [];

  // 5. Create campaigns + messages per assignment.
  const errors: string[] = [];
  const campaignIds: string[] = [];

  for (const a of assignments) {
    const primaryChannel = sequence[0]?.channel ?? channels[0] ?? "linkedin";

    const { data: campaign, error: campErr } = await svc
      .from("campaigns")
      .insert({
        lead_id: a.lead_id,
        seller_id: a.seller_id,
        name: tpl.name,
        channel: primaryChannel,
        status: "active",
        current_step: 0,
        sequence_steps: sequence,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        // company_bio_id derived via the lead's FK in dispatcher logic;
        // set it explicitly here so cron filters and analytics don't have
        // to join just to scope.
        company_bio_id: scope.companyBioId,
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      errors.push(`Lead ${a.lead_id}: ${campErr?.message ?? "failed to create campaign"}`);
      continue;
    }
    campaignIds.push(campaign.id);

    const messageInserts: any[] = [];

    if (hasInvite) {
      const inviteOffsetDays = Math.max(0, (firstLinkedinCumDay ?? 0) - 1);
      const eligibleAt = inviteOffsetDays > 0
        ? new Date(Date.now() + inviteOffsetDays * 86400000).toISOString()
        : null;
      messageInserts.push({
        campaign_id: campaign.id,
        lead_id: a.lead_id,
        step_number: 0,
        channel: "linkedin",
        content: connectionRequest,
        status: "queued",
        created_at: new Date().toISOString(),
        metadata: eligibleAt ? { eligible_at: eligibleAt } : null,
      });
    }
    messageSteps.forEach((msg, i) => messageInserts.push({
      campaign_id: campaign.id,
      lead_id: a.lead_id,
      step_number: msg.step ?? i + 1,
      channel: msg.channel ?? sequence[i]?.channel ?? primaryChannel,
      content: msg.body ?? "",
      // Email subject lives in metadata to match the rest of the system.
      metadata: msg.subject ? { subject: msg.subject } : null,
      status: "draft",
      created_at: new Date().toISOString(),
    }));

    if (messageInserts.length > 0) {
      const { error: msgErr } = await svc.from("campaign_messages").insert(messageInserts);
      if (msgErr) errors.push(`Lead ${a.lead_id} messages: ${msgErr.message}`);
    }

    await svc.from("leads").update({ current_channel: primaryChannel }).eq("id", a.lead_id);
  }

  // 6. Bump the template's usage count + last_used_at so TemplatesView
  //    ordering and the stats strip stay current. Read-modify-write — race
  //    is acceptable (cosmetic counter, not financial). Best-effort: a
  //    failure here doesn't fail the whole launch.
  try {
    const { data: cur } = await svc
      .from("campaign_templates").select("usage_count").eq("id", tpl.id).maybeSingle();
    const next = (cur?.usage_count ?? 0) + campaignIds.length;
    await svc.from("campaign_templates")
      .update({ usage_count: next, last_used_at: new Date().toISOString() })
      .eq("id", tpl.id)
      .eq("company_bio_id", scope.companyBioId);
  } catch { /* swallow — cosmetic */ }

  return NextResponse.json({
    campaigns_created: campaignIds.length,
    campaign_ids: campaignIds,
    template_id: tpl.id,
    errors: errors.length > 0 ? errors : undefined,
  });
}
