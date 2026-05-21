import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope, canApproveCampaigns } from "@/lib/scope";

// Use service key to bypass RLS for admin operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: NextRequest) {
  // Approving a campaign request kicks off real outbound sends (LinkedIn /
  // email / call). Restrict to SWL admins. Without this gate, any logged-in
  // user could POST a known requestId and trigger sends on a tenant they
  // don't own. Middleware already enforces authentication on this path.
  const scope = await getUserScope();
  if (!canApproveCampaigns(scope.tier)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { requestId } = await req.json();

  if (!requestId) {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }

  // 1. Fetch the campaign request
  const { data: request, error: fetchErr } = await supabase
    .from("campaign_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Campaign request not found" }, { status: 404 });
  }

  if (request.status !== "pending_review") {
    return NextResponse.json({ error: `Request is already ${request.status}` }, { status: 400 });
  }

  const prompts = request.message_prompts ?? {};
  const sequence: { channel: string; daysAfter: number }[] = prompts.sequence ?? [];
  const channels: string[] = request.channels ?? [...new Set(sequence.map((s: any) => s.channel))];

  // call_advance_mode: 'auto' (default, pre-2026-05-21 behavior) lets the
  // dispatch-call cron auto-dial + advance past the call step regardless of
  // outcome. 'manual' freezes the sequence at the call step until the seller
  // dials via /api/aircall/dial. The wizard surfaces this as a radio button
  // and ships it inside message_prompts.callAdvanceMode.
  const rawMode = (prompts as any).callAdvanceMode;
  const callAdvanceMode: "auto" | "manual" = rawMode === "manual" ? "manual" : "auto";

  // Support both old format (messages[]) and new format (channelMessages.steps[])
  let messages: { step: number; channel: string; subject?: string | null; body: string }[] = [];
  let autoReplies: { positive?: string; negative?: string } = {};

  if (prompts.channelMessages?.steps?.length > 0) {
    // New structured format
    messages = prompts.channelMessages.steps.map((s: any, i: number) => ({
      step: i + 1,
      channel: s.channel ?? sequence[i]?.channel ?? "linkedin",
      subject: s.subject ?? null,
      body: s.body ?? "",
    }));
    autoReplies = {
      positive: prompts.channelMessages.autoReplies?.positive ?? "",
      negative: prompts.channelMessages.autoReplies?.negative ?? "",
    };
  } else if (prompts.messages?.length > 0) {
    // Old flat format
    messages = prompts.messages;
  }

  // Selected lead IDs from partial selection
  const selectedLeadIds: string[] = prompts.selectedLeadIds ?? [];

  // 2. Get the leads to create campaigns for
  let leadIds: string[] = [];

  if (request.lead_id) {
    // Individual lead campaign
    leadIds = [request.lead_id];
  } else if (selectedLeadIds.length > 0) {
    // Partial selection from profile
    leadIds = selectedLeadIds;
  } else if (request.icp_profile_id) {
    // Bulk campaign for all uncampaigned leads in this ICP profile
    const { data: profileLeads } = await supabase
      .from("leads")
      .select("id")
      .eq("icp_profile_id", request.icp_profile_id);

    const allIds = (profileLeads ?? []).map(l => l.id);

    // Exclude leads that already have an active/paused campaign
    if (allIds.length > 0) {
      const { data: existingCampaigns } = await supabase
        .from("campaigns")
        .select("lead_id")
        .in("lead_id", allIds)
        .in("status", ["active", "paused"]);

      const activeLids = new Set((existingCampaigns ?? []).map(c => c.lead_id));
      leadIds = allIds.filter(id => !activeLids.has(id));
    }
  }

  if (leadIds.length === 0) {
    // Still approve the request but no campaigns to create
    await supabase.from("campaign_requests").update({ status: "approved" }).eq("id", requestId);
    return NextResponse.json({ approved: true, campaignsCreated: 0, message: "No eligible leads found" });
  }

  // 3. Resolve seller assignment per lead.
  //    Multi-seller: prompts.sellerQuotas = [{ sellerId, quota }] distributes leads
  //    in order (first quota[0].quota leads → seller 0, next quota[1].quota → seller 1…).
  //    Single-seller: falls back to prompts.sellerId, then to the first active tenant seller.
  const sellerQuotas: { sellerId: string; quota: number }[] | null =
    Array.isArray(prompts.sellerQuotas) && prompts.sellerQuotas.length > 1
      ? prompts.sellerQuotas
      : null;

  // Build per-lead seller map when multiple quotas are set.
  const leadSellerMap = new Map<string, string>();
  if (sellerQuotas) {
    let offset = 0;
    for (const q of sellerQuotas) {
      const slice = leadIds.slice(offset, offset + q.quota);
      for (const lid of slice) leadSellerMap.set(lid, q.sellerId);
      offset += q.quota;
    }
    // Any overflow leads (if quotas don't sum to total) → last seller in list.
    for (let i = offset; i < leadIds.length; i++) {
      leadSellerMap.set(leadIds[i], sellerQuotas[sellerQuotas.length - 1].sellerId);
    }
  }

  // Fallback single-seller (used when no multi-quota or for overflow).
  const chosenSellerId: string | null = prompts.sellerId ?? null;
  let fallbackSellerId: string | null = chosenSellerId;
  if (!fallbackSellerId && leadIds.length > 0) {
    const { data: leadForBio } = await supabase
      .from("leads")
      .select("company_bio_id")
      .eq("id", leadIds[0])
      .maybeSingle();
    const tenantBioId = (leadForBio as any)?.company_bio_id ?? null;
    if (tenantBioId) {
      // Honor shared sellers (admin assigns via "Sellers shared with this
      // client" toggle). Without the OR clause this fallback would skip
      // shared sellers and silently leave campaigns sellerless.
      const { data: firstSeller } = await supabase
        .from("sellers")
        .select("id")
        .eq("active", true)
        .or(`company_bio_id.eq.${tenantBioId},shared_with_company_bio_ids.cs.{${tenantBioId}}`)
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle();
      fallbackSellerId = firstSeller?.id ?? null;
    }
  }

  // 4. Create campaigns and messages for each lead
  let campaignsCreated = 0;
  const errors: string[] = [];

  for (const leadId of leadIds) {
    // Per-lead seller: quota map takes precedence, then fallback single-seller.
    const sellerId = leadSellerMap.get(leadId) ?? fallbackSellerId;

    // Determine the primary channel (first channel in sequence)
    const primaryChannel = sequence[0]?.channel ?? channels[0] ?? "linkedin";

    // Create campaign
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({
        lead_id: leadId,
        seller_id: sellerId,
        name: request.name,
        channel: primaryChannel,
        status: "active",
        current_step: 0,
        sequence_steps: sequence,
        call_advance_mode: callAdvanceMode,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      errors.push(`Lead ${leadId}: ${campErr?.message ?? "failed to create campaign"}`);
      continue;
    }

    // Create campaign_messages: connection request (if LinkedIn) + all steps
    const messageInserts: any[] = [];

    // Compute when the first LinkedIn step actually fires (cumulative days
    // from campaign start). The connection request is scheduled to fire one
    // day before that, giving the lead ~24h to accept before we try to DM.
    // If LinkedIn is the first step (Day 0), invite fires Day 0 too.
    let firstLinkedinCumDay: number | null = null;
    let cumDays = 0;
    for (let i = 0; i < sequence.length; i++) {
      cumDays += i === 0 ? 0 : (sequence[i].daysAfter ?? 0);
      if (sequence[i].channel === "linkedin" && firstLinkedinCumDay === null) {
        firstLinkedinCumDay = cumDays;
        break;
      }
    }

    // Add connection request as step 0 if LinkedIn is anywhere in the sequence.
    // We seed it as `queued` so /api/cron/dispatch-queue picks it up on the next
    // eligible tick, calls Unipile, and only flips it to 'sent' when LinkedIn
    // confirms. Steps 1+ stay as 'draft' until the connection is accepted (the
    // BESFOHaqTt2Ki0Vw "Registro de Nueva Conexion" workflow then queues them).
    //
    // eligible_at scheduling: when LinkedIn isn't the first step, we hold the
    // invite until ~24h before the first LinkedIn DM. Sending it earlier than
    // the email would surface in the timeline before the email and feel out
    // of order; sending it AT the LinkedIn DM day is too late (lead needs time
    // to accept). One day's lead time is the right tradeoff.
    const connectionRequest = prompts.channelMessages?.connectionRequest ?? "";
    if (connectionRequest && channels.includes("linkedin")) {
      const inviteOffsetDays = Math.max(0, (firstLinkedinCumDay ?? 0) - 1);
      const eligibleAt = inviteOffsetDays > 0
        ? new Date(Date.now() + inviteOffsetDays * 86400000).toISOString()
        : null;
      messageInserts.push({
        campaign_id: campaign.id,
        lead_id: leadId,
        step_number: 0,
        channel: "linkedin",
        content: connectionRequest,
        status: "queued",
        created_at: new Date().toISOString(),
        metadata: eligibleAt ? { eligible_at: eligibleAt } : null,
      });
    }

    // Add regular step messages (step 1, 2, 3...).
    // Step 1 email/call fires immediately (independent of LinkedIn connection).
    // Step 1 LinkedIn DM and all steps 2+ stay draft: they are queued by the
    // dispatch cron after the previous step completes, or by the acceptance
    // webhook (BESFOHaqTt2Ki0Vw) for LinkedIn DMs that need connection first.
    messages.forEach((msg, i) => {
      const stepNum = msg.step ?? i + 1;
      const ch = msg.channel ?? sequence[i]?.channel ?? primaryChannel;
      const isFirstNonLinkedin = stepNum === 1 && ch !== "linkedin";
      messageInserts.push({
        campaign_id: campaign.id,
        lead_id: leadId,
        step_number: stepNum,
        channel: ch,
        content: msg.body ?? "",
        status: isFirstNonLinkedin ? "queued" : "draft",
        created_at: new Date().toISOString(),
      });
    });

    if (messageInserts.length > 0) {
      const { error: msgErr } = await supabase
        .from("campaign_messages")
        .insert(messageInserts);

      if (msgErr) {
        errors.push(`Lead ${leadId} messages: ${msgErr.message}`);
      }
    }

    // Update lead's channel only — DO NOT mark as contacted yet. The cron
    // dispatcher will flip the lead to 'contacted' once Unipile confirms the
    // invite was actually sent. (Pre-fix bug: lead was marked contacted before
    // any LinkedIn call, producing 8 ghost-contacted leads on Pathway.)
    await supabase
      .from("leads")
      .update({ current_channel: primaryChannel })
      .eq("id", leadId);

    campaignsCreated++;
  }

  // 5. Mark the request as approved
  await supabase
    .from("campaign_requests")
    .update({ status: "approved" })
    .eq("id", requestId);

  return NextResponse.json({
    approved: true,
    campaignsCreated,
    totalLeads: leadIds.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
