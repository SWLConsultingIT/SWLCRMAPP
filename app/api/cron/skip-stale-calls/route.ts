// Auto-skip call steps so the sequence never freezes on a phone step.
//
// TWO reasons a call step gets skipped + advanced here:
//
//   A) UNCALLABLE lead — no phone on file, or allow_call=false (wrong number).
//      The call will NEVER happen, so we skip it IMMEDIATELY (no wait window),
//      exactly like any other channel a lead can't use. Before this, phoneless
//      leads sat frozen at the (often final) call step forever — De Vera Grill
//      had 176 leads stuck for a month (Fran 2026-07-22).
//
//   B) STALE queued call — a CALLABLE lead whose seller never dialed within the
//      window. call_advance_mode only tunes that window:
//        - auto:   STALE_DAYS_AUTO   (the Aircall integration is always manual;
//        - manual: STALE_DAYS_MANUAL  'mode' just controls how long we wait).
//
// When the skipped call is the LAST step, the campaign is marked `completed`
// (nothing left to do) instead of being left 'active' on a dead step.
//
// Selection:
//   - campaigns.status='active' AND archived_at IS NULL
//   - sequence_steps[current_step].channel = 'call'
//   - not replied on a non-call channel (reply stops the flow — seller owns it)
//
// Safety: DRY-RUN by default; add ?execute=1 to flip rows. Per-row UPDATEs
// re-assert the prior status/step so concurrent dispatchers can't clobber.
// Auth: Bearer CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

