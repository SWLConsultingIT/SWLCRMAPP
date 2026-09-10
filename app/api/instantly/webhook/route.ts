// Instantly webhook — the canonical inbound path for email_bounced and
// lead_unsubscribed.
//
// ── Why this route was dead for four months ────────────────────────────────
// The handler shipped 2026-05 and never received a single event. Two
// independent reasons, both found in the 2026-09-10 preflight:
//
//   1. proxy.ts (Next 16 renamed middleware → proxy) lists /api/aircall/webhook
//      and /api/unipile/webhook in PUBLIC_PATHS but not this one, so every
//      delivery got 307 → /login before reaching the handler.
//   2. The three webhooks registered in the SWL Instantly workspace all point at
//      n8n .../webhook/instantly-reply, which belongs to workflow
//      01GMkMI1Yee3P55y — inactive. Two of the three had already been disabled
//      by Instantly after repeated errors (status -1).
//
// Combined with the n8n Bounce Handler polling the tenant TEMPLATE campaign
// instead of the per-flow clones where every real send has lived since
// 2026-06-02, the platform had NO working bounce or unsubscribe path at all,
// for any tenant. Three SWL campaigns sat bounce-paused in Instantly as a
// direct result.
//
// ── Authentication ─────────────────────────────────────────────────────────
// Public here means "no Growth Engine session", never "no auth". Instantly's
// webhook object exposes only target_hook_url — no custom headers, no signing
// secret (verified against GET /api/v2/webhooks) — so the shared secret travels
// in the URL by default. See lib/instantly-webhook-logic.ts for the full
// rationale and the accepted forms. Authorization is fail-closed: an unset
// secret refuses the request instead of processing it.
//
// ── Tenant safety ──────────────────────────────────────────────────────────
// The old handler did `ilike primary_work_email` and mutated EVERY matching
// lead in EVERY tenant. With SWL, Arqy and Grupo IEB now sharing one Instantly
// workspace that is a cross-tenant write primitive. Resolution is now strongest
// -first and always narrowed to a single tenant; an ambiguous address with no
// tenant hint is refused rather than guessed.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import {
  authorizeInstantlyWebhook,
  normalizeInstantlyEvent,
  planBounceLeadUpdate,
  planUnsubscribeActions,
  shouldInsertReply,
  decideEmailOnlyMatch,
  type NormalizedInstantlyEvent,
} from "@/lib/instantly-webhook-logic";

export const dynamic = "force-dynamic";

type Svc = ReturnType<typeof getSupabaseService>;

type ResolvedTarget = {
  leadId: string;
  companyBioId: string | null;
  campaignId: string | null;
  campaignMessageId: string | null;
  /** How we got here — surfaced in the response and the log for traceability. */
  via: "provider_lead_id" | "campaign_scoped_email" | "unique_email";
};

function log(payload: Record<string, unknown>) {
  // Stable prefix so these are greppable in Vercel logs. Never log the secret,
  // the payload verbatim, or lead PII beyond the address we were already sent.
  console.log(`[instantly-webhook] ${JSON.stringify(payload)}`);
}

/**
 * Map an Instantly campaign UUID to the tenant that owns it. Checks the per-flow
 * mapping table first (where every campaign created since 2026-06-02 lives),
 * then the tenant template column.
 */
async function tenantForInstantlyCampaign(svc: Svc, instantlyCampaignId: string): Promise<string | null> {
  const { data: flowRow } = await svc
    .from("instantly_flow_campaigns")
    .select("company_bio_id")
    .eq("instantly_campaign_id", instantlyCampaignId)
    .maybeSingle();
  if ((flowRow as { company_bio_id?: string } | null)?.company_bio_id) {
    return (flowRow as { company_bio_id: string }).company_bio_id;
  }
  const { data: bioRow } = await svc
    .from("company_bios")
    .select("id")
    .eq("instantly_campaign_id", instantlyCampaignId)
    .maybeSingle();
  return (bioRow as { id?: string } | null)?.id ?? null;
}

