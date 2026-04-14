import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import LeadsCampaignsClient from "@/components/LeadsCampaignsClient";

const gold = "#C9A83A";

async function getData() {
  const { data: profiles } = await supabase
    .from("icp_profiles")
    .select("id, profile_name, target_industries, target_roles, status")
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  const icpMap: Record<string, { id: string; profile_name: string; target_industries?: string[]; target_roles?: string[] }> = {};
  for (const p of profiles ?? []) icpMap[p.id] = p;

  const { data: allLeads } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, current_channel, icp_profile_id, created_at")
    .order("created_at", { ascending: false });

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, sellers(name)")
    .in("status", ["active", "paused", "completed", "failed"])
    .order("created_at", { ascending: false })
    .limit(500);

  const leadIds = (allLeads ?? []).map(l => l.id);
  const { data: replies } = leadIds.length > 0
    ? await supabase.from("lead_replies").select("lead_id, classification, received_at, channel, reply_text").in("lead_id", leadIds).order("received_at", { ascending: false })
    : { data: [] };

  const campIds = (campaigns ?? []).map(c => c.id);
  const { data: messages } = campIds.length > 0
    ? await supabase.from("campaign_messages").select("campaign_id, sent_at").in("campaign_id", campIds)
    : { data: [] };

  // Lookups
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

  const campsByLead: Record<string, any[]> = {};
  for (const c of campaigns ?? []) {
    if (!c.lead_id) continue;
    if (!campsByLead[c.lead_id]) campsByLead[c.lead_id] = [];
    campsByLead[c.lead_id].push({
      id: c.id, name: c.name, status: c.status, channel: c.channel,
      current_step: c.current_step,
      total_steps: Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0,
      last_step_at: c.last_step_at,
      seller: (c.sellers as any)?.name ?? null,
      messages_sent: (msgsByCamp[c.id] ?? { sent: 0 }).sent,
    });
  }

  // Build profile groups + all leads list
  type ProfileGroup = {
    profileId: string;
    profileName: string;
    leads: any[];
    campaigns: any[];
    statusCounts: Record<string, number>;
    totalReplies: number;
    positiveCount: number;
    hotCount: number;
    contactedCount: number;
    lastReply: { text: string | null; classification: string; leadName: string; receivedAt: string } | null;
  };

  const profileGroups: Record<string, ProfileGroup> = {};
  const allLeadsList: any[] = [];

  for (const lead of allLeads ?? []) {
    const pid = lead.icp_profile_id;
    const leadReplies = repliesByLead[lead.id] ?? [];
    const leadCamps = campsByLead[lead.id] ?? [];
    const hasCampaign = leadCamps.length > 0;

    const leadData = {
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
      has_campaign: hasCampaign,
      profile_name: pid ? (icpMap[pid]?.profile_name ?? null) : null,
      created_at: lead.created_at,
    };

    allLeadsList.push(leadData);

    if (hasCampaign && pid) {
      if (!profileGroups[pid]) {
        profileGroups[pid] = {
          profileId: pid, profileName: icpMap[pid]?.profile_name ?? "Unknown Profile",
          leads: [], campaigns: [], statusCounts: {},
          totalReplies: 0, positiveCount: 0, hotCount: 0, contactedCount: 0, lastReply: null,
        };
      }
      const pg = profileGroups[pid];
      pg.leads.push(leadData);
      pg.contactedCount++;
      if (leadData.is_priority || (leadData.score && leadData.score >= 80)) pg.hotCount++;
      for (const camp of leadCamps) {
        pg.campaigns.push(camp);
        pg.statusCounts[camp.status] = (pg.statusCounts[camp.status] ?? 0) + 1;
      }
      pg.totalReplies += leadReplies.length;
      if (leadData.has_positive) pg.positiveCount++;
      if (leadReplies.length > 0) {
        const latest = leadReplies[0];
        const leadName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
        if (!pg.lastReply || new Date(latest.received_at) > new Date(pg.lastReply.receivedAt)) {
          pg.lastReply = { text: latest.reply_text, classification: latest.classification, leadName, receivedAt: latest.received_at };
        }
      }
    }
  }

  // Build lost leads: campaign completed/failed, no positive reply
  const lostLeads: any[] = [];
  for (const lead of allLeads ?? []) {
    const leadCamps = campsByLead[lead.id] ?? [];
    const leadReplies = repliesByLead[lead.id] ?? [];
    const hasPositive = leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
    if (hasPositive) continue; // not lost
    const hasCompletedCampaign = leadCamps.some((c: any) => c.status === "completed" || c.status === "failed");
    const hasNegativeReply = leadReplies.some((r: any) => r.classification === "negative");
    if (hasCompletedCampaign || hasNegativeReply) {
      const negReply = leadReplies.find((r: any) => r.classification === "negative");
      const mainCamp = leadCamps[0];
      const channels = [...new Set(leadCamps.map((c: any) => c.channel))];
      const totalStepsDone = leadCamps.reduce((s: number, c: any) => s + (c.current_step ?? 0), 0);
      const totalStepsMax = leadCamps.reduce((s: number, c: any) => s + (c.total_steps ?? 0), 0);
      const totalMsgsSent = leadCamps.reduce((s: number, c: any) => s + (c.messages_sent ?? 0), 0);
      lostLeads.push({
        id: lead.id,
        first_name: lead.primary_first_name,
        last_name: lead.primary_last_name,
        company: lead.company_name,
        role: lead.primary_title_role,
        email: lead.primary_work_email,
        score: lead.lead_score,
        is_priority: lead.is_priority,
        profile_name: lead.icp_profile_id ? (icpMap[lead.icp_profile_id]?.profile_name ?? null) : null,
        reason: hasNegativeReply ? "negative" : "no_reply",
        reply_text: negReply?.reply_text ?? null,
        reply_date: negReply?.received_at ?? null,
        campaign_name: mainCamp?.name ?? null,
        channels,
        steps_completed: totalStepsDone,
        steps_total: totalStepsMax,
        messages_sent: totalMsgsSent,
      });
    }
  }

  const groupList = Object.values(profileGroups).sort((a, b) => b.leads.length - a.leads.length);
  const totalLeads = (allLeads ?? []).length;
  const contactedCount = new Set((campaigns ?? []).map(c => c.lead_id).filter(Boolean)).size;
  const positiveCount = groupList.reduce((s, g) => s + g.positiveCount, 0);
  const responseRate = contactedCount > 0 ? Math.round((Object.keys(repliesByLead).length / contactedCount) * 100) : 0;

  return {
    profileGroups: groupList,
    allLeads: allLeadsList,
    lostLeads,
    icpMap,
    stats: { activeProfiles: groupList.filter(g => (g.statusCounts.active ?? 0) > 0).length, totalLeads, responseRate, positiveReplies: positiveCount },
  };
}

export default async function LeadsCampaignsPage() {
  const { profileGroups, allLeads, lostLeads, icpMap, stats } = await getData();

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>GrowthEngine</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Leads & Campaigns</h1>
      </div>
      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      <LeadsCampaignsClient
        profileGroups={JSON.parse(JSON.stringify(profileGroups))}
        allLeads={JSON.parse(JSON.stringify(allLeads))}
        lostLeads={JSON.parse(JSON.stringify(lostLeads))}
        icpMap={icpMap}
        stats={stats}
      />
    </div>
  );
}