// Scans every active campaign + call messages; with 1500+ campaigns the
// per-campaign round-trips overran the default budget, so give it the window.
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
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

  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // 1. Pull EVERY active, non-archived campaign — paginated (PostgREST caps a
  //    plain select at 1000 rows).
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

  // 2. Keep only campaigns sitting ON a call step (channel lives in jsonb).
  const onCall = campaigns.filter(c => {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    return steps[c.current_step ?? 0]?.channel === "call";
  });

  // 2b. Skip leads that already replied on a non-call channel — a reply stops
  //     the flow (seller takes over); advancing would queue an unsendable step.
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

  // 2c. Resolve each on-call lead's callability. UNCALLABLE = no phone on file
  //     OR allow_call=false. These skip immediately (reason A above).
  const uncallableCampaign = new Map<string, boolean>();
  {
    const leadIds = [...new Set(onCall.map(c => c.lead_id).filter(Boolean))] as string[];
    const uncallableLead = new Map<string, boolean>();
    for (const ids of chunk(leadIds, 100)) {
      const { data } = await svc
        .from("leads")
        .select("id, primary_phone, primary_secondary_phone, allow_call")
        .in("id", ids);
      for (const l of (data ?? []) as { id: string; primary_phone: string | null; primary_secondary_phone: string | null; allow_call: boolean | null }[]) {
        const hasPhone = !!((l.primary_phone && String(l.primary_phone).trim()) || (l.primary_secondary_phone && String(l.primary_secondary_phone).trim()));
        uncallableLead.set(l.id, !hasPhone || l.allow_call === false);
      }
    }
    // A campaign with no lead_id (shouldn't happen) is treated as uncallable so
    // it doesn't sit frozen either.
    for (const c of onCall) uncallableCampaign.set(c.id, c.lead_id ? (uncallableLead.get(c.lead_id) ?? true) : true);
  }

  // 3. BULK-fetch the current-step call messages. Include `draft` as well as
  //    `queued`: an uncallable lead's call is often still `draft` (nothing ever
  //    queued it) — the old queued-only fetch is exactly why those never got
  //    skipped. Look up the call at exactly current_step+1, ignoring any lower
  //    "zombie" rows.
  const callMsgsByCampaign = new Map<string, MessageRow[]>();
  for (const ids of chunk(onCall.map(c => c.id), 100)) {
    const { data } = await svc
      .from("campaign_messages")
      .select("id, campaign_id, step_number, channel, status, metadata, created_at")
      .in("campaign_id", ids)
      .eq("channel", "call")
      .in("status", ["queued", "draft"]);
    for (const m of (data ?? []) as (MessageRow & { campaign_id: string })[]) {
      const arr = callMsgsByCampaign.get(m.campaign_id) ?? [];
      arr.push(m);
      callMsgsByCampaign.set(m.campaign_id, arr);
    }
  }

  type Candidate = {
    campaign: CampaignRow;
    callMsg: MessageRow | null;
    nextStepNumber: number | null;
    nextMsgId: string | null;
    staleDays: number;
    ageDays: number;
    mode: "auto" | "manual";
    uncallable: boolean;
  };

  // 4. Build candidates.
  const prelim: Candidate[] = [];
  for (const campRaw of onCall) {
    if (campRaw.lead_id && repliedLeadIds.has(campRaw.lead_id)) continue;
    const steps = Array.isArray(campRaw.sequence_steps) ? campRaw.sequence_steps : [];
    const stepNumber = (campRaw.current_step ?? 0) + 1; // 1-indexed in campaign_messages
    const callMsg = (callMsgsByCampaign.get(campRaw.id) ?? []).find(m => m.step_number === stepNumber) ?? null;
    const mode = (campRaw.call_advance_mode ?? "auto") as "auto" | "manual";
    const nextStepNumber = stepNumber + 1 <= steps.length ? stepNumber + 1 : null;
    const uncallable = uncallableCampaign.get(campRaw.id) === true;

    if (uncallable) {
      // Reason A: skip NOW regardless of the call message's status (queued /
      // draft / even missing) and regardless of age.
      prelim.push({ campaign: campRaw, callMsg, nextStepNumber, nextMsgId: null, staleDays: 0, ageDays: 0, mode, uncallable: true });
      continue;
    }

    // Reason B: callable lead — only advance a genuinely STALE queued call.
    if (!callMsg || callMsg.status !== "queued") continue;
    const staleDays = mode === "manual" ? STALE_DAYS_MANUAL : STALE_DAYS_AUTO;
    const cutoffMs = nowMs - staleDays * 86400000;
    const eligibleAt = (callMsg.metadata as { eligible_at?: string } | null)?.eligible_at;
    const startMs = Math.max(
      new Date(callMsg.created_at).getTime(),
      eligibleAt ? new Date(eligibleAt).getTime() : 0,
    );
    if (startMs > cutoffMs) continue;
    const ageDays = Math.floor((nowMs - startMs) / 86400000);
    prelim.push({ campaign: campRaw, callMsg, nextStepNumber, nextMsgId: null, staleDays, ageDays, mode, uncallable: false });
  }

  // 5. BULK-resolve the next-step message id for all advanceable candidates.
  const advanceable = prelim.filter(p => p.nextStepNumber !== null);
  const nextMsgByKey = new Map<string, string>();
  for (const ids of chunk(advanceable.map(p => p.campaign.id), 100)) {
    const { data } = await svc
      .from("campaign_messages")
      .select("id, campaign_id, step_number, status")
      .in("campaign_id", ids)
      .in("status", ["draft", "queued"]);
    for (const m of (data ?? []) as { id: string; campaign_id: string; step_number: number }[]) {
      nextMsgByKey.set(`${m.campaign_id}:${m.step_number}`, m.id);
    }
  }
  const candidates: Candidate[] = prelim.map(c => ({
    ...c,
    nextMsgId: c.nextStepNumber !== null ? nextMsgByKey.get(`${c.campaign.id}:${c.nextStepNumber}`) ?? null : null,
  }));

  // DRY-RUN.
  if (!execute) {
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      now: nowISO,
      thresholds: { auto: STALE_DAYS_AUTO, manual: STALE_DAYS_MANUAL },
      candidate_count: candidates.length,
      uncallable_count: candidates.filter(c => c.uncallable).length,
      stale_count: candidates.filter(c => !c.uncallable).length,
      hint: "Add ?execute=1 to actually skip + advance/complete these campaigns.",
      candidates: candidates.map(c => ({
        campaignId: c.campaign.id,
        leadId: c.campaign.lead_id,
        currentStep: c.campaign.current_step,
        callMsgId: c.callMsg?.id ?? null,
        nextStepNumber: c.nextStepNumber,
        nextMsgId: c.nextMsgId,
        mode: c.mode,
        uncallable: c.uncallable,
        reason: c.uncallable ? "uncallable_no_phone" : (c.mode === "manual" ? "manual_call_window_expired" : "auto_call_window_expired"),
        ageDays: c.ageDays,
      })),
    });
  }

  // LIVE: skip + advance / complete each candidate (per-row atomic).
  const advanced: Array<{ campaignId: string; leadId: string; reason: string; completed: boolean }> = [];
  const errors: Array<{ campaignId: string; reason: string }> = [];

  for (const c of candidates) {
    const reason = c.uncallable
      ? "uncallable_no_phone"
      : c.mode === "manual" ? "manual_call_window_expired" : "auto_call_window_expired";

    // Mark the call message skipped (when one exists).
    if (c.callMsg) {
      const mergedMeta = {
        ...(c.callMsg.metadata ?? {}),
        skipped_reason: reason,
        skipped_at: nowISO,
        skipped_by: "cron-skip-stale-calls",
        uncallable: c.uncallable,
        mode: c.mode,
      };
      const { error: skipErr } = await svc
        .from("campaign_messages")
        .update({ status: "skipped", metadata: mergedMeta })
        .eq("id", c.callMsg.id)
        .in("status", ["queued", "draft"]);
      if (skipErr) { errors.push({ campaignId: c.campaign.id, reason: `skip call msg: ${skipErr.message}` }); continue; }
    }

    if (c.nextStepNumber !== null) {
      // There's a step after the call → queue it and advance the cursor.
      if (c.nextMsgId) {
        const { error: nextErr } = await svc
          .from("campaign_messages")
          .update({ status: "queued", metadata: { eligible_at: nowISO, queued_by: "cron-skip-stale-calls" } })
          .eq("id", c.nextMsgId)
          .in("status", ["draft", "queued"]);
        if (nextErr) { errors.push({ campaignId: c.campaign.id, reason: `queue next msg: ${nextErr.message}` }); continue; }
      }
      const { error: campErr } = await svc
        .from("campaigns")
        .update({ current_step: (c.campaign.current_step ?? 0) + 1, last_step_at: nowISO })
        .eq("id", c.campaign.id)
        .eq("current_step", c.campaign.current_step ?? 0);
      if (campErr) { errors.push({ campaignId: c.campaign.id, reason: `campaign advance: ${campErr.message}` }); continue; }
      advanced.push({ campaignId: c.campaign.id, leadId: c.campaign.lead_id, reason, completed: false });
    } else {
      // Call was the LAST step → nothing left, complete the campaign so it
      // leaves the flow instead of sitting 'active' on a dead call step.
      const { error: campErr } = await svc
        .from("campaigns")
        .update({ status: "completed", current_step: (c.campaign.current_step ?? 0) + 1, last_step_at: nowISO })
        .eq("id", c.campaign.id)
        .eq("status", "active");
      if (campErr) { errors.push({ campaignId: c.campaign.id, reason: `campaign complete: ${campErr.message}` }); continue; }
      advanced.push({ campaignId: c.campaign.id, leadId: c.campaign.lead_id, reason, completed: true });
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "execute",
    now: nowISO,
    thresholds: { auto: STALE_DAYS_AUTO, manual: STALE_DAYS_MANUAL },
    advanced_count: advanced.length,
    completed_count: advanced.filter(a => a.completed).length,
    error_count: errors.length,
    advanced,
    errors,
  });
}
