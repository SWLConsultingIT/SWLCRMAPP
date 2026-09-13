// Pure decision layer for the Instantly webhook. No IO — every function here
// takes plain inputs and returns plain data, so the whole contract is unit
// testable (scripts/test-instantly-webhook.mts) without a database or a network.
//
// The route handler (app/api/instantly/webhook/route.ts) owns all the IO and
// calls into this module for: authorization, payload normalization, and the
// idempotency decisions for each event kind.
//
// ── Why the auth shape is what it is ────────────────────────────────────────
// Instantly's v2 webhook object is:
//   { id, organization, target_hook_url, name, event_type, status, timestamps }
// There is NO field for custom headers and no field for a signing secret, and
// Instantly does not sign its deliveries. Verified against
// GET /api/v2/webhooks on the SWL workspace, 2026-09-10.
//
// So the previous plan — "configure an Authorization header in the Instantly
// dashboard" — is not something the API can express. The only part of the
// delivery we control is the URL. Therefore the shared secret travels as a
// query token by default, with header forms still accepted in case the
// dashboard offers custom headers where the API does not.
//
// A URL token lands in access logs, which a header would not. That is a real
// downside, accepted because the alternative on offer is no authentication at
// all. Mitigations: the token authenticates ONLY this endpoint, it grants no
// read access (the handler acts on the payload, never returns lead data), and
// it is rotatable in two moves (change the env var, re-point three webhooks).

const BOUNCE_EVENTS = new Set([
  "email_bounced", "email_bounce", "bounced",
  "email_invalid", "email_verification_failed",
  "hard_bounce", "soft_bounce",
]);

const UNSUBSCRIBE_EVENTS = new Set([
  "lead_unsubscribed", "email_unsubscribed",
  "unsubscribe", "unsubscribed", "email_replied_unsubscribe",
]);

const REPLY_EVENTS = new Set([
  "reply_received", "email_replied", "lead_replied", "reply",
]);

// ── Authorization ──────────────────────────────────────────────────────────

export type WebhookAuthResult =
  | { ok: true; via: "header_bearer" | "header_secret" | "query_token" | "insecure_dev" }
  | { ok: false; status: 401 | 503; reason: string };

