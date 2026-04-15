import { supabase } from "@/lib/supabase";
import OpportunitiesClient from "./OpportunitiesClient";

async function getOpportunities() {
  const { data: positiveReplies } = await supabase
    .from("lead_replies")
    .select("lead_id, classification")
    .in("classification", ["positive", "meeting_intent"]);

  const { data: odooLeads } = await supabase
    .from("leads")
    .select("id")
    .not("transferred_to_odoo_at", "is", null);

  const wonLeadIds = new Set([
    ...(positiveReplies ?? []).map(r => r.lead_id),
    ...(odooLeads ?? []).map(l => l.id),
  ]);
  if (wonLeadIds.size === 0) return { groups: [] };
  const idArr = Array.from(wonLeadIds);

  const [{ data: leads }, { data: wonCampaigns }] = await Promise.all([
    supabase.from("leads")
      .select("id, current_channel, transferred_to_odoo_at")
      .in("id", idArr),
    supabase.from("campaigns")
      .select("id, name, channel, lead_id, current_step, sequence_steps")
      .in("lead_id", idArr),
  ]);

  // All campaigns with same names (for total counts)
  const campaignNames = [...new Set((wonCampaigns ?? []).map(c => c.name))];
  const { data: allCampaigns } = campaignNames.length > 0
    ? await supabase.from("campaigns").select("id, name, channel, lead_id").in("name", campaignNames)
    : { data: [] };

  const campByLead: Record<string, any> = {};
  for (const c of wonCampaigns ?? []) {
    if (!campByLead[c.lead_id]) campByLead[c.lead_id] = c;
  }

  const totalLeadsByCampName: Record<string, Set<string>> = {};
  const channelsByCampName: Record<string, Set<string>> = {};
  for (const c of allCampaigns ?? []) {
    if (!totalLeadsByCampName[c.name]) totalLeadsByCampName[c.name] = new Set();
    if (!channelsByCampName[c.name]) channelsByCampName[c.name] = new Set();
    if (c.lead_id) {
      totalLeadsByCampName[c.name].add(c.lead_id);
      channelsByCampName[c.name].add(c.channel);
    }
  }

  // Build groups
  const groupMap: Record<string, {
    firstId: string | null;
    converted: number;
    transferred: number;
    stepsToConvert: number[];
  }> = {};

  for (const lead of leads ?? []) {
    const camp = campByLead[lead.id];
    const campName = camp?.name ?? "Direct / No Campaign";
    if (!groupMap[campName]) groupMap[campName] = { firstId: camp?.id ?? null, converted: 0, transferred: 0, stepsToConvert: [] };
    groupMap[campName].converted++;
    if (lead.transferred_to_odoo_at) groupMap[campName].transferred++;
    if (camp?.current_step) groupMap[campName].stepsToConvert.push(camp.current_step);
  }

  const groups = Object.entries(groupMap)
    .map(([name, data]) => {
      const totalInCampaign = totalLeadsByCampName[name]?.size ?? data.converted;
      const channels = [...(channelsByCampName[name] ?? new Set())];
      const avgSteps = data.stepsToConvert.length > 0
        ? Math.round(data.stepsToConvert.reduce((s, v) => s + v, 0) / data.stepsToConvert.length * 10) / 10
        : 0;

      return {
        name,
        firstId: data.firstId ?? name,
        channels,
        converted: data.converted,
        totalLeads: totalInCampaign,
        transferred: data.transferred,
        avgStepsToConversion: avgSteps,
      };
    })
    .sort((a, b) => b.converted - a.converted);

  return { groups };
}

export default async function OpportunitiesPage() {
  const { groups } = await getOpportunities();
  return <OpportunitiesClient groups={JSON.parse(JSON.stringify(groups))} />;
}
