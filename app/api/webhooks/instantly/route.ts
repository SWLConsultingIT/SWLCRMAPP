// Instantly webhook handler.
//
// Today we only act on `email_bounced` events. The dispatcher used to silently
// burn the step on bounce — the campaign sat at the same step forever waiting
// for a response that would never come, and on Arqy that compounded into a
// 16.8% bounce rate that pushed the campaign into Instantly status=-2 on
// 2026-05-26. On bounce we now:
//   1. mark the campaign_messages row as 'skipped' (with bounce metadata)
//   2. advance the campaign to the next step (matches the post-send happy path)
//   3. flag the lead `primary_email_status='bounced'` so the in-process guard
//      in dispatch-email skips any future email step for this lead in the
//      same flow (see dispatch-email/route.ts skipMessage path)
//
// Reply events keep flowing through the existing n8n webhook
// (EartyXv9hlVVFqvt). Don't double-handle them here.
//
// Auth: Bearer `INSTANTLY_WEBHOOK_SECRET`. Each tenant's Instantly workspace
// configures this in the webhook destination's headers. Mirrors the unipile +
// aircall pattern: if the env var is unset we accept unsigned requests but
// warn loudly so the open channel shows up in ops dashboards.
//
// Matching: Instantly's payload includes `lead_id` (their UUID), which we
// stored in `campaign_messages.provider_message_id` at send time. That's the
// primary join key. We fall back to `email + campaign_id` for older payloads.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const WEBHOOK_SECRET = process.env.INSTANTLY_WEBHOOK_SECRET ?? "";
const DAY_MS = 24 * 60 * 60 * 1000;

type InstantlyPayload = {
  event_type?: string;          // "email_bounced" | "email_replied" | ...
  event?: string;               // some payloads use `event` instead of event_type
  campaign_id?: string;
  lead_id?: string;             // Instantly's lead UUID — our provider_message_id
  lead?: { id?: string; email?: string };
  email?: string;
  bounce_type?: string;         // "hard" | "soft"
  bounce_reason?: string;
  timestamp?: string;
};

function authorized(req: NextRequest): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn("[instantly-webhook] INSTANTLY_WEBHOOK_SECRET unset — accepting unsigned request");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return presented === WEBHOOK_SECRET;
}

