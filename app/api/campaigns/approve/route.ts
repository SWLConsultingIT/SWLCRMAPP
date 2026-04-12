import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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

  // 3. Get seller (use first available seller)
  const { data: sellers } = await supabase
    .from("sellers")
    .select("id")
    .limit(1);
  const sellerId = sellers?.[0]?.id ?? null;

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
        auto_replies: autoReplies,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      errors.push(`Lead ${leadId}: ${campErr?.message ?? "failed to create campaign"}`);
      continue;
    }

    // Create campaign_messages for each step
    const messageInserts = messages.map((msg, i) => ({
      campaign_id: campaign.id,
      lead_id: leadId,
      message_number: msg.step ?? i + 1,
      step_number: msg.step ?? i + 1,
      channel: msg.channel ?? sequence[i]?.channel ?? primaryChannel,
      content: msg.body ?? "",
      subject: msg.subject ?? null,
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

    // Update lead: assign campaign channel + set status to contacted
    await supabase
      .from("leads")
      .update({ status: "contacted", current_channel: primaryChannel })
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
