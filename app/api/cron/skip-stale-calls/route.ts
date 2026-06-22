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

// This cron scans every active campaign + their call messages. With 1500+
// active campaigns the per-campaign round-trips overran the default function
// budget and the run never completed (stale calls then piled up for weeks).
// Give it the full window.
export const maxDuration = 60;

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

  // 1. Pull EVERY active, non-archived campaign — paginated. PostgREST caps a
  //    plain select at 1000 rows, so a single .select() silently dropped the
  //    ~500 campaigns past the cap (they were never evaluated). Loop in pages.
  const campaigns: CampaignRow[] = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await svc
        .from("campaigns")
        .select("id, lead_id, current_step, call_advance_mode, sequence_steps")
        .eq("status", "active")
        .is("archived_at", null)
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as CampaignRow[];
      campaigns.push(...rows);
      if (rows.length < PAGE) break;
    }
  }

  // 2. Keep only campaigns sitting ON a call step (channel lives in jsonb, so
  //    we resolve it in JS). This is cheap and prunes the set before any DB
  //    round-trips.
  const onCall = campaigns.filter(c => {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    return steps[c.current_step ?? 0]?.channel === "call";
  });

  // Small helper: chunk an id list so the `in.(…)` query strings stay short.
  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // 2b. Skip leads that already replied via an inbound message (any channel
  //     other than 'call'). A reply stops the flow — the seller takes over,
  //     so we must NOT advance the cursor (that would queue a step the
  //     dispatcher's reply-guard will never send, leaving the campaign in a
  //     misleading half-advanced state). A 'call'-channel lead_reply is the
  //     seller's own follow-up outcome and does NOT count as engagement.
  const repliedLeadIds = new Set<string>();
  {
    const leadIds = [...new Set(onCall.map(c => c.lead_id).filter(Boolean))] as string[];
    for (const ids of chunk(leadIds, 100)) {
      const { data } = await svc
        .from("lead_replies")
        .select("lead_id, channel")
        .in("lead_id", ids)
        .neq("channel", "call");
      for (const r of (data ?? []) as { lead_id: string }[]) repliedLeadIds.add(r.lead_id);
    }
  }

  // 3. BULK-fetch the queued call messages for those campaigns in a handful of
  //    chunked queries instead of one query PER campaign (the old hot loop did
  //    ~900 sequential round-trips and timed out). Index by campaign_id.
  // Store ALL queued calls per campaign (not just the lowest). Picking the
  // lowest was a latent bug: a leftover "zombie" queued call at an earlier
  // step (eg one stamped with a skipped_reason but whose status never flipped
  // to 'skipped') would shadow the real current-step call, the
  // step_number-match below would fail, and the campaign would never advance —
  // frozen in /queue "To Call" for weeks. We now look up the call at exactly
  // current_step+1 regardless of any lower zombies.
  const callMsgsByCampaign = new Map<string, MessageRow[]>();
  for (const ids of chunk(onCall.map(c => c.id), 100)) {
    const { data } = await svc
      .from("campaign_messages")
      .select("id, campaign_id, step_number, channel, status, metadata, created_at")
      .in("campaign_id", ids)
      .eq("channel", "call")
      .eq("status", "queued");
    for (const m of (data ?? []) as (MessageRow & { campaign_id: string })[]) {
      const arr = callMsgsByCampaign.get(m.campaign_id) ?? [];
      arr.push(m);
      callMsgsByCampaign.set(m.campaign_id, arr);
    }
  }

  type Candidate = {
    campaign: CampaignRow;
    callMsg: MessageRow;
    nextMsgId: string | null;
    staleDays: number;
    ageDays: number;
    mode: "auto" | "manual";
  };

  // 4. Build stale candidates (still no per-campaign DB calls). For each, note
  //    the next step number we'd want to advance to.
  const prelim: Array<{ c: Candidate; nextStepNumber: number | null }> = [];
  for (const campRaw of onCall) {
    // A replied lead's flow is stopped — never advance it (see 2b).
    if (campRaw.lead_id && repliedLeadIds.has(campRaw.lead_id)) continue;
    const steps = Array.isArray(campRaw.sequence_steps) ? campRaw.sequence_steps : [];
    const curIdx = campRaw.current_step ?? 0;
    const stepNumber = curIdx + 1; // step_number is 1-indexed in campaign_messages
    // Find the queued call at exactly the current step (current_step+1),
    // ignoring any lower zombie queued calls that would otherwise block us.
    const callMsg = (callMsgsByCampaign.get(campRaw.id) ?? []).find(m => m.step_number === stepNumber);
    if (!callMsg) continue;

    const mode = (campRaw.call_advance_mode ?? "auto") as "auto" | "manual";
    const staleDays = mode === "manual" ? STALE_DAYS_MANUAL : STALE_DAYS_AUTO;
    const cutoffMs = nowMs - staleDays * 86400000;

    // Use the LATER of created_at and metadata.eligible_at — a row rescheduled
    // forward by deferred_by="business-hours" isn't stale before its eligible_at.
    const eligibleAt = (callMsg.metadata as { eligible_at?: string } | null)?.eligible_at;
    const startMs = Math.max(
      new Date(callMsg.created_at).getTime(),
      eligibleAt ? new Date(eligibleAt).getTime() : 0,
    );
    if (startMs > cutoffMs) continue;
    const ageDays = Math.floor((nowMs - startMs) / 86400000);

    const nextStepNumber = stepNumber + 1 <= steps.length ? stepNumber + 1 : null;
    prelim.push({
      c: { campaign: campRaw, callMsg, nextMsgId: null, staleDays, ageDays, mode },
      nextStepNumber,
    });
  }

  // 5. BULK-resolve the next-step message id for all candidates at once. Fetch
  //    every draft/queued message for the candidate campaigns, index by
  //    (campaign_id, step_number), then attach.
  const advanceable = prelim.filter(p => p.nextStepNumber !== null);
  const nextMsgByKey = new Map<string, string>();
  for (const ids of chunk(advanceable.map(p => p.c.campaign.id), 100)) {
    const { data } = await svc
      .from("campaign_messages")
      .select("id, campaign_id, step_number, status")
      .in("campaign_id", ids)
      .in("status", ["draft", "queued"]);
    for (const m of (data ?? []) as { id: string; campaign_id: string; step_number: number }[]) {
      nextMsgByKey.set(`${m.campaign_id}:${m.step_number}`, m.id);
    }
  }

  const candidates: Candidate[] = prelim.map(({ c, nextStepNumber }) => ({
    ...c,
    nextMsgId: nextStepNumber !== null ? nextMsgByKey.get(`${c.campaign.id}:${nextStepNumber}`) ?? null : null,
  }));

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
