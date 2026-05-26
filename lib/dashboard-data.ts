// Shared metrics layer for the new Dashboard + drill-downs + the PDF export.
// Pre-2026-05-26 these computations lived inline in /reports/page.tsx. Moving
// them here lets the new top-level Dashboard, the per-campaign / per-icp /
// per-seller drill-downs and the print page all derive from the same numbers
// (so what you see matches what you export).

import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";

export type DashboardFilters = {
  /** ISO YYYY-MM-DD (inclusive). null = no lower bound. */
  from: string | null;
  /** ISO YYYY-MM-DD (inclusive). null = no upper bound. */
  to: string | null;
  /** Restrict to specific campaign names (the wizard groups by name). */
  campaignNames?: string[];
  /** Restrict to specific seller ids. */
  sellerIds?: string[];
  /** Restrict to specific ICP profile ids. */
  icpIds?: string[];
};

type LeadRow = {
  id: string;
  status: string | null;
  lead_score: number | null;
  is_priority: boolean | null;
  icp_profile_id: string | null;
  created_at: string | null;
  company_bio_id: string | null;
};
type CampRow = {
  id: string;
  name: string;
  status: string | null;
  channel: string | null;
  current_step: number | null;
  sequence_steps: unknown;
  lead_id: string | null;
  seller_id: string | null;
  created_at: string | null;
  stop_reason?: string | null;
};
type ReplyRow = {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  classification: string | null;
  channel: string | null;
  received_at: string | null;
};
type MsgRow = {
  id: string;
  campaign_id: string | null;
  step_number: number | null;
  status: string | null;
  sent_at: string | null;
};

const POSITIVE_CLASS = new Set(["positive", "meeting_intent"]);
const NEGATIVE_CLASS = new Set(["negative", "not_now", "unsubscribe"]);

function inWindow(iso: string | null | undefined, fromMs: number | null, toMs: number | null) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (fromMs !== null && t < fromMs) return false;
  if (toMs !== null && t > toMs) return false;
  return true;
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? 100 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

/**
 * Pulls the full tenant-scoped dataset and computes every metric the new
 * Dashboard needs: headline KPIs (with prior-period deltas), the funnel,
 * per-channel breakdown, ICP / campaign / seller comparisons, and 30-day
 * trend sparklines.
 *
 * Super_admin (no `scope.companyBioId`) sees every tenant — that's intentional
 * for SWL ops. Scoped users (client tenants) only see their own data via the
 * `leads.company_bio_id = bioId` join.
 */
