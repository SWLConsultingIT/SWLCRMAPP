import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import LeadsCampaignsClient from "@/components/LeadsCampaignsClient";

const gold = "#C9A83A";

async function getActiveCampaignGroups() {
  // Get all campaigns with their leads
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, current_channel, icp_profile_id, company_bio_id), sellers(name)")
    .in("status", ["active", "paused", "completed", "failed"])
    .order("created_at", { ascending: false })
    .limit(500);

  if (!campaigns || campaigns.length === 0) return [];

  // Get reply info for all campaign leads
  const leadIds = campaigns.map(c => (c.leads as any)?.id).filter(Boolean);
  const { data: replies } = leadIds.length > 0
    ? await supabase.from("lead_replies").select("lead_id, classification, received_at, channel").in("lead_id", leadIds)
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

  // Group by campaign name
  const groups: Record<string, any> = {};
  for (const c of campaigns) {
    const key = c.name ?? "Unnamed";
    if (!groups[key]) {
      groups[key] = {
        name: key,
        channel: c.channel,
        status: c.status,
        created_at: c.created_at,
        campaigns: [],
        statusCounts: { active: 0, paused: 0, completed: 0, failed: 0 },
      };
    }
    groups[key].statusCounts[c.status] = (groups[key].statusCounts[c.status] ?? 0) + 1;
    // If any campaign is active, the group is active
    if (c.status === "active") groups[key].status = "active";

    const lead = c.leads as any;
    const leadReplies = lead ? (repliesByLead[lead.id] ?? []) : [];
    const msgs = msgsByCamp[c.id] ?? { sent: 0, total: 0 };

    groups[key].campaigns.push({
      id: c.id,
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
        phone: lead.primary_phone,
        status: lead.status,
        score: lead.lead_score,
        is_priority: lead.is_priority,
        channel: lead.current_channel,
        reply_count: leadReplies.length,
        has_positive: leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent"),
        last_reply: leadReplies.sort((a: any, b: any) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0] ?? null,
      } : null,
    });
  }

  return Object.values(groups);
}

async function getLeadsWithoutCampaign() {
  // Get all lead IDs that have an active/paused campaign
  const { data: campaignLeadIds } = await supabase
    .from("campaigns")
    .select("lead_id")
    .in("status", ["active", "paused"]);

  const activeLids = new Set((campaignLeadIds ?? []).map(c => c.lead_id).filter(Boolean));

  const { data: allLeads } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, icp_profile_id, company_bio_id, created_at")
    .order("created_at", { ascending: false });

  const uncampaigned = (allLeads ?? []).filter(l => !activeLids.has(l.id));

  // Group by ICP profile
  const grouped: Record<string, { profile_id: string | null; leads: any[] }> = {};
  for (const lead of uncampaigned) {
    const key = lead.icp_profile_id ?? "__none";
    if (!grouped[key]) grouped[key] = { profile_id: lead.icp_profile_id, leads: [] };
    grouped[key].leads.push({
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      email: lead.primary_work_email,
      linkedin_url: lead.primary_linkedin_url,
      phone: lead.primary_phone,
      status: lead.status,
      score: lead.lead_score,
      is_priority: lead.is_priority,
      created_at: lead.created_at,
    });
  }

  return grouped;
}

async function getIcpProfiles() {
  const { data } = await supabase
    .from("icp_profiles")
    .select("id, profile_name, target_industries, target_roles")
    .eq("status", "approved");
  const map: Record<string, any> = {};
  (data ?? []).forEach(p => { map[p.id] = p; });
  return map;
}

export default async function LeadsCampaignsPage() {
  const [campaignGroups, uncampaignedGroups, icpMap] = await Promise.all([
    getActiveCampaignGroups(),
    getLeadsWithoutCampaign(),
    getIcpProfiles(),
  ]);

  const totalUncampaigned = Object.values(uncampaignedGroups).reduce((sum, g) => sum + g.leads.length, 0);

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>GrowthEngine</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Leads & Campaigns</h1>
      </div>
      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      <LeadsCampaignsClient
        campaignGroups={campaignGroups}
        uncampaignedGroups={uncampaignedGroups}
        icpMap={icpMap}
        totalUncampaigned={totalUncampaigned}
      />
    </div>
  );
}
