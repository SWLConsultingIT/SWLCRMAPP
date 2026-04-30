import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use service key to bypass RLS for admin operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: NextRequest) {
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

  // 3. Resolve the seller chosen at campaign creation (stored in message_prompts.sellerId)
  const chosenSellerId: string | null = prompts.sellerId ?? null;
  let sellerId: string | null = chosenSellerId;
  if (!sellerId) {
    const { data: firstSeller } = await supabase
      .from("sellers")
      .select("id")
      .eq("active", true)
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();
    sellerId = firstSeller?.id ?? null;
  }

  // 4. Create campaigns and messages for each lead
  let campaignsCreated = 0;
  const errors: string[] = [];

  for (const leadId of leadIds) {

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

    // Add connection request as step 0 if LinkedIn and connectionRequest exists.
    // We seed it as `queued` so /api/cron/dispatch-queue picks it up on the next
    // tick, calls Unipile, and only flips it to 'sent' when LinkedIn confirms.
    // Steps 1+ stay as 'draft' until the connection is accepted (the
    // BESFOHaqTt2Ki0Vw "Registro de Nueva Conexion" workflow then queues them).
    const connectionRequest = prompts.channelMessages?.connectionRequest ?? "";
    if (connectionRequest && channels.includes("linkedin")) {
      messageInserts.push({
        campaign_id: campaign.id,
        lead_id: leadId,
        step_number: 0,
        channel: "linkedin",
        content: connectionRequest,
        status: "queued",
        created_at: new Date().toISOString(),
      });
    }

    // Add regular step messages (step 1, 2, 3...) as draft. They are activated
    // only after the connection request is accepted.
    messages.forEach((msg, i) => messageInserts.push({
      campaign_id: campaign.id,
      lead_id: leadId,
      step_number: (msg.step ?? i + 1),
      channel: msg.channel ?? sequence[i]?.channel ?? primaryChannel,
      content: msg.body ?? "",
      status: "draft",
      created_at: new Date().toISOString(),
    }));

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
