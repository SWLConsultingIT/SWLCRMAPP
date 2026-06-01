// GET /api/templates/historic — returns past flows grouped by (name + ICP).
//
// "Historic flow" = the aggregate of every campaign sharing the same
// `name` under the same `icp_profile_id` whose status is `completed`,
// `failed`, or `closed_lost`. Each group is one card in the new
// Historic tab of /campaigns?tab=templates and represents a flow that
// already ran. The endpoint exists separately from /api/templates
// because the data shape is different (no editable template row — this
// is purely derived from campaigns + campaign_messages + lead_replies).
//
// Scoped to the caller's tenant via getUserScope().

import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const TERMINAL_STATUSES = ["completed", "failed", "closed_lost"] as const;
const CHUNK = 40;

export async function GET() {
  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scope.isScoped || !scope.companyBioId) {
    // Super-admins without a tenant cookie don't have a sensible "my
    // historic flows" view — bounce them.
    return NextResponse.json({ historic: [] });
  }

  const svc = getSupabaseService();
  const bioId = scope.companyBioId;

  // 1. Pull every terminal-status campaign in the tenant.
  const { data: camps, error: cErr } = await svc
    .from("campaigns")
    .select("id, name, status, channel, icp_profile_id, sequence_steps, current_step, started_at, last_step_at, created_at, sellers(name)")
    .eq("company_bio_id", bioId)
    .in("status", TERMINAL_STATUSES);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const campaigns = camps ?? [];
  if (campaigns.length === 0) return NextResponse.json({ historic: [] });

  // 2. Pull every campaign_message + lead_reply tied to those campaigns.
  //    Chunk .in() to avoid PostgREST URL length issues.
  const cIds = campaigns.map(c => c.id);
  let messages: Array<{ campaign_id: string; status: string; channel: string; step_number: number | null; sent_at: string | null }> = [];
  let replies: Array<{ campaign_id: string; classification: string | null }> = [];
  for (let i = 0; i < cIds.length; i += CHUNK) {
    const slice = cIds.slice(i, i + CHUNK);
    const [mRes, rRes] = await Promise.all([
      svc.from("campaign_messages").select("campaign_id, status, channel, step_number, sent_at").in("campaign_id", slice),
      svc.from("lead_replies").select("campaign_id, classification").in("campaign_id", slice),
    ]);
    if (mRes.data) messages = messages.concat(mRes.data);
    if (rRes.data) replies = replies.concat(rRes.data);
  }

  // 3. ICP name lookup.
  const icpIds = Array.from(new Set(campaigns.map(c => c.icp_profile_id).filter((v): v is string => !!v)));
  const { data: icps } = icpIds.length
    ? await svc.from("icp_profiles").select("id, profile_name").in("id", icpIds)
    : { data: [] as Array<{ id: string; profile_name: string }> };
  const icpName = new Map((icps ?? []).map(i => [i.id, i.profile_name]));

  // 4. Group by (name, icp_profile_id). Aggregate stats per group.
  type Group = {
    key: string;
    name: string;
    icp_profile_id: string | null;
    icp_name: string | null;
    sampleCampaignId: string;
    cohortSize: number;
    channels: Set<string>;
    sellers: Set<string>;
    messagesTotal: number;
    messagesSent: number;
    liInvitesSent: number;
    liMessagesSent: number;
    emailsSent: number;
    repliesTotal: number;
    positiveReplies: number;
    firstStartedAt: string | null;
    lastEndedAt: string | null;
    totalSteps: number;
  };
  const groups = new Map<string, Group>();
  for (const c of campaigns) {
    const key = `${c.icp_profile_id ?? "_no_icp_"}:::${c.name}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: c.name,
        icp_profile_id: c.icp_profile_id ?? null,
        icp_name: c.icp_profile_id ? (icpName.get(c.icp_profile_id) ?? null) : null,
        sampleCampaignId: c.id,
        cohortSize: 0,
        channels: new Set<string>(),
        sellers: new Set<string>(),
        messagesTotal: 0,
        messagesSent: 0,
        liInvitesSent: 0,
        liMessagesSent: 0,
        emailsSent: 0,
        repliesTotal: 0,
        positiveReplies: 0,
        firstStartedAt: null,
        lastEndedAt: null,
        totalSteps: Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0,
      };
      groups.set(key, g);
    }
    g.cohortSize += 1;
    if (c.channel) g.channels.add(c.channel);
    const sellerName = Array.isArray(c.sellers) ? c.sellers[0]?.name : (c.sellers as { name?: string } | null)?.name;
    if (sellerName) g.sellers.add(sellerName);
    if (c.started_at && (!g.firstStartedAt || new Date(c.started_at) < new Date(g.firstStartedAt))) g.firstStartedAt = c.started_at;
    if (c.last_step_at && (!g.lastEndedAt || new Date(c.last_step_at) > new Date(g.lastEndedAt))) g.lastEndedAt = c.last_step_at;
  }

  // Stats from messages.
  const groupByCampId = new Map<string, string>();
  for (const c of campaigns) groupByCampId.set(c.id, `${c.icp_profile_id ?? "_no_icp_"}:::${c.name}`);
  for (const m of messages) {
    const k = groupByCampId.get(m.campaign_id);
    if (!k) continue;
    const g = groups.get(k);
    if (!g) continue;
    g.messagesTotal += 1;
    if (m.status === "sent") {
      g.messagesSent += 1;
      if (m.channel === "linkedin") {
        if (m.step_number === 0) g.liInvitesSent += 1;
        else g.liMessagesSent += 1;
      } else if (m.channel === "email") g.emailsSent += 1;
    }
  }
  for (const r of replies) {
    const k = groupByCampId.get(r.campaign_id);
    if (!k) continue;
    const g = groups.get(k);
    if (!g) continue;
    g.repliesTotal += 1;
    if (r.classification === "positive" || r.classification === "meeting_intent") g.positiveReplies += 1;
  }

  const historic = Array.from(groups.values())
    .map(g => ({
      key: g.key,
      name: g.name,
      icp_profile_id: g.icp_profile_id,
      icp_name: g.icp_name,
      sampleCampaignId: g.sampleCampaignId,
      cohortSize: g.cohortSize,
      channels: [...g.channels],
      sellers: [...g.sellers],
      totalSteps: g.totalSteps,
      messagesSent: g.messagesSent,
      messagesTotal: g.messagesTotal,
      liInvitesSent: g.liInvitesSent,
      liMessagesSent: g.liMessagesSent,
      emailsSent: g.emailsSent,
      repliesTotal: g.repliesTotal,
      positiveReplies: g.positiveReplies,
      replyRate: g.cohortSize > 0 ? Math.round((g.repliesTotal / g.cohortSize) * 100) : 0,
      firstStartedAt: g.firstStartedAt,
      lastEndedAt: g.lastEndedAt,
    }))
    // Sort by recency (lastEndedAt desc), missing dates last.
    .sort((a, b) => {
      if (a.lastEndedAt && b.lastEndedAt) return new Date(b.lastEndedAt).getTime() - new Date(a.lastEndedAt).getTime();
      if (a.lastEndedAt) return -1;
      if (b.lastEndedAt) return 1;
      return b.cohortSize - a.cohortSize;
    });

  return NextResponse.json({ historic });
}