/**
 * Resolve the event onto exactly one lead, or nothing.
 *
 * Order matters — strongest identification first, as required for bounce:
 *
 *   1. providerLeadId → campaign_messages.provider_message_id. dispatch-email
 *      stores Instantly's LEAD id there, so this is an exact join onto the very
 *      message that bounced, and it carries campaign + lead + tenant with it.
 *   2. campaignId → owning tenant → match the address inside that tenant only.
 *   3. address alone, and ONLY when it is unique across all tenants.
 *
 * Step 3 deliberately refuses ambiguity instead of updating every match. Today
 * exactly one address (japaricio@arengy.com.ar) exists under two tenants; before
 * this change a bounce for it would have written to both.
 */
async function resolveTarget(svc: Svc, event: NormalizedInstantlyEvent): Promise<
  { ok: true; target: ResolvedTarget } | { ok: false; reason: string; ambiguous?: boolean }
> {
  // 1 — strong: Instantly lead id recorded at send time.
  if (event.providerLeadId) {
    const { data: msg } = await svc
      .from("campaign_messages")
      .select("id, campaign_id, lead_id")
      .eq("provider_message_id", event.providerLeadId)
      .eq("channel", "email")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = msg as { id: string; campaign_id: string; lead_id: string } | null;
    if (row?.lead_id) {
      const { data: lead } = await svc
        .from("leads").select("company_bio_id").eq("id", row.lead_id).maybeSingle();
      return {
        ok: true,
        target: {
          leadId: row.lead_id,
          companyBioId: (lead as { company_bio_id?: string } | null)?.company_bio_id ?? null,
          campaignId: row.campaign_id,
          campaignMessageId: row.id,
          via: "provider_lead_id",
        },
      };
    }
  }

  if (!event.email) return { ok: false, reason: "no lead id and no email on payload" };

  // 2 — campaign gives us the tenant; match the address inside it.
  if (event.campaignId) {
    const bioId = await tenantForInstantlyCampaign(svc, event.campaignId);
    if (bioId) {
      const { data: leads } = await svc
        .from("leads")
        .select("id")
        .eq("company_bio_id", bioId)
        .ilike("primary_work_email", event.email)
        .limit(2);
      const rows = (leads ?? []) as { id: string }[];
      if (rows.length === 1) {
        return {
          ok: true,
          target: { leadId: rows[0].id, companyBioId: bioId, campaignId: null, campaignMessageId: null, via: "campaign_scoped_email" },
        };
      }
      if (rows.length > 1) {
        return { ok: false, reason: `address appears on ${rows.length} leads within one tenant`, ambiguous: true };
      }
    }
  }

  // 3 — address alone, only if globally unique.
  const { data: anyLeads } = await svc
    .from("leads")
    .select("id, company_bio_id")
    .ilike("primary_work_email", event.email)
    .limit(5);
  const matches = (anyLeads ?? []) as { id: string; company_bio_id: string | null }[];
  const decision = decideEmailOnlyMatch(matches);
  if (!decision.ok) return { ok: false, reason: decision.reason, ambiguous: decision.ambiguous };
  return {
    ok: true,
    target: { leadId: decision.leadId, companyBioId: decision.companyBioId, campaignId: null, campaignMessageId: null, via: "unique_email" },
  };
}

