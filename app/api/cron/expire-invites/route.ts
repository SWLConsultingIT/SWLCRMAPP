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
//  - Unipile: DELETE pending invitation (best-effort — failures don't block close)
//  - campaigns.status = 'completed', stop_reason = 'invite_expired'
//  - leads.status = 'closed_lost', archived = true (soft archive — can recover)
//  - lead_suppressions row with channel='linkedin', expires_at = now + 90d so
//    we can re-attempt with new copy after a cooldown.
//
// Why withdraw in Unipile too: marking the campaign 'completed' in DB without
// removing the pending invite leaves the request alive in the seller's
// LinkedIn account forever. That consumes the pending pool and blocks future
// outreach to the same lead (Unipile returns 'invitation already sent').
// Closing the loop here keeps both systems consistent.
//
// Auth: same Bearer CRON_SECRET as other crons. Orquestador hits this once a
// day on the 3am UTC branch.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const INVITE_TTL_DAYS = 10;
const SUPPRESSION_TTL_DAYS = 90;
const CRON_SECRET = process.env.CRON_SECRET;
const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";

type WithdrawResult =
  | { ok: true; status: "withdrawn" }
  | { ok: true; status: "already_gone" }
  | { ok: false; status: "failed"; reason: string };

async function withdrawInvitation(invitationId: string, accountId: string): Promise<WithdrawResult> {
  if (!UNIPILE_KEY) return { ok: false, status: "failed", reason: "UNIPILE_API_KEY missing" };
  const url = `${UNIPILE_BASE}/api/v1/users/invite/sent/${encodeURIComponent(invitationId)}?account_id=${encodeURIComponent(accountId)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" },
    });
    if (res.ok) return { ok: true, status: "withdrawn" };
    // 404 = invitation already gone (accepted/declined/withdrawn manually). Treat as success.
    if (res.status === 404) return { ok: true, status: "already_gone" };
    const body = await res.text().catch(() => "");
    return { ok: false, status: "failed", reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, status: "failed", reason: e?.message ?? String(e) };
  }
}

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
  // provider_message_id is the Unipile invitation_id we need to withdraw.
  // campaigns.seller_id chains to sellers.unipile_account_id, also required.
  const { data: candidates, error: fetchErr } = await svc
    .from("campaign_messages")
    .select(`
      id, campaign_id, lead_id, sent_at, provider_message_id,
      campaigns!inner(id, status, stop_reason, seller_id, sequence_steps, current_step),
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

  // Resolve unipile_account_id per seller for the withdraw calls.
  const sellerIds = [
    ...new Set(
      expirable
        .map((r: any) => {
          const camp = Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns;
          return camp?.seller_id as string | null | undefined;
        })
        .filter((x): x is string => !!x),
    ),
  ];
  const sellerById = new Map<string, { unipile_account_id: string | null }>();
  if (sellerIds.length > 0) {
    const { data: sellerRows } = await svc
      .from("sellers")
      .select("id, unipile_account_id")
      .in("id", sellerIds);
    for (const s of sellerRows ?? []) {
      sellerById.set(s.id as string, { unipile_account_id: s.unipile_account_id as string | null });
    }
  }

  // Best-effort withdraw per expirable invite. We always close the campaign
  // even if withdraw fails — DB consistency is the primary goal, Unipile
  // cleanup is secondary and can be retried via the manual endpoint.
  let withdrawnCount = 0;
  let alreadyGoneCount = 0;
  let withdrawFailedCount = 0;
  const withdrawFailures: Array<{ msgId: string; leadId: string; reason: string }> = [];

  for (const row of expirable) {
    const camp = Array.isArray((row as any).campaigns) ? (row as any).campaigns[0] : (row as any).campaigns;
    const sellerId = camp?.seller_id as string | null | undefined;
    const invitationId = (row as any).provider_message_id as string | null;
    const accountId = sellerId ? sellerById.get(sellerId)?.unipile_account_id ?? null : null;

    if (!invitationId || !accountId) {
      withdrawFailedCount += 1;
      withdrawFailures.push({
        msgId: (row as any).id,
        leadId: (row as any).lead_id,
        reason: !invitationId ? "missing provider_message_id" : "missing seller.unipile_account_id",
      });
      continue;
    }

    const result = await withdrawInvitation(invitationId, accountId);
    if (result.ok && result.status === "withdrawn") withdrawnCount += 1;
    else if (result.ok && result.status === "already_gone") alreadyGoneCount += 1;
    else if (!result.ok) {
      withdrawFailedCount += 1;
      withdrawFailures.push({
        msgId: (row as any).id,
        leadId: (row as any).lead_id,
        reason: result.reason,
      });
    }

    // Stamp the outcome on the message so the reliability dashboard / future
    // manual retries can see what happened without re-calling Unipile.
    await svc
      .from("campaign_messages")
      .update({
        metadata: {
          dispatched_by: "cron-expire-invites",
          withdraw_attempted_at: nowISO,
          withdraw_status: result.ok ? result.status : "failed",
          ...(result.ok ? {} : { withdraw_error: result.reason }),
        },
      })
      .eq("id", (row as any).id);
  }

  // Split: a multichannel flow with remaining NON-LinkedIn steps (call/email at
  // index >= current_step) must NOT be killed when the LinkedIn invite expires —
  // the lead can still be called/emailed (boss 2026-06-09: 22 PE-USA leads the
  // seller wanted to CALL got dumped into Lost because the cron completed the
  // whole flow on invite_expired). For those, we still withdraw the stale invite
  // + suppress LinkedIn (done above/below), but keep the campaign active and the
  // lead open. Only flows with no actionable non-LinkedIn step left get closed.
  const hasRemainingNonLinkedIn = (row: any): boolean => {
    const camp = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
    const steps: Array<{ channel?: string }> = Array.isArray(camp?.sequence_steps) ? camp.sequence_steps : [];
    const cur = camp?.current_step ?? 0;
    return steps.some((s, i) => i >= cur && s?.channel && s.channel !== "linkedin");
  };
  const deadRows = expirable.filter(r => !hasRemainingNonLinkedIn(r));
  const aliveRows = expirable.filter(hasRemainingNonLinkedIn);

  const campaignIds = [...new Set(deadRows.map((r: any) => r.campaign_id))];
  const leadIds = [...new Set(deadRows.map((r: any) => r.lead_id))];
  const aliveCount = new Set(aliveRows.map((r: any) => r.campaign_id)).size;

  // 1. Mark only the truly-dead campaigns completed with stop_reason.
  if (campaignIds.length > 0) {
    await svc
      .from("campaigns")
      .update({ status: "completed", stop_reason: "invite_expired", completed_at: nowISO })
      .in("id", campaignIds);
  }

  // 2. Soft-archive only those leads. Multichannel-alive leads stay open so the
  //    seller can still call/email them.
  if (leadIds.length > 0) {
    await svc
      .from("leads")
      .update({ status: "closed_lost", archived: true })
      .in("id", leadIds);
  }

  // 3. Suppress LinkedIn for 90 days on EVERY expirable lead (the invite was
  //    withdrawn regardless), so we don't re-invite — but for multichannel-alive
  //    leads the call/email steps keep running. Channel-scoped, so it doesn't
  //    block other channels.
  const allExpirableLeadIds = [...new Set(expirable.map((r: any) => r.lead_id))];
  const suppressionRows = allExpirableLeadIds.map(leadId => ({
    lead_id: leadId,
    channel: "linkedin",
    reason: "invite_expired",
    source: "cron-expire-invites",
    active: true,
    expires_at: suppressionExpiresAt,
  }));
  if (suppressionRows.length > 0) await svc.from("lead_suppressions").insert(suppressionRows);

  return NextResponse.json({
    ok: true,
    scanned: candidates?.length ?? 0,
    expired: expirable.length,
    campaignsClosed: campaignIds.length,
    leadsArchived: leadIds.length,
    multichannelKeptAlive: aliveCount,
    withdrawn: withdrawnCount,
    alreadyGone: alreadyGoneCount,
    withdrawFailed: withdrawFailedCount,
    withdrawFailures: withdrawFailures.length > 0 ? withdrawFailures : undefined,
    cutoff: cutoffISO,
  });
}
