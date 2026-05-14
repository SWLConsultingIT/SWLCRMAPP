// Auto-skip stale manual call steps.
//
// Design rule (Fran 2026-05-14): the FIRST step of a call/email campaign is
// a manual call. The seller has 3 days to make it. If 3 days pass without
// a call, skip step 1 (call) and advance to step 2 (email) so the campaign
// keeps moving instead of sitting in /queue forever.
//
// Why we need a dedicated cron: dispatch-call only acts on
// status='queued' rows. Manual call steps are seeded as 'draft' (so the
// dispatcher doesn't auto-dial them). Nothing else advances them. The
// "Overdue" labels in /queue are purely visual — no action is taken.
//
// Selection rule:
//   - campaigns.status='active' AND campaigns.archived_at IS NULL
//   - campaigns.current_step = 0 (step 1 not yet done)
//   - campaigns.created_at < now() - STALE_DAYS
//   - sequence_steps[0].channel = 'call'
//   - has a step 2 message in 'draft' channel='email' to advance to
//   - has NO matching 'sent' / 'answered' call row (= seller never called)
//
// Safety:
//   - DRY-RUN by default. Returns the rows that WOULD be advanced, no DB
//     write. Add `?execute=1` to actually flip them. Use this to validate
//     the first run's selection before going live, per
//     feedback_live_clients_safety.md.
//   - Each row is updated independently (no batch UPDATE) so a single bad
//     row can't roll back the others.
//   - We also re-check campaigns.current_step=0 in the UPDATE WHERE clause
//     so concurrent dispatchers can't have advanced it between SELECT and
//     UPDATE.
//
// Auth: same Bearer CRON_SECRET pattern as other crons. Wire into the n8n
// Orquestador on a daily schedule.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const CRON_SECRET = process.env.CRON_SECRET;
const STALE_DAYS = 3;

type CampaignRow = {
  id: string;
  lead_id: string;
  current_step: number | null;
  created_at: string;
  sequence_steps: Array<{ channel?: string; daysAfter?: number }> | null;
};

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const execute = req.nextUrl.searchParams.get("execute") === "1";
  const svc = getSupabaseService();
  const cutoffISO = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const nowISO = new Date().toISOString();

  // 1. Pull candidate campaigns: active, never-advanced, older than cutoff.
  const { data: candidates, error: fetchErr } = await svc
    .from("campaigns")
    .select("id, lead_id, current_step, created_at, sequence_steps")
    .eq("status", "active")
    .is("archived_at", null)
    .eq("current_step", 0)
    .lt("created_at", cutoffISO);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  // 2. Filter to: first step is 'call' AND has a step 2 'email' in draft.
  //    We deliberately do this in JS instead of SQL because sequence_steps
  //    is jsonb and we need to inspect index [0].channel.
  const candidatesAsArr = (candidates ?? []) as CampaignRow[];
  const eligible: Array<{ campaign: CampaignRow; step2MsgId: string }> = [];

  for (const camp of candidatesAsArr) {
    const steps = Array.isArray(camp.sequence_steps) ? camp.sequence_steps : [];
    if (steps[0]?.channel !== "call") continue;

    // Confirm a step 2 email draft exists to advance to. If not, the
    // campaign is malformed — don't touch it, surface it for review.
    const { data: step2 } = await svc
      .from("campaign_messages")
      .select("id")
      .eq("campaign_id", camp.id)
      .eq("step_number", 2)
      .eq("channel", "email")
      .eq("status", "draft")
      .maybeSingle();

    if (!step2?.id) continue;

    eligible.push({ campaign: camp, step2MsgId: step2.id });
  }

  // 3. DRY-RUN path: report what we'd advance without writing.
  if (!execute) {
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      cutoff: cutoffISO,
      candidates_total: candidatesAsArr.length,
      eligible_count: eligible.length,
      hint: "Add ?execute=1 to actually advance these campaigns.",
      eligible: eligible.map(({ campaign, step2MsgId }) => ({
        campaignId: campaign.id,
        leadId: campaign.lead_id,
        createdAt: campaign.created_at,
        ageDays: Math.floor((Date.now() - new Date(campaign.created_at).getTime()) / 86400000),
        step2MsgId,
      })),
    });
  }

  // 4. LIVE path: per-row update, re-check current_step=0 atomically.
  const advanced: Array<{ campaignId: string; leadId: string; step2MsgId: string }> = [];
  const errors: Array<{ campaignId: string; reason: string }> = [];

  for (const { campaign, step2MsgId } of eligible) {
    // Mark step 1 (call) as skipped — preserve any prior metadata.
    const { data: step1Rows, error: step1Err } = await svc
      .from("campaign_messages")
      .select("id, metadata")
      .eq("campaign_id", campaign.id)
      .eq("step_number", 1)
      .eq("channel", "call")
      .eq("status", "draft");

    if (step1Err) {
      errors.push({ campaignId: campaign.id, reason: `step1 fetch: ${step1Err.message}` });
      continue;
    }

    for (const s1 of step1Rows ?? []) {
      const mergedMeta = {
        ...((s1.metadata as Record<string, unknown> | null) ?? {}),
        skipped_reason: "manual_call_window_expired",
        skipped_at: nowISO,
        skipped_by: "cron-skip-stale-calls",
        stale_threshold_days: STALE_DAYS,
      };
      await svc
        .from("campaign_messages")
        .update({ status: "skipped", metadata: mergedMeta })
        .eq("id", s1.id)
        .eq("status", "draft");
    }

    // Queue the email step 2 atomically (re-check status=draft).
    const eligibleAt = nowISO;
    const { data: step2Update, error: step2Err } = await svc
      .from("campaign_messages")
      .update({
        status: "queued",
        metadata: { eligible_at: eligibleAt, queued_by: "cron-skip-stale-calls" },
      })
      .eq("id", step2MsgId)
      .eq("status", "draft")
      .select("id");

    if (step2Err || !step2Update || step2Update.length === 0) {
      errors.push({ campaignId: campaign.id, reason: `step2 queue: ${step2Err?.message ?? "lost race"}` });
      continue;
    }

    // Advance the campaign cursor. Re-check current_step=0 so a concurrent
    // path advancing it doesn't get clobbered.
    const { error: campErr } = await svc
      .from("campaigns")
      .update({ current_step: 1, last_step_at: nowISO })
      .eq("id", campaign.id)
      .eq("current_step", 0);

    if (campErr) {
      errors.push({ campaignId: campaign.id, reason: `campaign advance: ${campErr.message}` });
      continue;
    }

    advanced.push({ campaignId: campaign.id, leadId: campaign.lead_id, step2MsgId });
  }

  return NextResponse.json({
    ok: true,
    mode: "execute",
    cutoff: cutoffISO,
    advanced_count: advanced.length,
    error_count: errors.length,
    advanced,
    errors,
  });
}
