import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { notFound } from "next/navigation";
import TicketDetailClient from "./TicketDetailClient";

async function getProfileData(profileId: string) {
  const supabase = await getSupabaseServer();

  // Profile + leads + recent campaign-request updates parallelize off
  // profileId alone. The updates feed lives here now (boss feedback
  // 2026-05-27 — moved from the deprecated /queue Updates tab). Two weeks
  // is the window the queue used; keep parity.
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const [profileRes, leadsRes, updatesRes] = await Promise.all([
    supabase.from("icp_profiles").select("id, profile_name").eq("id", profileId).single(),
    supabase.from("leads")
      .select("id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, is_priority, current_channel, transferred_to_odoo_at")
      .eq("icp_profile_id", profileId)
      .order("created_at", { ascending: false }),
    supabase.from("campaign_requests")
      .select("id, name, status, created_at, target_leads_count")
      .eq("icp_profile_id", profileId)
      .in("status", ["approved", "rejected", "pending_review"])
      .gte("created_at", twoWeeksAgo)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const profile = profileRes.data;
  const leads = await hydrateClientLeads((leadsRes.data ?? []) as Record<string, unknown>[]) as any[];
  const updates = (updatesRes.data ?? []).map((r: any) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as "approved" | "rejected" | "pending_review",
    createdAt: r.created_at as string,
    targetLeadsCount: (r.target_leads_count as number | null) ?? null,
  }));

  if (!profile) return null;

  const leadIds = (leads ?? []).map(l => l.id);
  const emptyMetrics = {
    totalLeads: 0, unassignedCount: 0,
    linkedinInvitesSent: 0, linkedinMessagesSent: 0, emailsSent: 0, callsMade: 0,
    won: 0, lost: 0, replyRate: 0, winRate: 0,
  };
  if (leadIds.length === 0) return { name: profile.profile_name, campaigns: [], leads: [], metrics: emptyMetrics, updates };

  // Campaigns + replies both only depend on leadIds — parallelize. Saves another ~150ms.
  const [campaignsRes, repliesRes] = await Promise.all([
    supabase.from("campaigns")
      .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, sellers(name)")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false }),
    supabase.from("lead_replies")
      .select("lead_id, classification, received_at, channel, reply_text")
      .in("lead_id", leadIds),
  ]);
  const campaigns = campaignsRes.data;
  const replies = repliesRes.data;

  // Messages + calls depend on campIds / leadIds (after campaigns + leads).
  // We pull channel + step_number on messages so we can split LinkedIn
  // Connection Requests (step 0) from regular LinkedIn DMs in the metrics
  // strip. Calls are joined separately by lead_id since they live outside
  // campaign_messages.
  const campIds = (campaigns ?? []).map(c => c.id);
  const [{ data: messages }, { data: callsRows }] = await Promise.all([
    campIds.length > 0
      ? supabase.from("campaign_messages")
          .select("campaign_id, channel, step_number, sent_at")
          .in("campaign_id", campIds)
      : Promise.resolve({ data: [] as any[] }),
    leadIds.length > 0
      ? supabase.from("calls")
          .select("id, lead_id, classification")
          .in("lead_id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const repliesByLead: Record<string, any[]> = {};
  for (const r of replies ?? []) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }

  // Per-campaign message throughput broken down by channel + step. The card
  // preview needs to render "12 LI invites · 5 LI msgs · 3 emails" chips
  // without making a second query at render time.
  const msgsByCamp: Record<string, { sent: number; total: number; liInv: number; liMsg: number; em: number }> = {};
  for (const m of messages ?? []) {
    if (!msgsByCamp[m.campaign_id]) msgsByCamp[m.campaign_id] = { sent: 0, total: 0, liInv: 0, liMsg: 0, em: 0 };
    msgsByCamp[m.campaign_id].total++;
    if (!m.sent_at) continue;
    msgsByCamp[m.campaign_id].sent++;
    if (m.channel === "linkedin") {
      if (m.step_number === 0) msgsByCamp[m.campaign_id].liInv++;
      else msgsByCamp[m.campaign_id].liMsg++;
    } else if (m.channel === "email") {
      msgsByCamp[m.campaign_id].em++;
    }
  }
  // Per-campaign accept proxy — a LinkedIn campaign whose current_step > 1
  // means the dispatcher unparked past the CR step (only possible after the
  // accept webhook fired). Same heuristic the seller-detail KPI uses.
  const acceptedCampIds = new Set<string>();
  for (const c of campaigns ?? []) {
    if (c.channel === "linkedin" && (c.current_step ?? 0) > 1) acceptedCampIds.add(c.id);
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
        // Per-channel throughput chips
        liInvitesSent: 0,
        liMessagesSent: 0,
        emailsSent: 0,
        // Accept proxy — denominator is LinkedIn rows that actually fired a CR
        liInvitesTotal: 0,
        liInvitesAccepted: 0,
        // Sellers (unique names) currently working any row in this group
        sellers: new Set<string>(),
      };
    }
    const g = campGroups[key];
    g.channels.add(c.channel);
    g.statuses[c.status] = (g.statuses[c.status] ?? 0) + 1;
    g.totalLeads++;
    if (c.lead_id && renurturingLeadIds.has(c.lead_id) && (c.status === "active" || c.status === "paused")) {
      g.is_renurturing = true;
    }
    const msgs = msgsByCamp[c.id] ?? { sent: 0, total: 0, liInv: 0, liMsg: 0, em: 0 };
    g.totalMsgsSent += msgs.sent;
    g.liInvitesSent  += msgs.liInv;
    g.liMessagesSent += msgs.liMsg;
    g.emailsSent     += msgs.em;
    if (c.channel === "linkedin" && msgs.liInv > 0) {
      g.liInvitesTotal++;
      if (acceptedCampIds.has(c.id)) g.liInvitesAccepted++;
    }
    // sellers(name) join — supabase can return either an object or a single-
    // element array depending on FK shape; handle both.
    const sellerNameRaw = Array.isArray(c.sellers) ? c.sellers[0]?.name : (c.sellers as any)?.name;
    if (sellerNameRaw) g.sellers.add(sellerNameRaw as string);
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
    liInvitesSent: g.liInvitesSent,
    liMessagesSent: g.liMessagesSent,
    emailsSent: g.emailsSent,
    acceptRate: g.liInvitesTotal > 0
      ? Math.round((g.liInvitesAccepted / g.liInvitesTotal) * 100)
      : null,
    acceptedCount: g.liInvitesAccepted,
    inviteCohort: g.liInvitesTotal,
    sellers: Array.from(g.sellers) as string[],
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
      // Mirror of the semantic on /leads (page.tsx): "in a flow" means an
      // active or paused campaign — not a completed/closed one. Keeps the
      // ticket's Unassigned/With Campaign sub-toggle consistent with the
      // main Leads page chip counts.
      has_campaign: leadCamps.some((c: any) => c.status === "active" || c.status === "paused"),
    };
  });

  // ── Ticket-level metrics ──────────────────────────────────────────────
  // Aggregates that don't fit neatly inside a campaign card. Boss asked
  // 2026-05-27 to surface channel breakdowns + win/lost/reply/win rate at
  // the ticket header so sellers can read the ICP's overall health
  // without expanding every campaign.
  let liInvitesSent = 0;
  let liMessagesSent = 0;
  let emailsSent = 0;
  for (const m of (messages ?? []) as any[]) {
    if (!m.sent_at) continue;
    if (m.channel === "linkedin") {
      if (m.step_number === 0) liInvitesSent++;
      else liMessagesSent++;
    } else if (m.channel === "email") {
      emailsSent++;
    }
  }
  const callsMade = (callsRows ?? []).length;
  // Won / Lost classification — prefer the lead.status field (closed_won /
  // closed_lost / qualified), with transferred_to_odoo_at as a belt-and-
  // braces "this lead actually became an opportunity" signal.
  const wonCount = (leads ?? []).filter((l: any) =>
    l.status === "closed_won" || l.status === "qualified" || !!l.transferred_to_odoo_at).length;
  const lostCount = (leads ?? []).filter((l: any) => l.status === "closed_lost").length;
  // Reply rate = unique leads that ever replied / unique leads contacted
  // (status moved past 'new'). Win rate = won / (won + lost), avoids
  // dividing by total leads which exaggerates the metric when most leads
  // are still in flight.
  const contactedLeadIds = new Set(
    (leads ?? []).filter((l: any) => l.status && l.status !== "new").map((l: any) => l.id),
  );
  const repliedLeadIds = new Set(
    Object.keys(repliesByLead).filter(id => (repliesByLead[id] ?? []).length > 0),
  );
  const replyRate = contactedLeadIds.size > 0
    ? Math.round((repliedLeadIds.size / contactedLeadIds.size) * 100)
    : 0;
  const winRate = (wonCount + lostCount) > 0
    ? Math.round((wonCount / (wonCount + lostCount)) * 100)
    : 0;
  const unassignedCount = (leads ?? []).filter((l: any) => {
    const hasCamp = (campsByLeadId[l.id] ?? []).length > 0;
    return !hasCamp;
  }).length;

  const metrics = {
    totalLeads: (leads ?? []).length,
    unassignedCount,
    linkedinInvitesSent: liInvitesSent,
    linkedinMessagesSent: liMessagesSent,
    emailsSent,
    callsMade,
    won: wonCount,
    lost: lostCount,
    replyRate,
    winRate,
  };

  return { name: profile.profile_name, campaigns: campaignList, leads: leadList, metrics, updates };
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
      profileId={id}
      ticketName={data.name}
      campaigns={data.campaigns}
      leads={data.leads}
      metrics={data.metrics}
      updates={data.updates}
    />
  );
}
