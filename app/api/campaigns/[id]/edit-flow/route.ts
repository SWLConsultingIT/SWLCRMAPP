import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { flowName, flowManagerId, steps, emailAccount, originalName, messages, newMessages } = body;

  if (!flowName || !Array.isArray(steps)) {
    return NextResponse.json({ error: "flowName + steps required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Resolve which campaigns to update. A flow spans all campaigns sharing the same name.
  const targetName = originalName ?? flowName;
  const { data: siblings } = await svc
    .from("campaigns")
    .select("id, lead_id, status")
    .eq("name", targetName);
  const allCampaigns = siblings ?? [];
  const allCampaignIds = allCampaigns.map(c => c.id);
  if (!allCampaignIds.includes(id)) {
    const { data: self } = await svc.from("campaigns").select("id, lead_id, status").eq("id", id).single();
    if (self) allCampaigns.push(self);
    allCampaignIds.push(id);
  }

  // Propagate the new sequence + seller + (new) name to every campaign in the group.
  // NOTE: `email_account` is NOT a column on `campaigns` (it lives on `sellers`;
  // the email account is auto-assigned per seller at dispatch time). Writing it
  // here threw "Could not find the 'email_account' column of 'campaigns' in the
  // schema cache" and blocked every save. The picker stays informational only.
  const update: Record<string, any> = {
    name: flowName,
    seller_id: flowManagerId ?? null,
    sequence_steps: steps,
  };
  const { error: err1 } = await svc.from("campaigns").update(update).in("id", allCampaignIds);
  if (err1) return NextResponse.json({ error: err1.message }, { status: 500 });

  // Update existing message templates (each has an id tied to a specific row).
  if (messages && typeof messages === "object") {
    for (const [, msg] of Object.entries(messages)) {
      const m = msg as any;
      if (!m?.id) continue;
      const metadata: Record<string, any> = {};
      if (m.subject) metadata.subject = m.subject;
      if (Array.isArray(m.attachments) && m.attachments.length > 0) metadata.attachments = m.attachments;
      await svc.from("campaign_messages").update({
        content: m.content,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      }).eq("id", m.id);
    }
  }

  // Create campaign_messages rows for newly added steps.
  // These get queued for all active/paused leads in the flow so they actually
  // receive the new step — without this, only future (not-yet-approved) leads
  // would see the step.
  if (newMessages && typeof newMessages === "object") {
    const activeCampaigns = allCampaigns.filter(c => c.status === "active" || c.status === "paused");
    if (activeCampaigns.length > 0) {
      const newStepNums = Object.keys(newMessages).map(Number);
      // Find existing rows to avoid duplicates
      const { data: existing } = await svc
        .from("campaign_messages")
        .select("campaign_id, step_number")
        .in("campaign_id", activeCampaigns.map(c => c.id))
        .in("step_number", newStepNums);
      const existingKeys = new Set((existing ?? []).map((m: any) => `${m.campaign_id}:${m.step_number}`));

      const inserts: any[] = [];
      for (const campaign of activeCampaigns) {
        if (!campaign.lead_id) continue;
        for (const [stepNumStr, nm] of Object.entries(newMessages)) {
          const stepNum = Number(stepNumStr);
          const m = nm as any;
          if (existingKeys.has(`${campaign.id}:${stepNum}`)) continue;
          const eligibleAt = new Date(Date.now() + (m.waitDays ?? 3) * 86400000).toISOString();
          const meta: Record<string, any> = { eligible_at: eligibleAt };
          if (m.subject) meta.subject = m.subject;
          inserts.push({
            campaign_id: campaign.id,
            lead_id: campaign.lead_id,
            step_number: stepNum,
            channel: m.channel ?? "email",
            content: m.content ?? "",
            status: "queued",
            metadata: meta,
            created_at: new Date().toISOString(),
          });
        }
      }
      if (inserts.length > 0) {
        await svc.from("campaign_messages").insert(inserts);
      }
    }
  }

  return NextResponse.json({ ok: true, updatedCampaigns: allCampaignIds.length });
}
