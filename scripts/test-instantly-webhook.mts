// Unit tests for the Instantly webhook contract. Pure — no DB, no network.
// Run: npx tsx scripts/test-instantly-webhook.mts
//
// Pins the four regressions found in the 2026-09-10 preflight:
//   1. the route was unreachable (proxy.ts PUBLIC_PATHS omitted it)
//   2. auth failed OPEN when INSTANTLY_WEBHOOK_SECRET was unset
//   3. an address-only match mutated leads in every tenant at once
//   4. an unsubscribe was recorded as a bounce, corrupting the address status

import { readFileSync } from "node:fs";
import {
  authorizeInstantlyWebhook,
  normalizeInstantlyEvent,
  planBounceLeadUpdate,
  planUnsubscribeActions,
  shouldInsertReply,
  decideEmailOnlyMatch,
  secretsMatch,
} from "../lib/instantly-webhook-logic.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) { eq(name, !!cond, true); }

const SECRET = "s3cr3t-token-value";

// ── TEST 1 — the route is reachable ────────────────────────────────────────
// Asserts the routing RULE, not just the array: replicates proxy.ts's own
// `PUBLIC_PATHS.some(p => pathname.startsWith(p))` predicate.
console.log("\n1 · route is public to the proxy (no /login redirect)");
{
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("const PUBLIC_PATHS"), src.indexOf("];", src.indexOf("const PUBLIC_PATHS")));
  const publicPaths = Array.from(block.matchAll(/"([^"]+)"/g)).map(m => m[1]);
  const isPublic = (pathname: string) => publicPaths.some(p => pathname.startsWith(p));

  ok("PUBLIC_PATHS contains /api/instantly/webhook", publicPaths.includes("/api/instantly/webhook"));
  ok("POST target is public", isPublic("/api/instantly/webhook"));
  ok("query-token URL is public", isPublic("/api/instantly/webhook"));
  // Guard against an over-broad entry that would expose the whole app.
  ok("did not accidentally make /api public", !publicPaths.includes("/api"));
  ok("an authenticated page is still NOT public", !isPublic("/leads"));
  ok("the admin area is still NOT public", !isPublic("/admin/reliability"));
}

// ── TESTS 2-4 — fail-closed authorization ──────────────────────────────────
console.log("\n2 · correct secret is accepted, in every supported form");
{
  const base = { secret: SECRET, isProduction: true };
  eq("Authorization: Bearer", authorizeInstantlyWebhook({ ...base, authorizationHeader: `Bearer ${SECRET}` }), { ok: true, via: "header_bearer" });
  eq("X-Webhook-Secret", authorizeInstantlyWebhook({ ...base, secretHeader: SECRET }), { ok: true, via: "header_secret" });
  eq("?token= (the only form Instantly can actually send)", authorizeInstantlyWebhook({ ...base, queryToken: SECRET }), { ok: true, via: "query_token" });
  eq("surrounding whitespace tolerated", authorizeInstantlyWebhook({ ...base, queryToken: `  ${SECRET}  ` }), { ok: true, via: "query_token" });
}

console.log("\n3 · wrong or missing credential is rejected");
{
  const base = { secret: SECRET, isProduction: true };
  eq("wrong token → 401", authorizeInstantlyWebhook({ ...base, queryToken: "nope" }).ok, false);
  eq("wrong token status", (authorizeInstantlyWebhook({ ...base, queryToken: "nope" }) as any).status, 401);
  eq("no credential at all → 401", (authorizeInstantlyWebhook({ ...base }) as any).status, 401);
  eq("empty token → 401", (authorizeInstantlyWebhook({ ...base, queryToken: "" }) as any).status, 401);
  eq("Bearer prefix missing → 401", (authorizeInstantlyWebhook({ ...base, authorizationHeader: SECRET }) as any).status, 401);
  eq("prefix of the real secret → 401", (authorizeInstantlyWebhook({ ...base, queryToken: SECRET.slice(0, -1) }) as any).status, 401);
  eq("secret plus suffix → 401", (authorizeInstantlyWebhook({ ...base, queryToken: SECRET + "x" }) as any).status, 401);
  ok("constant-time compare still correct for equal strings", secretsMatch(SECRET, SECRET));
  ok("constant-time compare rejects different lengths", !secretsMatch(SECRET, SECRET + "x"));
}