export async function getDashboardData(filters: DashboardFilters) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const leadsQ = supabase.from("leads").select("id, status, lead_score, is_priority, icp_profile_id, created_at, company_bio_id");
  const campsQ = supabase.from("campaigns").select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, created_at, stop_reason, leads!inner(company_bio_id)");
  const repliesQ = supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at, leads!inner(company_bio_id)");
  const msgsQ = supabase.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, campaigns!inner(leads!inner(company_bio_id))");
  const profilesQ = supabase.from("icp_profiles").select("id, profile_name, company_bio_id").eq("status", "approved");
  const sellersQ = supabase.from("sellers").select("id, name, active, company_bio_id");

  const [
    { data: allLeadsRaw },
    { data: allCampsRaw },
    { data: allRepliesRaw },
    { data: allMsgsRaw },
    { data: allProfilesRaw },
    { data: allSellersRaw },
  ] = await Promise.all([
    bioId ? leadsQ.eq("company_bio_id", bioId) : leadsQ,
    bioId ? campsQ.eq("leads.company_bio_id", bioId) : campsQ,
    bioId ? repliesQ.eq("leads.company_bio_id", bioId) : repliesQ,
    bioId ? msgsQ.eq("campaigns.leads.company_bio_id", bioId) : msgsQ,
    bioId ? profilesQ.eq("company_bio_id", bioId) : profilesQ,
    bioId ? sellersQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`) : sellersQ,
  ]);

  const allLeads = (allLeadsRaw ?? []) as LeadRow[];
  const allCampaigns = (allCampsRaw ?? []) as CampRow[];
  const allReplies = (allRepliesRaw ?? []) as ReplyRow[];
  const allMessages = (allMsgsRaw ?? []) as MsgRow[];
  const allProfiles = (allProfilesRaw ?? []) as { id: string; profile_name: string }[];
  const allSellers = (allSellersRaw ?? []) as { id: string; name: string; active: boolean }[];

  // ── Apply user-supplied filters in-memory ───────────────────────────────
  const fromMs = filters.from ? new Date(`${filters.from}T00:00:00Z`).getTime() : null;
  const toMs   = filters.to   ? new Date(`${filters.to}T23:59:59Z`).getTime()   : null;
  const campSet   = filters.campaignNames && filters.campaignNames.length > 0 ? new Set(filters.campaignNames) : null;
  const sellerSet = filters.sellerIds && filters.sellerIds.length > 0 ? new Set(filters.sellerIds) : null;
  const icpSet    = filters.icpIds && filters.icpIds.length > 0 ? new Set(filters.icpIds) : null;

  const leads = allLeads.filter(l => {
    if (icpSet && !icpSet.has(l.icp_profile_id ?? "")) return false;
    if (fromMs !== null || toMs !== null) {
      if (!inWindow(l.created_at, fromMs, toMs)) return false;
    }
    return true;
  });
  const leadIdSet = new Set(leads.map(l => l.id));

  const campaigns = allCampaigns.filter(c => {
    if (campSet && !campSet.has(c.name)) return false;
    if (sellerSet && !sellerSet.has(c.seller_id ?? "")) return false;
    if (icpSet && c.lead_id && !leadIdSet.has(c.lead_id)) return false;
    return true;
  });
  const campaignIdSet = new Set(campaigns.map(c => c.id));

  const replies = allReplies.filter(r => {
    if (fromMs !== null || toMs !== null) {
      if (!inWindow(r.received_at, fromMs, toMs)) return false;
    }
    if (icpSet && r.lead_id && !leadIdSet.has(r.lead_id)) return false;
    if ((campSet || sellerSet) && r.campaign_id && !campaignIdSet.has(r.campaign_id)) return false;
    return true;
  });

  const messages = allMessages.filter(m => {
    if (m.status !== "sent") return false;
    if (fromMs !== null || toMs !== null) {
      if (!inWindow(m.sent_at, fromMs, toMs)) return false;
    }
    if ((campSet || sellerSet || icpSet) && m.campaign_id && !campaignIdSet.has(m.campaign_id)) return false;
    return true;
  });

  // Lookup maps used by every downstream block.
  const profileMap = new Map<string, string>();
  for (const p of allProfiles) profileMap.set(p.id, p.profile_name);
  const sellerMap = new Map<string, string>();
  for (const s of allSellers) sellerMap.set(s.id, s.name);
  const campByName = new Map<string, CampRow[]>();
  for (const c of campaigns) {
    const list = campByName.get(c.name) ?? [];
    list.push(c);
    campByName.set(c.name, list);
  }

  // ── Funnel sets ─────────────────────────────────────────────────────────
  //   leads imported (everything in `leads`)
  //   contacted: a campaign exists for that lead (CR sent or queued)
  //   connected: a sent message at step_number >= 1 (post-acceptance) OR a
  //              campaign with current_step >= 1
  //   replied: any inbound message
  //   positive: classification ∈ POSITIVE_CLASS
  //   meeting: lead.status = 'qualified'  (the manual cascade / odoo path)
  //   won: lead.status = 'closed_won'
  const leadsWithCampaign = new Set(campaigns.map(c => c.lead_id).filter(Boolean) as string[]);
  const connectedLeadIds = new Set<string>();
  for (const m of messages) {
    if ((m.step_number ?? 0) >= 1 && m.campaign_id) {
      const c = campaigns.find(x => x.id === m.campaign_id);
      if (c?.lead_id) connectedLeadIds.add(c.lead_id);
    }
  }
  for (const c of campaigns) if ((c.current_step ?? 0) >= 1 && c.lead_id) connectedLeadIds.add(c.lead_id);
  const repliedLeadIds = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveReplies = replies.filter(r => POSITIVE_CLASS.has(r.classification ?? ""));
  const negativeReplies = replies.filter(r => NEGATIVE_CLASS.has(r.classification ?? ""));
  const positiveLeadIds = new Set(positiveReplies.map(r => r.lead_id).filter(Boolean) as string[]);
  const meetingLeadIds = new Set(leads.filter(l => l.status === "qualified").map(l => l.id));
  const wonLeadIds = new Set(leads.filter(l => l.status === "closed_won").map(l => l.id));

  const totalLeads = leads.length;
  const contactedLeads = leadsWithCampaign.size;
  const connectedLeads = connectedLeadIds.size;
  const repliedCount = repliedLeadIds.size;
  const positiveCount = positiveLeadIds.size;
  const meetingCount = meetingLeadIds.size;
  const wonCount = wonLeadIds.size;
  const negativeCount = new Set(negativeReplies.map(r => r.lead_id).filter(Boolean) as string[]).size;

  const responseRate = contactedLeads > 0 ? Math.round((repliedCount / contactedLeads) * 100) : 0;
  const positiveRate = repliedCount > 0 ? Math.round((positiveCount / repliedCount) * 100) : 0;
  const conversionRate = contactedLeads > 0 ? Math.round((positiveCount / contactedLeads) * 100) : 0;
  const acceptanceRate = contactedLeads > 0 ? Math.round((connectedLeads / contactedLeads) * 100) : 0;

  // ── Per-channel breakdown ───────────────────────────────────────────────
  const channelStats = new Map<string, { sent: number; contacted: Set<string>; replied: Set<string>; positive: Set<string> }>();
  for (const c of campaigns) {
    const ch = c.channel ?? "linkedin";
    let s = channelStats.get(ch);
    if (!s) { s = { sent: 0, contacted: new Set(), replied: new Set(), positive: new Set() }; channelStats.set(ch, s); }
    if (c.lead_id) {
      s.contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) s.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) s.positive.add(c.lead_id);
    }
  }
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const s = channelStats.get(c.channel ?? "linkedin");
    if (s) s.sent++;
  }
  const channelBreakdown = Array.from(channelStats.entries()).map(([channel, s]) => ({
    channel,
    sent: s.sent,
    contacted: s.contacted.size,
    replied: s.replied.size,
    positive: s.positive.size,
    responseRate: s.contacted.size > 0 ? Math.round((s.replied.size / s.contacted.size) * 100) : 0,
    conversionRate: s.contacted.size > 0 ? Math.round((s.positive.size / s.contacted.size) * 100) : 0,
  })).sort((a, b) => b.responseRate - a.responseRate);

  // ── ICP performance ─────────────────────────────────────────────────────
  type IcpAgg = { id: string; name: string; leads: number; contacted: number; replied: number; positive: number };
  const icpAgg = new Map<string, IcpAgg>();
  for (const l of leads) {
    const id = l.icp_profile_id ?? "_unknown";
    let g = icpAgg.get(id);
    if (!g) { g = { id, name: profileMap.get(id) ?? "Sin ICP", leads: 0, contacted: 0, replied: 0, positive: 0 }; icpAgg.set(id, g); }
    g.leads++;
    if (leadsWithCampaign.has(l.id)) g.contacted++;
    if (repliedLeadIds.has(l.id)) g.replied++;
    if (positiveLeadIds.has(l.id)) g.positive++;
  }
  const icpPerformance = Array.from(icpAgg.values()).map(g => ({
    ...g,
    responseRate: g.contacted > 0 ? Math.round((g.replied / g.contacted) * 100) : 0,
    conversionRate: g.contacted > 0 ? Math.round((g.positive / g.contacted) * 100) : 0,
  })).sort((a, b) => b.conversionRate - a.conversionRate || b.leads - a.leads);

  // ── Campaign performance (grouped by name) ─────────────────────────────
  type CampAgg = {
    name: string; channels: Set<string>;
    leads: Set<string>; replied: Set<string>; positive: Set<string>; negative: Set<string>;
    sent: number; status: string;
    statuses: Set<string>;
    totalSteps: number;
    stepSum: number;
    stepCount: number;
  };
  const campAgg = new Map<string, CampAgg>();
  for (const c of campaigns) {
    let g = campAgg.get(c.name);
    if (!g) {
      g = { name: c.name, channels: new Set(), leads: new Set(), replied: new Set(), positive: new Set(), negative: new Set(),
            sent: 0, status: c.status ?? "active", statuses: new Set(), totalSteps: 0, stepSum: 0, stepCount: 0 };
      campAgg.set(c.name, g);
    }
    g.channels.add(c.channel ?? "linkedin");
    g.statuses.add(c.status ?? "active");
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
      const ns = new Set(negativeReplies.map(r => r.lead_id).filter(Boolean) as string[]);
      if (ns.has(c.lead_id)) g.negative.add(c.lead_id);
    }
    const ts = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
    g.totalSteps = Math.max(g.totalSteps, ts);
    g.stepSum += c.current_step ?? 0;
    g.stepCount++;
  }
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c) continue;
    const g = campAgg.get(c.name);
    if (g) g.sent++;
  }
  const campaignPerformance = Array.from(campAgg.values()).map(g => {
    // Aggregate status: if any campaign in the group is active → active,
    // else if any paused → paused, else completed.
    let status = "completed";
    if (g.statuses.has("active")) status = "active";
    else if (g.statuses.has("paused")) status = "paused";
    return {
      name: g.name,
      channels: Array.from(g.channels),
      leads: g.leads.size,
      sent: g.sent,
      replied: g.replied.size,
      positive: g.positive.size,
      negative: g.negative.size,
      avgStep: g.stepCount > 0 ? Math.round((g.stepSum / g.stepCount) * 10) / 10 : 0,
      totalSteps: g.totalSteps,
      responseRate: g.leads.size > 0 ? Math.round((g.replied.size / g.leads.size) * 100) : 0,
      conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
      status,
    };
  }).sort((a, b) => b.conversionRate - a.conversionRate || b.leads - a.leads);

  // ── Seller leaderboard ─────────────────────────────────────────────────
  type SellerAgg = { id: string; name: string; contacted: Set<string>; replied: Set<string>; positive: Set<string>; active: number; sent: number };
  const sellerAgg = new Map<string, SellerAgg>();
  for (const c of campaigns) {
    if (!c.seller_id) continue;
    let g = sellerAgg.get(c.seller_id);
    if (!g) { g = { id: c.seller_id, name: sellerMap.get(c.seller_id) ?? "Sin asignar", contacted: new Set(), replied: new Set(), positive: new Set(), active: 0, sent: 0 }; sellerAgg.set(c.seller_id, g); }
    if (c.lead_id) {
      g.contacted.add(c.lead_id);
      if (repliedLeadIds.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveLeadIds.has(c.lead_id)) g.positive.add(c.lead_id);
    }
    if (c.status === "active") g.active++;
  }
  for (const m of messages) {
    if (!m.campaign_id) continue;
    const c = campaigns.find(x => x.id === m.campaign_id);
    if (!c?.seller_id) continue;
    const g = sellerAgg.get(c.seller_id);
    if (g) g.sent++;
  }
  const sellerPerformance = Array.from(sellerAgg.values()).map(g => ({
    id: g.id,
    name: g.name,
    contacted: g.contacted.size,
    sent: g.sent,
    replied: g.replied.size,
    positive: g.positive.size,
    active: g.active,
    responseRate: g.contacted.size > 0 ? Math.round((g.replied.size / g.contacted.size) * 100) : 0,
    conversionRate: g.contacted.size > 0 ? Math.round((g.positive.size / g.contacted.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive || b.sent - a.sent);

  // ── 30-day daily trend ──────────────────────────────────────────────────
  // Buckets each metric by day so the dashboard can render sparklines + a
  // big multi-line chart. Always 30 buckets, oldest → newest.
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dayBucket = (iso: string) => {
    const d = new Date(iso);
    return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  };
  const trendSent: number[] = new Array(30).fill(0);
  const trendReplies: number[] = new Array(30).fill(0);
  const trendPositive: number[] = new Array(30).fill(0);
  for (const m of messages) {
    if (!m.sent_at) continue;
    const idx = 29 - dayBucket(m.sent_at);
    if (idx >= 0 && idx < 30) trendSent[idx]++;
  }
  for (const r of replies) {
    if (!r.received_at) continue;
    const idx = 29 - dayBucket(r.received_at);
    if (idx >= 0 && idx < 30) {
      trendReplies[idx]++;
      if (POSITIVE_CLASS.has(r.classification ?? "")) trendPositive[idx]++;
    }
  }
  const trend30d = { sent: trendSent, replies: trendReplies, positive: trendPositive };

  // ── Prior-period deltas (same window, immediately before) ──────────────
  const periodMs = (fromMs !== null && toMs !== null)
    ? toMs - fromMs
    : 30 * 86_400_000;
  const priorTo = fromMs !== null ? fromMs : (Date.now() - 30 * 86_400_000);
  const priorFrom = priorTo - periodMs;
  const priorReplies = allReplies.filter(r => {
    if (!r.received_at) return false;
    const t = new Date(r.received_at).getTime();
    return t >= priorFrom && t < priorTo;
  });
  const priorContactedLeads = new Set(
    allCampaigns
      .filter(c => c.created_at && new Date(c.created_at).getTime() >= priorFrom && new Date(c.created_at).getTime() < priorTo)
      .map(c => c.lead_id)
      .filter(Boolean) as string[],
  ).size;
  const priorRepliedSize = new Set(priorReplies.map(r => r.lead_id).filter(Boolean) as string[]).size;
  const priorPositiveSize = new Set(priorReplies.filter(r => POSITIVE_CLASS.has(r.classification ?? "")).map(r => r.lead_id).filter(Boolean) as string[]).size;

  const deltas = {
    contacted: pctDelta(contactedLeads, priorContactedLeads),
    replied:   pctDelta(repliedCount, priorRepliedSize),
    positive:  pctDelta(positiveCount, priorPositiveSize),
  };

  // ── Reply classification breakdown (donut data) ─────────────────────────
  const replyClassCounts: Record<string, number> = {};
  for (const r of replies) {
    const k = r.classification ?? "unclassified";
    replyClassCounts[k] = (replyClassCounts[k] ?? 0) + 1;
  }

  // ── Auto insights ───────────────────────────────────────────────────────
  const insights: { tone: "positive" | "warning" | "neutral"; text: string }[] = [];
  if (deltas.positive !== null && deltas.positive >= 15) {
    insights.push({ tone: "positive", text: `Respuestas positivas ↑${deltas.positive}% vs período anterior — el flow está tomando tracción.` });
  } else if (deltas.positive !== null && deltas.positive <= -15) {
    insights.push({ tone: "warning", text: `Respuestas positivas ↓${Math.abs(deltas.positive)}% vs período anterior — revisá qué campaña se enfrió.` });
  }
  if (channelBreakdown.length >= 2) {
    const best = channelBreakdown[0];
    const worst = channelBreakdown[channelBreakdown.length - 1];
    const gap = best.responseRate - worst.responseRate;
    if (gap >= 15) insights.push({ tone: "neutral", text: `${best.channel} responde ${gap}% mejor que ${worst.channel} — considerá rebalancear el mix.` });
  }
  if (sellerPerformance.length >= 2 && sellerPerformance[0].positive >= sellerPerformance[1].positive + 3) {
    insights.push({ tone: "positive", text: `${sellerPerformance[0].name} lidera con ${sellerPerformance[0].positive} positivas (+${sellerPerformance[0].positive - sellerPerformance[1].positive} sobre #2).` });
  }
  const stagnant = campaignPerformance.filter(c => c.leads >= 10 && c.conversionRate === 0 && c.status === "active");
  if (stagnant.length > 0) {
    insights.push({ tone: "warning", text: `${stagnant.length} campaña${stagnant.length === 1 ? "" : "s"} con 0% conversión y ≥10 leads — revisar mensajes o pausar.` });
  }

  return {
    period: { from: filters.from, to: filters.to, days: Math.round(periodMs / 86_400_000) },
    headline: {
      totalLeads, contactedLeads, connectedLeads,
      repliedCount, positiveCount, negativeCount, meetingCount, wonCount,
      responseRate, positiveRate, conversionRate, acceptanceRate,
    },
    deltas,
    funnel: [
      { stage: "Importados",  count: totalLeads,    color: "neutral" },
      { stage: "Contactados", count: contactedLeads, color: "info" },
      { stage: "Aceptaron",   count: connectedLeads, color: "info" },
      { stage: "Respondieron", count: repliedCount,  color: "warning" },
      { stage: "Positivos",    count: positiveCount, color: "success" },
      { stage: "Reunión",      count: meetingCount,  color: "success" },
      { stage: "Ganados",      count: wonCount,      color: "brand" },
    ],
    channelBreakdown,
    icpPerformance,
    campaignPerformance,
    sellerPerformance,
    trend30d,
    replyClassCounts,
    insights: insights.slice(0, 4),
    activeCampaignCount: campaigns.filter(c => c.status === "active").length,
    pausedCampaignCount: campaigns.filter(c => c.status === "paused").length,
    completedCampaignCount: campaigns.filter(c => c.status === "completed").length,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