function isBounceEvent(p: InstantlyPayload): boolean {
  const t = (p.event_type ?? p.event ?? "").toLowerCase();
  return t === "email_bounced" || t === "lead_bounced" || t === "bounce" || t.endsWith(".bounced");
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: InstantlyPayload;
  try {
    body = (await req.json()) as InstantlyPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Quick ack for non-bounce events so Instantly stops retrying. We don't act
  // on replies / opens / clicks here — replies are handled by the existing n8n
  // route. Returning 200 keeps the webhook destination "healthy" in the
  // Instantly dashboard.
  if (!isBounceEvent(body)) {
    return NextResponse.json({ ok: true, ignored: body.event_type ?? body.event ?? "unknown" });
  }

  const instantlyLeadId = body.lead_id ?? body.lead?.id ?? null;
  const email = (body.email ?? body.lead?.email ?? "").toLowerCase().trim() || null;

  if (!instantlyLeadId && !email) {
    return NextResponse.json({ error: "missing lead_id and email — cannot identify message" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Find the message that produced this bounce. We prefer the Instantly lead
  // UUID (1:1 with our send) and fall back to (email, campaign_id) for older
  // payload shapes. Take the most recent 'sent' row for that lead so a bounce
  // on step 4 doesn't accidentally rewind step 1's bookkeeping.
  let messageRow: {
    id: string;
    campaign_id: string;
    lead_id: string;
    step_number: number;
  } | null = null;

  if (instantlyLeadId) {
    const { data } = await svc.from("campaign_messages")
      .select("id, campaign_id, lead_id, step_number")
      .eq("provider_message_id", instantlyLeadId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    messageRow = (data as any) ?? null;
  }

  // Fallback path — match by lead email + Instantly campaign id. Used when
  // Instantly's payload omits lead_id (older webhook shapes). Resolves the
  // most recent sent email for that lead in the matched campaign.
  if (!messageRow && email) {
    const { data: leadRow } = await svc.from("leads")
      .select("id")
      .ilike("primary_work_email", email)
      .maybeSingle();
    const leadId = (leadRow as any)?.id as string | undefined;
    if (leadId) {
      const { data } = await svc.from("campaign_messages")
        .select("id, campaign_id, lead_id, step_number")
        .eq("lead_id", leadId)
        .eq("channel", "email")
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      messageRow = (data as any) ?? null;
    }
  }

  if (!messageRow) {
    // Not finding the message is not a hard error — the lead may have been
    // imported into Instantly outside our CRM, or the row was archived. We
    // still flag the lead address as bounced if we have it, so the next CRM
    // send to the same lead gets skipped.
    if (email) {
      await svc.from("leads")
        .update({ primary_email_status: "bounced", updated_at: new Date().toISOString() })
        .ilike("primary_work_email", email);
    }
    return NextResponse.json({ ok: true, matched: false });
  }

  // Pull the campaign sequence so we can compute the next step's eligible_at.
  // Same shape as dispatch-email's post-send advance — kept in sync intentionally;
  // if you change the sequence_steps schema, change both.
  const { data: campaign } = await svc.from("campaigns")
    .select("id, sequence_steps")
    .eq("id", messageRow.campaign_id)
    .maybeSingle();
  const sequenceSteps = (campaign as any)?.sequence_steps as Array<{ channel?: string; daysAfter?: number }> | null;
  const nextStepNumber = messageRow.step_number + 1;
  const nextStepConfig = Array.isArray(sequenceSteps) ? sequenceSteps[messageRow.step_number] : null;
  const nextDaysAfter = typeof nextStepConfig?.daysAfter === "number" ? nextStepConfig.daysAfter : null;
  const nextEligibleAt = nextDaysAfter !== null ? new Date(Date.now() + nextDaysAfter * DAY_MS).toISOString() : null;

  const now = new Date().toISOString();
  const bounceReason = body.bounce_reason ?? body.bounce_type ?? "instantly bounce";

  const ops: Array<PromiseLike<unknown>> = [
    // 1) Mark this email message as skipped, not failed — bounce is an
    //    expected outcome we now route through, not an error to retry.
    svc.from("campaign_messages").update({
      status: "skipped",
      error_details: `bounce: ${bounceReason}`,
      metadata: {
        bounced_at: now,
        bounce_reason: bounceReason,
        skipped_by: "instantly-webhook",
      },
    }).eq("id", messageRow.id),

    // 2) Flag the lead so future email steps in this or other flows skip
    //    the same dead address (dispatch-email reads primary_email_status).
    svc.from("leads").update({
      primary_email_status: "bounced",
      updated_at: now,
    }).eq("id", messageRow.lead_id),

    // 3) Advance the campaign — mirrors the dispatch-email post-send block.
    svc.from("campaigns").update({
      current_step: messageRow.step_number,
      last_step_at: now,
      ...(nextEligibleAt === null ? { status: "completed", stop_reason: "all_steps_bounced_or_done" } : {}),
    }).eq("id", messageRow.campaign_id),
  ];

  // 4) Queue the next step's draft row if there is one, so the orchestrator
  //    picks it up on the next tick.
  if (nextEligibleAt) {
    ops.push(
      svc.from("campaign_messages").update({
        status: "queued",
        metadata: { eligible_at: nextEligibleAt, queued_by: "instantly-webhook-bounce-advance" },
      }).eq("campaign_id", messageRow.campaign_id).eq("step_number", nextStepNumber).eq("status", "draft"),
    );
  }

  await Promise.all(ops);

  return NextResponse.json({
    ok: true,
    matched: true,
    advanced_to_step: nextEligibleAt ? nextStepNumber : null,
    campaign_completed: nextEligibleAt === null,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "instantly-webhook" });
}