/** Length-independent constant-time compare. Avoids leaking the secret by timing. */
export function secretsMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  // Compare over a fixed span so the loop count does not depend on where the
  // first difference is. Length mismatch still fails, but only after the loop.
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Fail-CLOSED authorization.
 *
 * Previous behaviour (shipped, never actually reachable): when
 * INSTANTLY_WEBHOOK_SECRET was unset the handler logged a warning and PROCESSED
 * the request. Any unauthenticated caller could mark arbitrary leads bounced.
 * That is now a hard refusal.
 *
 *   secret unset          → 503, never process (misconfiguration, not the caller's fault)
 *   secret present, wrong → 401
 *   secret present, right → process
 *
 * The only bypass is an explicit non-production opt-in
 * (INSTANTLY_WEBHOOK_ALLOW_INSECURE=1), which is ignored outright when
 * isProduction is true. There is no silent fallback on any path.
 */
export function authorizeInstantlyWebhook(input: {
  secret: string | null | undefined;
  isProduction: boolean;
  allowInsecure?: boolean;
  authorizationHeader?: string | null;
  secretHeader?: string | null;
  queryToken?: string | null;
}): WebhookAuthResult {
  const secret = (input.secret ?? "").trim();

  if (secret.length === 0) {
    if (!input.isProduction && input.allowInsecure === true) {
      return { ok: true, via: "insecure_dev" };
    }
    return {
      ok: false,
      status: 503,
      reason: "INSTANTLY_WEBHOOK_SECRET is not configured — refusing to process unauthenticated webhook",
    };
  }

  const bearer = (input.authorizationHeader ?? "").startsWith("Bearer ")
    ? (input.authorizationHeader ?? "").slice(7).trim()
    : "";
  if (bearer && secretsMatch(bearer, secret)) return { ok: true, via: "header_bearer" };

  const headerSecret = (input.secretHeader ?? "").trim();
  if (headerSecret && secretsMatch(headerSecret, secret)) return { ok: true, via: "header_secret" };

  const queryToken = (input.queryToken ?? "").trim();
  if (queryToken && secretsMatch(queryToken, secret)) return { ok: true, via: "query_token" };

  return { ok: false, status: 401, reason: "missing or invalid webhook credential" };
}

// ── Payload normalization ──────────────────────────────────────────────────

export type InstantlyEventKind = "bounce" | "unsubscribe" | "reply" | "unknown";

export type NormalizedInstantlyEvent = {
  kind: InstantlyEventKind;
  /** The raw event string, lowercased. Kept for logs and error_details. */
  rawEvent: string;
  /** Lead's address, lowercased. "" when absent. */
  email: string;
  /** Instantly campaign UUID, when the payload carries one. */
  campaignId: string | null;
  /**
   * Instantly's id for the enrolled LEAD. This is what dispatch-email stores in
   * campaign_messages.provider_message_id (see the enrollLead() call there — it
   * saves the lead id, not a message id), so it is our strong join key.
   */
  providerLeadId: string | null;
  /** Instantly's id for the individual email — used to dedupe replies. */
  messageId: string | null;
  threadId: string | null;
  subject: string;
  text: string;
  /** ISO timestamp, or null when the payload has none. */
  timestamp: string | null;
};

function firstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map an Instantly webhook body onto our canonical shape.
 *
 * Instantly's payload field names are not documented consistently and differ
 * between event types, so every field accepts a union of the names seen across
 * their polling API (/emails returns from_address_email, eaccount, body.text,
 * timestamp_email) and the shapes the previous handler already tolerated. An
 * unrecognised event returns kind "unknown" and the caller no-ops — we never
 * guess at an action.
 */
export function normalizeInstantlyEvent(payload: unknown): NormalizedInstantlyEvent {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  const rawEvent = firstString(body, ["event_type", "event", "type", "name"]).toLowerCase();
  const email = firstString(body, [
    "lead_email", "email", "from_address_email", "lead", "recipient", "to_email",
  ]).toLowerCase();

  const campaignId = firstString(body, ["campaign_id", "campaign", "campaignId"]) || null;
  const providerLeadId = firstString(body, ["lead_id", "leadId", "instantly_lead_id"]) || null;
  const messageId = firstString(body, ["email_id", "message_id", "messageId", "id", "uuid"]) || null;
  const threadId = firstString(body, ["thread_id", "threadId"]) || messageId;
  const subject = firstString(body, ["subject", "email_subject"]);

  // Body can be a string, or { text, html }, or arrive as reply_text/preview.
  let text = firstString(body, ["reply_text", "reply_text_snippet", "text", "content_preview"]);
  const rawBody = body["body"];
  if (!text && typeof rawBody === "string") text = rawBody.trim();
  if (!text && rawBody && typeof rawBody === "object") {
    const nested = rawBody as Record<string, unknown>;
    const plain = typeof nested.text === "string" ? nested.text.trim() : "";
    const html = typeof nested.html === "string" ? nested.html : "";
    text = plain || (html ? stripHtml(html) : "");
  }

  const rawTs = firstString(body, ["timestamp_email", "timestamp", "timestamp_created", "created_at", "date"]);
  let timestamp: string | null = null;
  if (rawTs) {
    const parsed = new Date(rawTs);
    if (!Number.isNaN(parsed.getTime())) timestamp = parsed.toISOString();
  }

  let kind: InstantlyEventKind = "unknown";
  if (BOUNCE_EVENTS.has(rawEvent)) kind = "bounce";
  else if (UNSUBSCRIBE_EVENTS.has(rawEvent)) kind = "unsubscribe";
  else if (REPLY_EVENTS.has(rawEvent)) kind = "reply";

  return { kind, rawEvent, email, campaignId, providerLeadId, messageId, threadId, subject, text, timestamp };
}

// ── Bounce ─────────────────────────────────────────────────────────────────

/**
 * What a bounce should change on the lead row, given its current state.
 *
 * The status that actually blocks a future email is
 * `leads.primary_email_status` — dispatch-email skips any lead whose status is
 * in BAD_EMAIL_STATUSES (invalid / bounced / catch_all / accept_all / risky).
 * We write into that existing model rather than inventing a second one.
 *
 * Idempotent: a lead already flagged bounced or invalid needs no write, so a
 * redelivered webhook (Instantly retries) is a no-op.
 */
export function planBounceLeadUpdate(lead: { primary_email_status?: string | null }): {
  needsUpdate: boolean;
  patch: { primary_email_status: string } | null;
} {
  const current = (lead.primary_email_status ?? "").toLowerCase().trim();
  if (current === "bounced" || current === "invalid") {
    return { needsUpdate: false, patch: null };
  }
  return { needsUpdate: true, patch: { primary_email_status: "bounced" } };
}

// ── Unsubscribe ────────────────────────────────────────────────────────────

/**
 * What an unsubscribe should do, given whether an active email suppression
 * already exists for the lead.
 *
 * Scope decision — the product semantics, stated explicitly because the old
 * handler blurred them:
 *
 *   scope   = (lead, channel) — one row in lead_suppressions per lead per channel
 *   tenant  = implied by the lead (lead_suppressions has no company_bio_id; the
 *             RLS policy in migration 031 scopes it through leads), so a
 *             suppression can never leak across tenants
 *   breadth = ALL campaigns of that lead, present and future, because
 *             dispatch-email now consults suppressions by lead_id and not by
 *             campaign. That is what makes "aunque cambie de campaign" true.
 *
 * An unsubscribe is NOT a bounce. The old handler set
 * primary_email_status='bounced' on unsubscribe, because nothing read
 * lead_suppressions and that was the only column with teeth. It also corrupted
 * the data: an unsubscribed address is perfectly valid and would be wrongly
 * excluded from verification stats and re-import checks. Now that dispatch-email
 * reads suppressions, the unsubscribe stops touching primary_email_status.
 */
export function planUnsubscribeActions(input: {
  hasActiveEmailSuppression: boolean;
}): { insertSuppression: boolean; markLeadBounced: false } {
  return {
    insertSuppression: !input.hasActiveEmailSuppression,
    // Explicitly false, and typed as the literal, so a future edit that tries to
    // re-introduce the bounce hack fails typecheck instead of silently shipping.
    markLeadBounced: false,
  };
}

// ── Reply ──────────────────────────────────────────────────────────────────

/**
 * Stable dedupe key for an inbound email reply.
 *
 * Three producers can insert the same reply and must converge on one row:
 *   1. this webhook                             (push, seconds)
 *   2. n8n Reply Handler EartyXv9hlVVFqvt       (poll, 5 min) — dedupes on
 *      lead_replies.provider_thread_id = the Instantly email id
 *   3. /api/cron/recover-replies                (poll, safety net) — dedupes on
 *      lead + first 60 chars of the text
 *
 * The n8n poller already writes Instantly's email `id` into
 * `provider_thread_id`, so using that same id here makes the webhook and the
 * poller mutually idempotent through one column, whichever arrives first. When
 * the payload carries no usable id we do NOT insert — an un-keyed insert is
 * exactly how the same reply ends up in the inbox twice.
 */
export function replyDedupKey(event: NormalizedInstantlyEvent): string | null {
  return event.messageId ?? event.threadId ?? null;
}

export function shouldInsertReply(input: {
  event: NormalizedInstantlyEvent;
  /** provider_thread_id values already stored for this lead + channel. */
  existingThreadIds: (string | null | undefined)[];
  /** First-60-char prefixes already stored, matching recover-replies' dedupe. */
  existingTextPrefixes: string[];
}): { insert: boolean; dedupKey: string | null; reason: string } {
  const dedupKey = replyDedupKey(input.event);
  if (!dedupKey) {
    return { insert: false, dedupKey: null, reason: "no provider message id on payload — refusing to insert an unkeyed reply" };
  }
  const known = new Set(input.existingThreadIds.filter((v): v is string => typeof v === "string" && v.length > 0));
  if (known.has(dedupKey)) {
    return { insert: false, dedupKey, reason: "already stored (provider_thread_id match)" };
  }
  const text = (input.event.text ?? "").trim();
  if (text.length > 0) {
    const prefix = text.slice(0, 60);
    if (input.existingTextPrefixes.some((p) => p === prefix)) {
      // The poller got here first and stored it without an id, or with a
      // different id shape. Same reply — do not duplicate it.
      return { insert: false, dedupKey, reason: "already stored (text-prefix match with poller row)" };
    }
  }
  if (text.length === 0) {
    return { insert: false, dedupKey, reason: "empty reply body" };
  }
  return { insert: true, dedupKey, reason: "new reply" };
}

// ── Tenant safety for address-only matches ─────────────────────────────────

export type EmailMatchDecision =
  | { ok: true; leadId: string; companyBioId: string | null }
  | { ok: false; ambiguous: boolean; reason: string };

/**
 * Decide whether an address-only lookup identifies exactly one lead.
 *
 * This is the guard on the weakest resolution path. The previous handler ran
 * `ilike primary_work_email` and then mutated EVERY row it got back, across
 * every tenant — with one shared Instantly workspace that is a cross-tenant
 * write primitive: a bounce raised by an Arqy campaign would also flag the SWL
 * lead that happens to share the address.
 *
 * Exactly one address is in that state today (japaricio@arengy.com.ar, a lead
 * under both Arqy and SWL), which is precisely why this must refuse rather than
 * pick. Ambiguity is not an error to retry — it is a signal that the payload
 * needed a campaign or lead id and did not have one.
 */
export function decideEmailOnlyMatch(
  matches: Array<{ id: string; company_bio_id: string | null }>,
): EmailMatchDecision {
  if (matches.length === 0) return { ok: false, ambiguous: false, reason: "no lead with that address" };
  const tenants = new Set(matches.map((m) => m.company_bio_id ?? ""));
  if (matches.length > 1 || tenants.size > 1) {
    return {
      ok: false,
      ambiguous: true,
      reason: `address matches ${matches.length} lead(s) across ${tenants.size} tenant(s) and the payload carries no campaign or lead id — refusing to guess`,
    };
  }
  return { ok: true, leadId: matches[0].id, companyBioId: matches[0].company_bio_id };
}
