// Instantly webhook handler — receives `email_bounced`, `email_invalid`, and
// `email_unsubscribed` events and stops the email track for that lead.
//
// Pre-this-route, Instantly told us about bounces and unsubscribes via webhook
// but nothing was listening. Leads that bounced kept receiving follow-ups
// because `dispatch-email` doesn't filter by suppression — only by
// `leads.primary_email_status`. This handler writes that column so the
// dispatcher's existing skip-on-bad-status logic kicks in (see
// dispatch-email/route.ts:289-292).
//
// Configure in Instantly: Settings → Webhooks → Add destination
//   URL: https://<host>/api/instantly/webhook
//   Events: email_bounced, email_invalid, email_unsubscribed, email_replied_unsubscribe
//   Custom header (optional but recommended once configured):
//     Authorization: Bearer <INSTANTLY_WEBHOOK_SECRET>
//
// Auth: Bearer match against INSTANTLY_WEBHOOK_SECRET when set. Log-only
// when unset (Aircall pattern) so deploying this code doesn't break the
// channel the moment it ships. Set the env var + dashboard header to
// activate enforcement.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const WEBHOOK_SECRET = process.env.INSTANTLY_WEBHOOK_SECRET ?? "";

type InstantlyEvent = {
  event_type?: string;
  event?: string; // some payload shapes use `event`
  lead_email?: string;
  email?: string;
  campaign_id?: string;
  timestamp?: string | number;
};

const BOUNCE_EVENTS = new Set([
  "email_bounced", "email_bounce",
  "email_invalid", "email_verification_failed",
  "hard_bounce", "soft_bounce",
]);
const UNSUBSCRIBE_EVENTS = new Set([
  "email_unsubscribed", "unsubscribe", "unsubscribed",
  "email_replied_unsubscribe",
]);

export async function POST(req: NextRequest) {
  if (WEBHOOK_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (presented !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("[instantly-webhook] INSTANTLY_WEBHOOK_SECRET unset — accepting unsigned request");
  }

  const body = (await req.json().catch(() => ({}))) as InstantlyEvent;
  const event = (body.event_type ?? body.event ?? "").toString().toLowerCase().trim();
  const email = (body.lead_email ?? body.email ?? "").toString().toLowerCase().trim();

  if (!event) return NextResponse.json({ ignored: "no event" });
  if (!email) return NextResponse.json({ ignored: "no email" });

  const svc = getSupabaseService();

  // Look up the lead (or leads — same address can sit on more than one tenant)
  // by case-insensitive match on primary_work_email.
  const { data: leads, error: readErr } = await svc
    .from("leads")
    .select("id, company_bio_id, primary_email_status")
    .ilike("primary_work_email", email);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!leads || leads.length === 0) {
    return NextResponse.json({ ignored: `no lead with email ${email}`, event });
  }

  if (BOUNCE_EVENTS.has(event)) {
    return await handleBounce(svc, leads, event);
  }
  if (UNSUBSCRIBE_EVENTS.has(event)) {
    return await handleUnsubscribe(svc, leads, event);
  }
  return NextResponse.json({ ignored: `unhandled event: ${event}` });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "instantly-webhook" });
}

async function handleBounce(
  svc: ReturnType<typeof getSupabaseService>,
  leads: Array<{ id: string; company_bio_id: string | null; primary_email_status: string | null }>,
  event: string,
) {
  const now = new Date().toISOString();
  let leadsUpdated = 0;
  let stepsSkipped = 0;
  for (const lead of leads) {
    // Idempotent: only write if not already bounced/invalid.
    if (lead.primary_email_status !== "bounced" && lead.primary_email_status !== "invalid") {
      await svc.from("leads")
        .update({ primary_email_status: "bounced", updated_at: now })
        .eq("id", lead.id);
      leadsUpdated += 1;
    }
    const { data: skipped } = await svc
      .from("campaign_messages")
      .update({
        status: "skipped",
        error_details: `email bounced (instantly webhook: ${event})`,
      })
      .eq("lead_id", lead.id)
      .eq("channel", "email")
      .eq("status", "queued")
      .select("id");
    stepsSkipped += skipped?.length ?? 0;
  }
  return NextResponse.json({ ok: true, event, leadsUpdated, stepsSkipped });
}

async function handleUnsubscribe(
  svc: ReturnType<typeof getSupabaseService>,
  leads: Array<{ id: string; company_bio_id: string | null; primary_email_status: string | null }>,
  event: string,
) {
  const now = new Date().toISOString();
  let leadsUpdated = 0;
  let stepsSkipped = 0;
  let suppressionsAdded = 0;
  for (const lead of leads) {
    // primary_email_status doesn't have an "unsubscribed" value in current
    // production data (only invalid / catch_all / bounced), but the
    // dispatch-email skip path treats any non-OK status as skip-worthy if we
    // add it here. Sticking with "unsubscribed" + updating the dispatcher
    // separately. For now mark as "bounced" too so existing dispatch-email
    // logic kicks in without a code change required to ship this webhook.
    if (lead.primary_email_status !== "bounced" && lead.primary_email_status !== "invalid") {
      await svc.from("leads")
        .update({ primary_email_status: "bounced", responded: true, updated_at: now })
        .eq("id", lead.id);
      leadsUpdated += 1;
    }

    // Idempotent suppression — check first, insert only if no active row.
    const { data: existing } = await svc
      .from("lead_suppressions")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("channel", "email")
      .eq("reason", "unsubscribed")
      .eq("active", true)
      .limit(1);
    if (!existing || existing.length === 0) {
      await svc.from("lead_suppressions").insert({
        lead_id: lead.id,
        channel: "email",
        reason: "unsubscribed",
        source: "instantly-webhook",
        active: true,
      });
      suppressionsAdded += 1;
    }

    // Skip pending email steps for this lead. Leave LinkedIn / call steps
    // alone — unsubscribe is email-specific, not a full opt-out.
    const { data: skipped } = await svc
      .from("campaign_messages")
      .update({
        status: "skipped",
        error_details: `email unsubscribed (instantly webhook: ${event})`,
      })
      .eq("lead_id", lead.id)
      .eq("channel", "email")
      .eq("status", "queued")
      .select("id");
    stepsSkipped += skipped?.length ?? 0;
  }
  return NextResponse.json({ ok: true, event, leadsUpdated, suppressionsAdded, stepsSkipped });
}
