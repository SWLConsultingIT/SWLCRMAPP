// Auto-skip stale call steps regardless of position in the sequence.
//
// Model (Fran 2026-05-24):
//   The Aircall integration is ALWAYS manual — sellers dial leads themselves.
//   The campaign's `call_advance_mode` only controls what happens when a call
//   step has been queued for too long without a dial:
//
//     - auto:   skip the call step and advance the campaign. The seller may
//               or may not dial during the window; either way the sequence
//               keeps moving so other channels (LinkedIn, email) keep firing.
//     - manual: same outcome but the wait window is longer. The "wait for
//               seller" signal is honored more strictly — the seller has
//               STALE_DAYS_MANUAL to dial, after which we still advance so
//               the lead doesn't sit in /queue forever.
//
// Selection rule:
//   - campaigns.status='active' AND campaigns.archived_at IS NULL
//   - sequence_steps[current_step].channel = 'call'
//   - there's a campaign_messages row at current_step+1 (queued OR draft)
//     to advance to. If there's no next step, the campaign is at its last
//     step and we let it complete naturally (no advance needed).
//   - the queued call message at current_step has been queued long enough
//     to be considered stale (per call_advance_mode).
//
// Safety:
//   - DRY-RUN by default. Add `?execute=1` to actually flip rows.
//   - Per-row UPDATE with WHERE status=<expected> so concurrent dispatchers
//     can't clobber each other.
//   - This cron is idempotent: re-running has no effect on rows that have
//     already advanced.
//
// Auth: same Bearer CRON_SECRET pattern as other crons.
//
// Why this matters: prior version only handled "step 1 = call → step 2 =
// email" campaigns (the first audit-call pattern). Multi-channel campaigns
// with a call at step 2/3/etc. would freeze forever because nothing
// advanced them — exactly what happened to Arqy 2026-05-24 (102 leads
// stuck at call step 2 for 3 days).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const CRON_SECRET = process.env.CRON_SECRET;
// Stale thresholds per mode. The two modes share an end behavior (skip +
// advance) but `manual` gives the seller a longer window because the user
// chose "wait for me to dial" explicitly. Tune later if practice shows
// either window is wrong; centralised here so we change once.
const STALE_DAYS_AUTO = 3;
const STALE_DAYS_MANUAL = 5;