console.log("\n4 · unset secret FAILS CLOSED (the old behaviour processed the request)");
{
  eq("prod + no secret → 503, not processed",
    authorizeInstantlyWebhook({ secret: undefined, isProduction: true, queryToken: "anything" }),
    { ok: false, status: 503, reason: "INSTANTLY_WEBHOOK_SECRET is not configured — refusing to process unauthenticated webhook" });
  eq("prod + empty secret → 503", (authorizeInstantlyWebhook({ secret: "   ", isProduction: true }) as any).status, 503);
  eq("prod ignores the dev bypass flag",
    (authorizeInstantlyWebhook({ secret: undefined, isProduction: true, allowInsecure: true }) as any).status, 503);
  eq("dev + no secret + no explicit opt-in → still refuses",
    (authorizeInstantlyWebhook({ secret: undefined, isProduction: false }) as any).status, 503);
  eq("dev + explicit opt-in → allowed (testing seam)",
    authorizeInstantlyWebhook({ secret: undefined, isProduction: false, allowInsecure: true }), { ok: true, via: "insecure_dev" });
}

// ── payload normalization ──────────────────────────────────────────────────
console.log("\n· payload normalization");
{
  const bounce = normalizeInstantlyEvent({ event_type: "email_bounced", lead_email: "A@Example.COM", campaign_id: "c-1", lead_id: "il-9" });
  eq("bounce kind", bounce.kind, "bounce");
  eq("email lowercased", bounce.email, "a@example.com");
  eq("campaign id kept", bounce.campaignId, "c-1");
  eq("instantly lead id kept", bounce.providerLeadId, "il-9");

  eq("lead_unsubscribed → unsubscribe", normalizeInstantlyEvent({ event_type: "lead_unsubscribed", email: "b@x.com" }).kind, "unsubscribe");
  eq("reply_received → reply", normalizeInstantlyEvent({ event_type: "reply_received", email: "b@x.com" }).kind, "reply");
  eq("unknown event → unknown", normalizeInstantlyEvent({ event_type: "campaign_completed" }).kind, "unknown");
  eq("empty payload → unknown", normalizeInstantlyEvent({}).kind, "unknown");
  eq("null payload does not throw", normalizeInstantlyEvent(null).kind, "unknown");

  const reply = normalizeInstantlyEvent({
    event: "reply_received", from_address_email: "c@x.com", id: "em-1",
    body: { html: "<p>Hola&nbsp;&amp; gracias</p>" }, timestamp_email: "2026-09-10T12:00:00Z",
  });
  eq("html body stripped to text", reply.text, "Hola & gracias");
  eq("message id from `id`", reply.messageId, "em-1");
  eq("threadId falls back to messageId", reply.threadId, "em-1");
  eq("timestamp normalized to ISO", reply.timestamp, "2026-09-10T12:00:00.000Z");
  eq("garbage timestamp → null", normalizeInstantlyEvent({ event: "reply", timestamp: "not-a-date" }).timestamp, null);
}

// ── TESTS 5-6 — bounce ─────────────────────────────────────────────────────
console.log("\n5 · a known bounce flags the lead so dispatch-email stops emailing it");
{
  const plan = planBounceLeadUpdate({ primary_email_status: null });
  eq("needs update", plan.needsUpdate, true);
  eq("writes into the column dispatch-email actually reads", plan.patch, { primary_email_status: "bounced" });
  eq("'Verified' lead gets flagged", planBounceLeadUpdate({ primary_email_status: "Verified" }).needsUpdate, true);
  eq("catch_all lead gets flagged", planBounceLeadUpdate({ primary_email_status: "catch_all" }).needsUpdate, true);
}

