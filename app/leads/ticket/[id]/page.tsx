import { getSupabaseServer } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import TicketDetailClient from "./TicketDetailClient";

async function getProfileData(profileId: string) {
  const supabase = await getSupabaseServer();
  // Get the ICP profile
  const { data: profile } = await supabase
    .from("icp_profiles")
    .select("id, profile_name")
    .eq("id", profileId)
    .single();

  if (!profile) return null;

  // Get all leads for this profile
  const { data: leads } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, is_priority, current_channel")
    .eq("icp_profile_id", profileId)
    .order("created_at", { ascending: false });

  const leadIds = (leads ?? []).map(l => l.id);
  if (leadIds.length === 0) return { name: profile.profile_name, campaigns: [], leads: [] };

  // Get campaigns for these leads
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, sellers(name)")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false });

  // Get replies
  const { data: replies } = await supabase
    .from("lead_replies")
    .select("lead_id, classification, received_at, channel, reply_text")
    .in("lead_id", leadIds);

  // Get message counts
  const campIds = (campaigns ?? []).map(c => c.id);
  const { data: messages } = campIds.length > 0
    ? await supabase.from("campaign_messages").select("campaign_id, sent_at").in("campaign_id", campIds)
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

  // Detect re-nurturing leads: leads that have a completed/failed campaign AND an active/paused one
  const leadHasCompleted = new Set<string>();
  const leadHasActive = new Set<string>();
  for (const c of campaigns ?? []) {
    if (!c.lead_id) continue;
    if (c.status === "completed" || c.status === "failed") leadHasCompleted.add(c.lead_id);
    if (c.status === "active" || c.status === "paused") leadHasActive.add(c.lead_id);
  }
  const renurturingLeadIds = new Set([...leadHasCompleted].filter(id => leadHasActive.has(id)));

  // Build campaign entries (grouped by name)
  const campGroups: Record<string, any> = {};
  for (const c of campaigns ?? []) {
    const key = c.name;
    if (!campGroups[key]) {
      campGroups[key] = {
        name: c.name,
        firstId: c.id,
        channels: new Set<string>(),
        statuses: { active: 0, paused: 0, completed: 0, failed: 0 },
        totalLeads: 0,
        totalSteps: Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0,
        totalMsgsSent: 0,
        totalReplies: 0,
        positiveCount: 0,
        lastActivity: null as string | null,
        progressSum: 0,
        is_renurturing: false,
      };
    }
    const g = campGroups[key];
    g.channels.add(c.channel);
    g.statuses[c.status] = (g.statuses[c.status] ?? 0) + 1;
    g.totalLeads++;
    if (c.lead_id && renurturingLeadIds.has(c.lead_id) && (c.status === "active" || c.status === "paused")) {
      g.is_renurturing = true;
    }
    const msgs = msgsByCamp[c.id] ?? { sent: 0, total: 0 };
    g.totalMsgsSent += msgs.sent;
    const leadReplies = c.lead_id ? (repliesByLead[c.lead_id] ?? []) : [];
    g.totalReplies += leadReplies.length;
    if (leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent")) g.positiveCount++;
    if (c.last_step_at && (!g.lastActivity || new Date(c.last_step_at) > new Date(g.lastActivity))) g.lastActivity = c.last_step_at;
    const ts = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
    g.progressSum += ts > 0 ? (c.current_step ?? 0) / ts : 0;
  }

  const campaignList = Object.values(campGroups).map((g: any) => ({
    name: g.name,
    firstId: g.firstId,
    channels: [...g.channels],
    statuses: g.statuses,
    totalLeads: g.totalLeads,
    totalSteps: g.totalSteps,
    totalMsgsSent: g.totalMsgsSent,
    totalReplies: g.totalReplies,
    positiveCount: g.positiveCount,
    lastActivity: g.lastActivity,
    avgProgress: g.totalLeads > 0 ? Math.round((g.progressSum / g.totalLeads) * 100) : 0,
    is_renurturing: g.is_renurturing ?? false,
  }));

  // Build lead → campaign lookup
  const campsByLeadId: Record<string, { name: string; status: string; channel: string }[]> = {};
  for (const c of campaigns ?? []) {
    if (!c.lead_id) continue;
    if (!campsByLeadId[c.lead_id]) campsByLeadId[c.lead_id] = [];
    campsByLeadId[c.lead_id].push({ name: c.name, status: c.status, channel: c.channel });
  }

  // Build lead list
  const leadList = (leads ?? []).map(l => {
    const leadReplies = repliesByLead[l.id] ?? [];
    const leadCamps = campsByLeadId[l.id] ?? [];
    const activeCamp = leadCamps.find(c => c.status === "active" || c.status === "paused");
    return {
      id: l.id,
      first_name: l.primary_first_name,
      last_name: l.primary_last_name,
      company: l.company_name,
      role: l.primary_title_role,
      email: l.primary_work_email,
      linkedin_url: l.primary_linkedin_url,
      status: l.status,
      score: l.lead_score,
      is_priority: l.is_priority,
      channel: l.current_channel,
      reply_count: leadReplies.length,
      has_positive: leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent"),
      campaign_name: activeCamp?.name ?? (leadCamps[0]?.name ?? null),
      campaign_status: activeCamp?.status ?? (leadCamps[0]?.status ?? null),
      has_campaign: leadCamps.length > 0,
    };
  });

  return { name: profile.profile_name, campaigns: campaignList, leads: leadList };
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getProfileData(id);
  if (!data) notFound();

  return (
    <TicketDetailClient
      ticketName={data.name}
      campaigns={data.campaigns}
      leads={data.leads}
    />
  );
}
