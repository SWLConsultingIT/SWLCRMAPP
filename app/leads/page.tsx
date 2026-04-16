import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Users } from "lucide-react";
import LeadsCampaignsClient from "@/components/LeadsCampaignsClient";
import PageHero from "@/components/PageHero";


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

  // ── Campaign groups for Campaigns view ──
  const campGroupsMap: Record<string, any[]> = {};
  for (const c of campaigns ?? []) {
    const key = c.name || "Unnamed";
    if (!campGroupsMap[key]) campGroupsMap[key] = [];
    campGroupsMap[key].push(c);
  }

  const campaignGroups = Object.entries(campGroupsMap).map(([name, camps]) => {
    const channels = [...new Set(camps.flatMap((c: any) => {
      const steps = c.sequence_steps ?? [];
      return steps.map((s: any) => typeof s === "string" ? s : s?.channel).filter(Boolean);
    }))];
    if (channels.length === 0) channels.push(...new Set(camps.map((c: any) => c.channel)));
    const active = camps.filter((c: any) => c.status === "active").length;
    const completed = camps.filter((c: any) => c.status === "completed").length;
    const paused = camps.filter((c: any) => c.status === "paused").length;
    const progressValues = camps.map((c: any) => {
      const total = c.sequence_steps?.length ?? 0;
      return total > 0 ? c.current_step / total : 0;
    });
    const avgProgress = progressValues.length > 0 ? Math.round((progressValues.reduce((a: number, b: number) => a + b, 0) / progressValues.length) * 100) : 0;
    const sellers = [...new Set(camps.map((c: any) => (c.sellers as any)?.name).filter(Boolean))] as string[];
    const lastActivity = camps.map((c: any) => c.last_step_at).filter(Boolean)
      .sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    const totalReplies = camps.reduce((s: number, c: any) => s + ((msgsByCamp[c.id]?.sent ?? 0) > 0 ? (repliesByLead[c.lead_id]?.length ?? 0) : 0), 0);
    const groupStatus = active > 0 ? "active" : paused > 0 ? "paused" : completed > 0 ? "completed" : "failed";

    return { name, firstId: camps[0].id, channels: [...new Set(channels)], totalLeads: camps.length, active, completed, avgProgress, totalReplies, sellers, lastActivity, status: groupStatus };
  }).sort((a, b) => b.active - a.active || b.totalLeads - a.totalLeads);

  // ── Uncampaigned leads (pending) ──
  const activeLids = new Set((campaigns ?? []).filter((c: any) => c.status === "active" || c.status === "paused").map((c: any) => c.lead_id).filter(Boolean));
  const uncampaignedLeads = (allLeads ?? []).filter(l => !activeLids.has(l.id));
  const uncampaignedByProfile: Record<string, { profileId: string | null; profileName: string | null; leads: any[] }> = {};
  for (const lead of uncampaignedLeads) {
    const key = lead.icp_profile_id ?? "__none";
    if (!uncampaignedByProfile[key]) {
      uncampaignedByProfile[key] = {
        profileId: lead.icp_profile_id,
        profileName: lead.icp_profile_id ? (icpMap[lead.icp_profile_id]?.profile_name ?? null) : null,
        leads: [],
      };
    }
    uncampaignedByProfile[key].leads.push({
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      email: lead.primary_work_email,
      score: lead.lead_score,
    });
  }

  return {
    profileGroups: groupList,
    allLeads: allLeadsList,
    lostLeads,
    icpMap,
    campaignGroups,
    uncampaignedGroups: Object.values(uncampaignedByProfile),
    stats: { activeProfiles: groupList.filter(g => (g.statusCounts.active ?? 0) > 0).length, totalLeads, responseRate, positiveReplies: positiveCount, activeCampaigns: campaignGroups.filter(g => g.status === "active").length },
  };
}

export default async function LeadsCampaignsPage() {
  const { profileGroups, allLeads, lostLeads, stats } = await getData();

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Users}
        section="Operations"
        title="Leads & Campaigns"
        description="Manage your full prospect pipeline and track outreach progress across all channels."
        accentColor={C.blue}
        status={{ label: "Active", active: true }}
      />

      <LeadsCampaignsClient
        profileGroups={JSON.parse(JSON.stringify(profileGroups))}
        allLeads={JSON.parse(JSON.stringify(allLeads))}
        lostLeads={JSON.parse(JSON.stringify(lostLeads))}
        stats={stats}
      />
    </div>
  );
}