export async function POST(req: NextRequest) {
  const auth = authorizeInstantlyWebhook({
    secret: process.env.INSTANTLY_WEBHOOK_SECRET,
    isProduction: (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production",
    allowInsecure: process.env.INSTANTLY_WEBHOOK_ALLOW_INSECURE === "1",
    authorizationHeader: req.headers.get("authorization"),
    secretHeader: req.headers.get("x-webhook-secret"),
    queryToken: req.nextUrl.searchParams.get("token"),
  });
  if (!auth.ok) {
    log({ outcome: "rejected", status: auth.status, reason: auth.reason });
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const payload = await req.json().catch(() => ({}));
  const event = normalizeInstantlyEvent(payload);

  if (event.kind === "unknown") {
    // Log the SHAPE, never the values — enough to extend the mapping when
    // Instantly sends something we do not model yet, without spilling lead data.
    const keys = payload && typeof payload === "object" ? Object.keys(payload as object).sort() : [];
    log({ outcome: "ignored", reason: "unhandled event", raw_event: event.rawEvent || "(none)", payload_keys: keys });
    return NextResponse.json({ ignored: `unhandled event: ${event.rawEvent || "(none)"}` });
  }

  const svc = getSupabaseService();
  const resolved = await resolveTarget(svc, event);
  if (!resolved.ok) {
    log({ outcome: "unresolved", kind: event.kind, raw_event: event.rawEvent, reason: resolved.reason, ambiguous: !!resolved.ambiguous });
    // 200 on purpose: the delivery was well-formed and authenticated, we simply
    // have nothing to act on. A non-2xx would make Instantly retry forever and
    // eventually disable the webhook — which is exactly how the previous three
    // ended up in status -1.
    return NextResponse.json({ ignored: resolved.reason, ambiguous: !!resolved.ambiguous });
  }

  const target = resolved.target;
  if (event.kind === "bounce") return await handleBounce(svc, event, target);
  if (event.kind === "unsubscribe") return await handleUnsubscribe(svc, event, target);
  return await handleReply(svc, event, target);
}

export async function GET() {
  // Unauthenticated liveness probe. Returns no data, only proves the route is
  // reachable — the check that would have caught the proxy.ts omission.
  return NextResponse.json({
    ok: true,
    service: "instantly-webhook",
    secretConfigured: (process.env.INSTANTLY_WEBHOOK_SECRET ?? "").trim().length > 0,
    handles: ["email_bounced", "lead_unsubscribed", "reply_received"],
  });
}

// ── Bounce ─────────────────────────────────────────────────────────────────

async function handleBounce(svc: Svc, event: NormalizedInstantlyEvent, target: ResolvedTarget) {
  const { data: lead } = await svc
    .from("leads").select("id, primary_email_status").eq("id", target.leadId).maybeSingle();
  if (!lead) return NextResponse.json({ ignored: "lead vanished between resolve and write" });

  const plan = planBounceLeadUpdate(lead as { primary_email_status: string | null });
  let leadUpdated = false;
  if (plan.needsUpdate && plan.patch) {
    await svc.from("leads")
      .update({ ...plan.patch, updated_at: new Date().toISOString() })
      .eq("id", target.leadId);
    leadUpdated = true;
  }

  // Stop any email step still waiting for this lead. Scoped to the lead, so it
  // can never touch another tenant. Filtering on status='queued' makes the write
  // naturally idempotent — a redelivery matches zero rows the second time.
  const { data: skipped } = await svc
    .from("campaign_messages")
    .update({ status: "skipped", error_details: `email bounced (instantly webhook: ${event.rawEvent})` })
    .eq("lead_id", target.leadId)
    .eq("channel", "email")
    .eq("status", "queued")
    .select("id");

  const result = {
    ok: true,
    kind: "bounce",
    via: target.via,
    leadUpdated,
    idempotent: !plan.needsUpdate,
    stepsSkipped: skipped?.length ?? 0,
  };
  log({ outcome: "handled", ...result, lead_id: target.leadId, tenant: target.companyBioId, raw_event: event.rawEvent });
  return NextResponse.json(result);
}

// ── Unsubscribe ────────────────────────────────────────────────────────────

async function handleUnsubscribe(svc: Svc, event: NormalizedInstantlyEvent, target: ResolvedTarget) {
  const { data: existing } = await svc
    .from("lead_suppressions")
    .select("id")
    .eq("lead_id", target.leadId)
    .eq("channel", "email")
    .eq("reason", "unsubscribed")
    .eq("active", true)
    .limit(1);

  const plan = planUnsubscribeActions({ hasActiveEmailSuppression: (existing?.length ?? 0) > 0 });

  let suppressionAdded = false;
  if (plan.insertSuppression) {
    const { error } = await svc.from("lead_suppressions").insert({
      lead_id: target.leadId,
      channel: "email",
      reason: "unsubscribed",
      source: "instantly-webhook",
      active: true,
    });
    suppressionAdded = !error;
  }

  // Note what we deliberately do NOT do: primary_email_status stays untouched.
  // The old handler set it to 'bounced' because nothing consumed
  // lead_suppressions, which both lied about the address and polluted email
  // verification stats. dispatch-email now reads suppressions directly.
  const { data: skipped } = await svc
    .from("campaign_messages")
    .update({ status: "skipped", error_details: `email unsubscribed (instantly webhook: ${event.rawEvent})` })
    .eq("lead_id", target.leadId)
    .eq("channel", "email")
    .eq("status", "queued")
    .select("id");

  const result = {
    ok: true,
    kind: "unsubscribe",
    via: target.via,
    suppressionAdded,
    idempotent: !plan.insertSuppression,
    stepsSkipped: skipped?.length ?? 0,
  };
  log({ outcome: "handled", ...result, lead_id: target.leadId, tenant: target.companyBioId, raw_event: event.rawEvent });
  return NextResponse.json(result);
}

// ── Reply ──────────────────────────────────────────────────────────────────

/**
 * Replies are OFF by default, and that is a deliberate call, not an oversight.
 *
 * The n8n Reply Handler (EartyXv9hlVVFqvt, every 5 min) does more than store a
 * reply: it classifies with AI and sends the auto-reply on positive/negative. It
 * skips anything whose Instantly email id already sits in
 * lead_replies.provider_thread_id.
 *
 * So a webhook that inserted the row first — seconds after the reply, versus up
 * to five minutes for the poller — would win every race and permanently
 * downgrade every email reply to unclassified manual review, silently killing
 * the auto-reply path. Faster ingestion is not worth that.
 *
 * With the flag off we still log the event, which is genuinely useful: it proves
 * reply_received delivery works end-to-end without touching the pipeline.
 *
 * Turning INSTANTLY_WEBHOOK_REPLIES=1 on only makes sense together with moving
 * classification out of the poller. When it is on, the dedupe below keeps the
 * webhook and both pollers converged on a single row.
 */
async function handleReply(svc: Svc, event: NormalizedInstantlyEvent, target: ResolvedTarget) {
  if (process.env.INSTANTLY_WEBHOOK_REPLIES !== "1") {
    log({
      outcome: "observed", kind: "reply", via: target.via, lead_id: target.leadId,
      tenant: target.companyBioId, has_message_id: !!event.messageId,
      reason: "reply ingestion disabled — n8n Reply Handler owns classification + auto-reply",
    });
    return NextResponse.json({ ok: true, kind: "reply", stored: false, reason: "delegated to n8n Reply Handler" });
  }

  const { data: existing } = await svc
    .from("lead_replies")
    .select("provider_thread_id, reply_text")
    .eq("lead_id", target.leadId)
    .eq("channel", "email")
    .limit(80);
  const rows = (existing ?? []) as { provider_thread_id: string | null; reply_text: string | null }[];

  const decision = shouldInsertReply({
    event,
    existingThreadIds: rows.map((r) => r.provider_thread_id),
    existingTextPrefixes: rows.map((r) => (r.reply_text ?? "").slice(0, 60)),
  });
  if (!decision.insert) {
    log({ outcome: "skipped", kind: "reply", lead_id: target.leadId, reason: decision.reason });
    return NextResponse.json({ ok: true, kind: "reply", stored: false, reason: decision.reason });
  }

  // classification stays manual — the always-use-n8n-for-AI law means this route
  // must never call a model. needs_info + pending puts it in the seller's queue.
  const { error } = await svc.from("lead_replies").insert({
    lead_id: target.leadId,
    campaign_id: target.campaignId,
    company_bio_id: target.companyBioId,
    channel: "email",
    provider_thread_id: decision.dedupKey,
    reply_text: event.text.slice(0, 2000),
    classification: "needs_info",
    received_at: event.timestamp ?? new Date().toISOString(),
    requires_human_review: true,
    review_status: "pending",
    metadata: { source: "instantly-webhook", raw_event: event.rawEvent, subject: event.subject || null },
  });

  const result = { ok: true, kind: "reply", stored: !error, dedupKey: decision.dedupKey };
  log({ outcome: "handled", ...result, lead_id: target.leadId, tenant: target.companyBioId });
  return NextResponse.json(result);
}
