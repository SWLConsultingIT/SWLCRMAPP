import { supabase } from "@/lib/supabase";
import OpportunitiesClient from "./OpportunitiesClient";

async function getOpportunities() {
  const { data: positiveReplies } = await supabase
    .from("lead_replies")
    .select("lead_id, classification, channel, reply_text, received_at")
    .in("classification", ["positive", "meeting_intent"])
    .order("received_at", { ascending: false });

  const { data: odooLeads } = await supabase
    .from("leads")
    .select("id")
    .not("transferred_to_odoo_at", "is", null);

  const wonLeadIds = new Set([
    ...(positiveReplies ?? []).map(r => r.lead_id),
    ...(odooLeads ?? []).map(l => l.id),
  ]);
  if (wonLeadIds.size === 0) return { leads: [] };
  const idArr = Array.from(wonLeadIds);

  const [{ data: leads }, { data: campaigns }, { data: profiles }] = await Promise.all([
    supabase.from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, lead_score, is_priority, transferred_to_odoo_at, icp_profile_id, created_at")
      .in("id", idArr),
    supabase.from("campaigns")
      .select("id, name, channel, lead_id, current_step, sequence_steps, created_at")
      .in("lead_id", idArr),
    supabase.from("icp_profiles").select("id, profile_name").eq("status", "approved"),
  ]);

  const profileMap: Record<string, string> = {};
  for (const p of profiles ?? []) profileMap[p.id] = p.profile_name;

  const campByLead: Record<string, any> = {};
  for (const c of campaigns ?? []) {
    if (!campByLead[c.lead_id]) campByLead[c.lead_id] = c;
  }

  const replyByLead: Record<string, any> = {};
  for (const r of positiveReplies ?? []) {
    if (!replyByLead[r.lead_id]) replyByLead[r.lead_id] = r;
  }

  const opportunityLeads = (leads ?? []).map(l => {
    const camp = campByLead[l.id];
    const reply = replyByLead[l.id];
    const steps = Array.isArray(camp?.sequence_steps) ? camp.sequence_steps.length : 0;
    const channels = camp ? [...new Set([camp.channel, ...(Array.isArray(camp.sequence_steps) ? camp.sequence_steps.map((s: any) => s.channel) : [])])] : [];
    const daysToConvert = reply?.received_at && l.created_at
      ? Math.max(1, Math.round((new Date(reply.received_at).getTime() - new Date(l.created_at).getTime()) / 86400000))
      : null;

    return {
      id: l.id,
      first_name: l.primary_first_name,
      last_name: l.primary_last_name,
      company: l.company_name,
      role: l.primary_title_role,
      score: l.lead_score,
      is_priority: l.is_priority,
      transferred: !!l.transferred_to_odoo_at,
      profile_name: l.icp_profile_id ? (profileMap[l.icp_profile_id] ?? null) : null,
      campaign_name: camp?.name ?? null,
      campaign_id: camp?.id ?? null,
      win_channel: reply?.channel ?? camp?.channel ?? null,
      win_text: reply?.reply_text ?? null,
      win_classification: reply?.classification ?? "positive",
      win_date: reply?.received_at ?? null,
      channels,
      steps_to_convert: camp?.current_step ?? 0,
      total_steps: steps,
      days_to_convert: daysToConvert,
    };
  }).sort((a, b) => {
    if (a.win_date && b.win_date) return new Date(b.win_date).getTime() - new Date(a.win_date).getTime();
    return 0;
  });

  return { leads: opportunityLeads };
}

export default async function OpportunitiesPage() {
  const { leads } = await getOpportunities();
  return <OpportunitiesClient leads={JSON.parse(JSON.stringify(leads))} />;
}
