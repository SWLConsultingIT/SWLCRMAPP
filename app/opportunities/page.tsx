import { supabase } from "@/lib/supabase";
import OpportunitiesClient from "./OpportunitiesClient";

export type ReplyEntry = {
  channel: string;
  reply_text: string | null;
  classification: string;
  received_at: string;
};

export type SequenceStep = {
  channel: string;
  daysAfter: number;
  body?: string;
  subject?: string;
};

export type OpportunityLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  is_priority: boolean;
  channel: string;
  currentStep: number;
  totalSteps: number;
  transferred: boolean;
  transferred_at: string | null;
  replies: ReplyEntry[];
};

export type CampaignGroupData = {
  name: string;
  channels: string[];
  leads: OpportunityLead[];
  totalLeadsInCampaign: number;
  channelBreakdown: Record<string, { total: number; converted: number }>;
  avgStepsToConversion: number;
  sequence: SequenceStep[];
  connectionNote: string | null;
};

async function getOpportunities() {
  // 1) Positive replies
  const { data: positiveReplies } = await supabase
    .from("lead_replies")
    .select("lead_id, classification, received_at, channel, reply_text")
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
  if (wonLeadIds.size === 0) return { groups: [] };
  const idArr = Array.from(wonLeadIds);

  // 2) Won leads + their campaigns
  const [{ data: leads }, { data: wonCampaigns }, { data: allReplies }] = await Promise.all([
    supabase.from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, is_priority, current_channel, transferred_to_odoo_at")
      .in("id", idArr),
    supabase.from("campaigns")
      .select("id, name, channel, lead_id, current_step, sequence_steps")
      .in("lead_id", idArr),
    supabase.from("lead_replies")
      .select("lead_id, classification, received_at, channel, reply_text")
      .in("lead_id", idArr)
      .order("received_at", { ascending: true }),
  ]);

  // 3) ALL campaigns with same names (total counts)
  const campaignNames = [...new Set((wonCampaigns ?? []).map(c => c.name))];
  const [{ data: allCampaigns }, { data: campRequests }] = await Promise.all([
    campaignNames.length > 0
      ? supabase.from("campaigns").select("id, name, channel, lead_id").in("name", campaignNames)
      : { data: [] } as any,
    campaignNames.length > 0
      ? supabase.from("campaign_requests").select("name, message_prompts").in("name", campaignNames)
      : { data: [] } as any,
  ]);

  // Lookups
  const templatesByName: Record<string, { steps: any[]; connectionNote: string | null }> = {};
  for (const cr of campRequests ?? []) {
    const mp = cr.message_prompts;
    templatesByName[cr.name] = {
      steps: mp?.channelMessages?.steps ?? [],
      connectionNote: mp?.channelMessages?.connectionRequest ?? null,
    };
  }

  const campByLead: Record<string, any> = {};
  for (const c of wonCampaigns ?? []) {
    if (!campByLead[c.lead_id]) campByLead[c.lead_id] = c;
  }

  const repliesByLead: Record<string, any[]> = {};
  for (const r of allReplies ?? []) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }

  const totalLeadsByCampName: Record<string, Set<string>> = {};
  const channelsByCampName: Record<string, Set<string>> = {};
  const channelLeadsByCampName: Record<string, Record<string, Set<string>>> = {};

  for (const c of allCampaigns ?? []) {
    if (!totalLeadsByCampName[c.name]) totalLeadsByCampName[c.name] = new Set();
    if (!channelsByCampName[c.name]) channelsByCampName[c.name] = new Set();
    if (!channelLeadsByCampName[c.name]) channelLeadsByCampName[c.name] = {};
    if (c.lead_id) {
      totalLeadsByCampName[c.name].add(c.lead_id);
      channelsByCampName[c.name].add(c.channel);
      if (!channelLeadsByCampName[c.name][c.channel]) channelLeadsByCampName[c.name][c.channel] = new Set();
      channelLeadsByCampName[c.name][c.channel].add(c.lead_id);
    }
  }

  // Build groups
  const groupMap: Record<string, {
    leads: OpportunityLead[];
    wonByChannel: Record<string, number>;
    stepsToConvert: number[];
    seqSteps: any[];
  }> = {};

  for (const lead of leads ?? []) {
    const camp = campByLead[lead.id];
    const campName = camp?.name ?? "Direct / No Campaign";
    const channel = camp?.channel ?? lead.current_channel ?? "unknown";
    const replyChannel = (repliesByLead[lead.id]?.find(r => r.classification === "positive" || r.classification === "meeting_intent"))?.channel ?? channel;

    if (!groupMap[campName]) groupMap[campName] = { leads: [], wonByChannel: {}, stepsToConvert: [], seqSteps: camp?.sequence_steps ?? [] };
    groupMap[campName].wonByChannel[replyChannel] = (groupMap[campName].wonByChannel[replyChannel] ?? 0) + 1;

    const leadReplies: ReplyEntry[] = (repliesByLead[lead.id] ?? []).map((r: any) => ({
      channel: r.channel ?? channel,
      reply_text: r.reply_text,
      classification: r.classification,
      received_at: r.received_at,
    }));

    if (camp?.current_step) groupMap[campName].stepsToConvert.push(camp.current_step);

    groupMap[campName].leads.push({
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      email: lead.primary_work_email,
      is_priority: lead.is_priority,
      channel: replyChannel,
      currentStep: camp?.current_step ?? 0,
      totalSteps: Array.isArray(camp?.sequence_steps) ? camp.sequence_steps.length : 0,
      transferred: !!lead.transferred_to_odoo_at,
      transferred_at: lead.transferred_to_odoo_at,
      replies: leadReplies,
    });
  }

  const groups: CampaignGroupData[] = Object.entries(groupMap)
    .map(([name, data]) => {
      const totalInCampaign = totalLeadsByCampName[name]?.size ?? data.leads.length;
      const channels = [...(channelsByCampName[name] ?? new Set())];
      const channelLeads = channelLeadsByCampName[name] ?? {};

      const channelBreakdown: Record<string, { total: number; converted: number }> = {};
      for (const ch of channels) {
        channelBreakdown[ch] = {
          total: channelLeads[ch]?.size ?? 0,
          converted: data.wonByChannel[ch] ?? 0,
        };
      }

      const avgSteps = data.stepsToConvert.length > 0
        ? Math.round(data.stepsToConvert.reduce((s, v) => s + v, 0) / data.stepsToConvert.length * 10) / 10
        : 0;

      // Build sequence: merge sequence_steps with templates if available
      const tmpl = templatesByName[name];
      const seqSteps: SequenceStep[] = (data.seqSteps ?? []).map((step: any, i: number) => ({
        channel: step.channel ?? "email",
        daysAfter: step.daysAfter ?? 0,
        body: tmpl?.steps?.[i]?.body,
        subject: tmpl?.steps?.[i]?.subject,
      }));

      return {
        name,
        channels,
        leads: data.leads,
        totalLeadsInCampaign: totalInCampaign,
        channelBreakdown,
        avgStepsToConversion: avgSteps,
        sequence: seqSteps,
        connectionNote: tmpl?.connectionNote ?? null,
      };
    })
    .sort((a, b) => b.leads.length - a.leads.length);

  return { groups };
}

export default async function OpportunitiesPage() {
  const { groups } = await getOpportunities();
  return <OpportunitiesClient groups={JSON.parse(JSON.stringify(groups))} />;
}