type SeqStep = { channel?: string; daysAfter?: number };
type CampaignRow = {
  id: string;
  lead_id: string;
  current_step: number | null;
  call_advance_mode: "auto" | "manual" | null;
  sequence_steps: SeqStep[] | null;
};
type MessageRow = {
  id: string;
  step_number: number;
  channel: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const execute = req.nextUrl.searchParams.get("execute") === "1";
  const svc = getSupabaseService();
  const nowMs = Date.now();
  const nowISO = new Date().toISOString();

  // 1. Pull every active, non-archived campaign whose current step is a call.
  //    We re-check the channel against sequence_steps[current_step] in JS
  //    because the channel of the current step lives in jsonb.
  const { data: campaigns, error: fetchErr } = await svc
    .from("campaigns")
    .select("id, lead_id, current_step, call_advance_mode, sequence_steps")
    .eq("status", "active")
    .is("archived_at", null);
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  type Candidate = {
    campaign: CampaignRow;
    callMsg: MessageRow;
    nextMsgId: string | null;
    staleDays: number;
    ageDays: number;
    mode: "auto" | "manual";
  };

  const candidates: Candidate[] = [];

  for (const campRaw of (campaigns ?? []) as CampaignRow[]) {
    const steps = Array.isArray(campRaw.sequence_steps) ? campRaw.sequence_steps : [];
    const curIdx = campRaw.current_step ?? 0;
    if (steps[curIdx]?.channel !== "call") continue;

    const mode = (campRaw.call_advance_mode ?? "auto") as "auto" | "manual";
    const staleDays = mode === "manual" ? STALE_DAYS_MANUAL : STALE_DAYS_AUTO;
    const cutoffMs = nowMs - staleDays * 86400000;

    // Fetch the call message at the current step. We want queued (the seller
    // never dialed — or dispatch-call couldn't auto-dial) AND old enough.
    // Skip rows whose eligible_at is still in the future — they're not
    // "stale" yet, they're scheduled.
    const stepNumber = curIdx + 1; // step_number is 1-indexed in campaign_messages
    const { data: msgRows } = await svc
      .from("campaign_messages")
      .select("id, step_number, channel, status, metadata, created_at")
      .eq("campaign_id", campRaw.id)
      .eq("step_number", stepNumber)
      .eq("channel", "call")
      .eq("status", "queued");
    const callMsg = (msgRows ?? [])[0] as MessageRow | undefined;
    if (!callMsg) continue;

    // Use the LATER of created_at and metadata.eligible_at when computing
    // age — a row that was rescheduled forward by deferred_by="business-hours"
    // shouldn't be considered stale before its eligible_at even fires.
    const eligibleAt = (callMsg.metadata as { eligible_at?: string } | null)?.eligible_at;
    const startMs = Math.max(
      new Date(callMsg.created_at).getTime(),
      eligibleAt ? new Date(eligibleAt).getTime() : 0,
    );
    if (startMs > cutoffMs) continue;
    const ageDays = Math.floor((nowMs - startMs) / 86400000);

    // Find the next-step message to advance to. If the call is the last step,
    // there's nothing to advance to — let the campaign complete naturally.
    const nextStepNumber = stepNumber + 1;
    let nextMsgId: string | null = null;
    if (nextStepNumber <= steps.length) {
      const { data: nextRows } = await svc
        .from("campaign_messages")
        .select("id, status")
        .eq("campaign_id", campRaw.id)
        .eq("step_number", nextStepNumber)
        .in("status", ["draft", "queued"])
        .limit(1);
      nextMsgId = (nextRows ?? [])[0]?.id ?? null;
    }

    candidates.push({ campaign: campRaw, callMsg, nextMsgId, staleDays, ageDays, mode });
  }

  // 2. DRY-RUN: report what we'd advance.
  if (!execute) {
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      now: nowISO,
      thresholds: { auto: STALE_DAYS_AUTO, manual: STALE_DAYS_MANUAL },
      candidate_count: candidates.length,
      hint: "Add ?execute=1 to actually skip + advance these campaigns.",
      candidates: candidates.map(c => ({
        campaignId: c.campaign.id,
        leadId: c.campaign.lead_id,
        currentStep: c.campaign.current_step,
        callMsgId: c.callMsg.id,
        nextMsgId: c.nextMsgId,
        mode: c.mode,
        staleThresholdDays: c.staleDays,
        ageDays: c.ageDays,
      })),
    });
  }

  // 3. LIVE: skip + advance each candidate. Per-row atomic — every WHERE
  //    re-asserts the previous status so concurrent dispatchers can't
  //    clobber the transition.
  const advanced: Array<{ campaignId: string; leadId: string; callMsgId: string; nextMsgId: string | null; mode: string }> = [];
  const errors: Array<{ campaignId: string; reason: string }> = [];

  for (const c of candidates) {
    // Mark call as skipped.
    const mergedMeta = {
      ...(c.callMsg.metadata ?? {}),
      skipped_reason: c.mode === "manual" ? "manual_call_window_expired" : "auto_call_window_expired",
      skipped_at: nowISO,
      skipped_by: "cron-skip-stale-calls",
      stale_threshold_days: c.staleDays,
      mode: c.mode,
    };
    const { error: skipErr } = await svc
      .from("campaign_messages")
      .update({ status: "skipped", metadata: mergedMeta })
      .eq("id", c.callMsg.id)
      .eq("status", "queued");
    if (skipErr) {
      errors.push({ campaignId: c.campaign.id, reason: `skip call msg: ${skipErr.message}` });
      continue;
    }

    // Queue the next step's message if it exists. If nextMsgId is null,
    // the call WAS the last step — let dispatcher / completer handle it.
    if (c.nextMsgId) {
      const { error: nextErr } = await svc
        .from("campaign_messages")
        .update({
          status: "queued",
          metadata: { eligible_at: nowISO, queued_by: "cron-skip-stale-calls" },
        })
        .eq("id", c.nextMsgId)
        .in("status", ["draft", "queued"]);
      if (nextErr) {
        errors.push({ campaignId: c.campaign.id, reason: `queue next msg: ${nextErr.message}` });
        continue;
      }
    }

    // Advance the campaign cursor. Re-assert previous current_step to avoid
    // racing with a parallel advance from dispatch-call / dispatch-email.
    const newCursor = (c.campaign.current_step ?? 0) + 1;
    const { error: campErr } = await svc
      .from("campaigns")
      .update({ current_step: newCursor, last_step_at: nowISO })
      .eq("id", c.campaign.id)
      .eq("current_step", c.campaign.current_step ?? 0);
    if (campErr) {
      errors.push({ campaignId: c.campaign.id, reason: `campaign advance: ${campErr.message}` });
      continue;
    }

    advanced.push({
      campaignId: c.campaign.id,
      leadId: c.campaign.lead_id,
      callMsgId: c.callMsg.id,
      nextMsgId: c.nextMsgId,
      mode: c.mode,
    });
  }

  return NextResponse.json({
    ok: true,
    mode: "execute",
    now: nowISO,
    thresholds: { auto: STALE_DAYS_AUTO, manual: STALE_DAYS_MANUAL },
    advanced_count: advanced.length,
    error_count: errors.length,
    advanced,
    errors,
  });
}
