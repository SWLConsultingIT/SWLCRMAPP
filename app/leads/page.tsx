import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import LeadsClient from "@/components/LeadsClient";

async function getLeads() {
  // Get leads with message counts and reply info
  const { data: leads } = await supabase
    .from("leads")
    .select("id, first_name, last_name, company, role, email, linkedin_url, status, assigned_seller, allow_linkedin, allow_email, allow_whatsapp, allow_call, n8n_flow, created_at, updated_at, odoo_lead_id")
    .order("created_at", { ascending: false })
    .limit(500);

  if (!leads || leads.length === 0) return [];

  // Fetch campaign stats per lead
  const leadIds = leads.map((l) => l.id);

  const [{ data: campaigns }, { data: replies }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("lead_id, id, status, last_step_at, channel")
      .in("lead_id", leadIds),
    supabase
      .from("lead_replies")
      .select("lead_id, classification, received_at")
      .in("lead_id", leadIds),
  ]);

  // Get sent message counts
  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const { data: messages } = campaignIds.length
    ? await supabase
        .from("campaign_messages")
        .select("campaign_id, sent_at")
        .in("campaign_id", campaignIds)
        .not("sent_at", "is", null)
    : { data: [] };

  // Build lookup maps
  const campByLead: Record<string, any[]> = {};
  for (const c of campaigns ?? []) {
    if (!campByLead[c.lead_id]) campByLead[c.lead_id] = [];
    campByLead[c.lead_id].push(c);
  }

  const sentByLead: Record<string, number> = {};
  for (const m of messages ?? []) {
    const camp = (campaigns ?? []).find((c) => c.id === m.campaign_id);
    if (camp) sentByLead[camp.lead_id] = (sentByLead[camp.lead_id] ?? 0) + 1;
  }

  const repliesByLead: Record<string, any[]> = {};
  for (const r of replies ?? []) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }

  return leads.map((l) => {
    const lCamps = campByLead[l.id] ?? [];
    const lReplies = repliesByLead[l.id] ?? [];
    const lastActivity = [...lCamps.map((c) => c.last_step_at), ...lReplies.map((r) => r.received_at), l.updated_at, l.created_at]
      .filter(Boolean)
      .sort()
      .at(-1);

    return {
      ...l,
      messages_sent: sentByLead[l.id] ?? 0,
      reply_count: lReplies.length,
      has_positive: lReplies.some((r) => r.classification === "positive"),
      has_reply: lReplies.length > 0,
      last_activity: lastActivity ?? l.created_at,
      channels_active: lCamps.map((c) => c.channel).filter((v, i, a) => a.indexOf(v) === i),
    };
  });
}

async function getSellers() {
  const { data } = await supabase.from("sellers").select("name").order("name");
  return (data ?? []).map((s: any) => s.name as string);
}

export default async function LeadsPage() {
  const [leads, sellers] = await Promise.all([getLeads(), getSellers()]);
  return <LeadsClient leads={leads} sellers={sellers} />;
}
