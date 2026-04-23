import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { flowName, flowManagerId, steps, emailAccount, originalName, messages } = body;

  if (!flowName || !Array.isArray(steps)) {
    return NextResponse.json({ error: "flowName + steps required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Resolve which campaigns to update. A flow spans all campaigns sharing the same name.
  const targetName = originalName ?? flowName;
  const { data: siblings } = await svc
    .from("campaigns")
    .select("id")
    .eq("name", targetName);
  const allCampaignIds = (siblings ?? []).map(c => c.id);
  if (!allCampaignIds.includes(id)) allCampaignIds.push(id);

  // Propagate the new sequence + seller + emailAccount + (new) name to every campaign in the group.
  const update: Record<string, any> = {
    name: flowName,
    seller_id: flowManagerId ?? null,
    sequence_steps: steps,
    email_account: emailAccount || null,
  };
  const { error: err1 } = await svc.from("campaigns").update(update).in("id", allCampaignIds);
  if (err1) return NextResponse.json({ error: err1.message }, { status: 500 });

  // Update message templates (each has an id tied to a specific row).
  if (messages && typeof messages === "object") {
    for (const [stepNum, msg] of Object.entries(messages)) {
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

  return NextResponse.json({ ok: true, updatedCampaigns: allCampaignIds.length });
}
