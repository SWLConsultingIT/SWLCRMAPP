import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import TicketDetailClient from "./TicketDetailClient";

async function getTicketData(campaignId: string) {
  // Get the campaign to find its name (ticket identifier)
  const { data: pivot } = await supabase
    .from("campaigns")
    .select("name, channel")
    .eq("id", campaignId)
    .single();

  if (!pivot) return null;

  // Get ALL campaigns with this name (the full ticket)
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, seller_id, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, is_priority, current_channel, icp_profile_id), sellers(name)")
    .eq("name", pivot.name)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!campaigns || campaigns.length === 0) return null;

  // Get reply info for all leads
  const leadIds = campaigns.map(c => (c.leads as any)?.id).filter(Boolean);
  const { data: replies } = leadIds.length > 0
    ? await supabase.from("lead_replies").select("lead_id, classification, received_at, channel, reply_text").in("lead_id", leadIds)
    : { data: [] };

  // Get message counts per campaign
  const campIds = campaigns.map(c => c.id);
  const { data: messages } = campIds.length > 0
    ? await supabase.from("campaign_messages").select("campaign_id, status, sent_at").in("campaign_id", campIds)
    : { data: [] };

  const repliesByLead: Record<string, any[]> = {};
  for (const r of replies ?? []) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }

  const msgsByCamp: Record<string, { sent: number; total: number }> = {};
  for (const m of messages ?? []) {
    if (!msgsByCamp[m.campaign_id]) msgsByCamp[m.campaign_id] = { sent: 0, total: 0 };
    msgsByCamp[m.campaign_id].total++;
    if (m.sent_at) msgsByCamp[m.campaign_id].sent++;
  }

  const entries = campaigns.map(c => {
    const lead = c.leads as any;
    const leadReplies = lead ? (repliesByLead[lead.id] ?? []) : [];
    const msgs = msgsByCamp[c.id] ?? { sent: 0, total: 0 };
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      channel: c.channel,
      current_step: c.current_step,
      total_steps: Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0,
      last_step_at: c.last_step_at,
      seller: (c.sellers as any)?.name ?? null,
      messages_sent: msgs.sent,
      messages_total: msgs.total,
      lead: lead ? {
        id: lead.id,
        first_name: lead.primary_first_name,
        last_name: lead.primary_last_name,
        company: lead.company_name,
        role: lead.primary_title_role,
        email: lead.primary_work_email,
        linkedin_url: lead.primary_linkedin_url,
        status: lead.status,
        score: lead.lead_score,
        is_priority: lead.is_priority,
        channel: lead.current_channel ?? c.channel,
        reply_count: leadReplies.length,
        has_positive: leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent"),
        last_reply: leadReplies.sort((a: any, b: any) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0] ?? null,
      } : null,
    };
  });

  return { name: pivot.name, entries };
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data   = await getTicketData(id);
  if (!data) notFound();

  return (
    <TicketDetailClient
      ticketName={data.name}
      campaigns={data.entries}
    />
  );
}
