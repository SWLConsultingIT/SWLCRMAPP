// Daily cron that closes campaigns whose LinkedIn connection request was sent
// more than INVITE_TTL_DAYS ago without acceptance. Without this, a stale
// invite would keep the campaign in "active" forever and the lead would clog
// pipeline reports as "still being worked."
//
// Why 10 days (not 21): pending invites consume LinkedIn's pending-invite
// pool (typically capped at ~150-200 on cold accounts before throttling),
// not the daily-send pool. For low-cap sellers like Graeme (10/day) the pool
// fills up fast and slows new sends, so we recycle stale invites aggressively.
// Industry "B2B cold" default is 21 days; we go more aggressive because the
// pool size is the bottleneck, not the lead's accept window.
//
// Side effects:
//  - campaigns.status = 'completed', stop_reason = 'invite_expired'
//  - leads.status = 'closed_lost', archived = true (soft archive — can recover)
//  - lead_suppressions row with channel='linkedin', expires_at = now + 90d so
//    we can re-attempt with new copy after a cooldown.
//
// Auth: same Bearer CRON_SECRET as other crons. Orquestador hits this once a
// day on the 3am UTC branch.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const INVITE_TTL_DAYS = 10;
const SUPPRESSION_TTL_DAYS = 90;
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const cutoffISO = new Date(Date.now() - INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const suppressionExpiresAt = new Date(Date.now() + SUPPRESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nowISO = new Date().toISOString();

  // Find step-0 invites sent before the cutoff whose lead never connected.
  // We deliberately don't filter by campaign.status here in the SQL — we
  // do that post-fetch so we can count "would-have-been but was already
  // closed" cases for the response.
  const { data: candidates, error: fetchErr } = await svc
    .from("campaign_messages")
    .select(`
      id, campaign_id, lead_id, sent_at,
      campaigns!inner(id, status, stop_reason),
      leads!inner(id, status, linkedin_connected)
    `)
    .eq("step_number", 0)
    .eq("channel", "linkedin")
    .eq("status", "sent")
    .lt("sent_at", cutoffISO);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const expirable = (candidates ?? []).filter((row: any) => {
    const camp = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    if (!camp || !lead) return false;
    if (camp.status !== "active" && camp.status !== "paused") return false;
    if (lead.linkedin_connected) return false;
    return true;
  });

  if (expirable.length === 0) {
    return NextResponse.json({ ok: true, expired: 0, scanned: candidates?.length ?? 0 });
  }

  const campaignIds = [...new Set(expirable.map((r: any) => r.campaign_id))];
  const leadIds = [...new Set(expirable.map((r: any) => r.lead_id))];

  // 1. Mark campaigns completed with stop_reason. Use IN-clause batch update.
  await svc
    .from("campaigns")
    .update({ status: "completed", stop_reason: "invite_expired", completed_at: nowISO })
    .in("id", campaignIds);

  // 2. Soft-archive the leads. We keep the row for analytics + future recovery.
  await svc
    .from("leads")
    .update({ status: "closed_lost", archived: true })
    .in("id", leadIds);

  // 3. Insert suppression rows so the lead can't be re-targeted on LinkedIn
  //    for 90 days. After that they're eligible again with new copy.
  const suppressionRows = leadIds.map(leadId => ({
    lead_id: leadId,
    channel: "linkedin",
    reason: "invite_expired",
    source: "cron-expire-invites",
    active: true,
    expires_at: suppressionExpiresAt,
  }));
  await svc.from("lead_suppressions").insert(suppressionRows);

  return NextResponse.json({
    ok: true,
    scanned: candidates?.length ?? 0,
    expired: expirable.length,
    campaignsClosed: campaignIds.length,
    leadsArchived: leadIds.length,
    cutoff: cutoffISO,
  });
}