console.log("\n6 · a redelivered bounce is a no-op (Instantly retries)");
{
  eq("already bounced → no write", planBounceLeadUpdate({ primary_email_status: "bounced" }), { needsUpdate: false, patch: null });
  eq("already invalid → no write", planBounceLeadUpdate({ primary_email_status: "invalid" }), { needsUpdate: false, patch: null });
  eq("case/space insensitive", planBounceLeadUpdate({ primary_email_status: " BOUNCED " }).needsUpdate, false);
}

// ── TESTS 7-8 — unsubscribe ────────────────────────────────────────────────
console.log("\n7 · an unsubscribe creates a suppression, and is NOT recorded as a bounce");
{
  const plan = planUnsubscribeActions({ hasActiveEmailSuppression: false });
  eq("inserts the suppression", plan.insertSuppression, true);
  eq("never touches primary_email_status", plan.markLeadBounced, false);
}

console.log("\n8 · a repeated unsubscribe is idempotent");
{
  eq("existing active suppression → no second row",
    planUnsubscribeActions({ hasActiveEmailSuppression: true }), { insertSuppression: false, markLeadBounced: false });
}

// ── TEST 9 — reply dedupe across webhook + two pollers ─────────────────────
console.log("\n9 · webhook and pollers converge on ONE lead_replies row");
{
  const event = normalizeInstantlyEvent({ event_type: "reply_received", email: "d@x.com", id: "em-42", body: { text: "Sí, me interesa mucho, hablemos la semana que viene" } });

  eq("first delivery inserts",
    shouldInsertReply({ event, existingThreadIds: [], existingTextPrefixes: [] }).insert, true);

  eq("second delivery of the same event does not",
    shouldInsertReply({ event, existingThreadIds: ["em-42"], existingTextPrefixes: [] }).insert, false);

  // The n8n Reply Handler stores Instantly's email id in provider_thread_id, so
  // whichever producer arrives first blocks the other through that column.
  eq("n8n poller got there first → webhook skips",
    shouldInsertReply({ event, existingThreadIds: ["other", "em-42"], existingTextPrefixes: [] }).reason,
    "already stored (provider_thread_id match)");

  // recover-replies dedupes on the first 60 chars and stores no id.
  const prefix = "Sí, me interesa mucho, hablemos la semana que viene".slice(0, 60);
  eq("recover-replies row (no id) still blocks a duplicate",
    shouldInsertReply({ event, existingThreadIds: [null], existingTextPrefixes: [prefix] }).insert, false);

  eq("payload with no usable id is never inserted unkeyed",
    shouldInsertReply({
      event: normalizeInstantlyEvent({ event_type: "reply_received", email: "d@x.com", body: { text: "hola" } }),
      existingThreadIds: [], existingTextPrefixes: [],
    }).insert, false);

  eq("empty body is not inserted",
    shouldInsertReply({
      event: normalizeInstantlyEvent({ event_type: "reply_received", email: "d@x.com", id: "em-43", body: { text: "   " } }),
      existingThreadIds: [], existingTextPrefixes: [],
    }).insert, false);
}

// ── TEST 10 — tenant isolation ─────────────────────────────────────────────
console.log("\n10 · a cross-tenant address is refused, never applied to both");
{
  eq("unique lead resolves",
    decideEmailOnlyMatch([{ id: "l1", company_bio_id: "arqy" }]),
    { ok: true, leadId: "l1", companyBioId: "arqy" });

  // The real japaricio@arengy.com.ar case: one address, Arqy + SWL.
  const both = decideEmailOnlyMatch([
    { id: "l-arqy", company_bio_id: "0902962f" },
    { id: "l-swl", company_bio_id: "7c02e222" },
  ]);
  eq("two tenants → refused", both.ok, false);
  eq("flagged as ambiguous, not as 'not found'", (both as any).ambiguous, true);
  ok("reason names the refusal", (both as any).reason.includes("refusing to guess"));

  eq("two leads inside ONE tenant → also refused (no silent pick)",
    decideEmailOnlyMatch([{ id: "a", company_bio_id: "t1" }, { id: "b", company_bio_id: "t1" }]).ok, false);
  eq("no match → not ambiguous", (decideEmailOnlyMatch([]) as any).ambiguous, false);
}

console.log(`\nInstantly webhook: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("FAILURES:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
