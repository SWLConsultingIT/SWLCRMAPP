// Unit tests for the sender-pool guard. Pure logic plus a stubbed-fetch test
// that pins the caching/coalescing behaviour.
// Run: npx tsx scripts/test-sender-pool.mts
//
// What this guard is for: SWL, Arqy and Grupo IEB now share ONE physical
// Instantly workspace, so separate organizations no longer make a cross-brand
// send impossible. The campaign's email_list is the only remaining boundary and
// nothing used to read it. Membership of the tenant's declared pool is the rule
// — deliberately NOT "one domain per campaign", since SWL sends from five.

import { validateSenderPool, blocksDispatch, normalizeAddressList, senderPoolLogPayload } from "../lib/sender-pool.ts";
import { fetchCampaignPool, verifyCampaignSenderPool, _resetCampaignPoolCache, campaignPoolCacheSize } from "../lib/instantly-campaign-pool.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) { eq(name, !!cond, true); }

// Real pools, from the 2026-09-10 preflight.
const ARQY = ["contact@arqysales.com", "deals@arqysales.com", "info@arqysales.com", "sales@arqysales.com", "support@arqysales.com"];
const SWL = [
  "contact@swlconsultant.com", "info@swlconsultant.com", "sales@swlconsultant.com", "support@swlconsultant.com",
  "contact@swlsales.com", "info@swlsales.com", "sales@swlsales.com", "support@swlsales.com",
  "contact@swladvisory.com", "info@swladvisory.com", "sales@swladvisory.com", "support@swladvisory.com",
  "contact@swlsolution.com", "info@swlsolution.com", "sales@swlsolution.com", "support@swlsolution.com",
  "contact@swltechsolutions.com", "info@swltechsolutions.com", "sales@swltechsolutions.com", "support@swltechsolutions.com",
];

// ── TEST 11 ────────────────────────────────────────────────────────────────
console.log("\n11 · Arqy campaign with the 5 Arqy senders → PASS");
{
  const v = validateSenderPool({ declared: ARQY, actual: ARQY });
  eq("status", v.status, "pass");
  eq("no violations", v.violations, []);
  eq("counts", [v.expectedCount, v.actualCount], [5, 5]);
  ok("does not block dispatch", !blocksDispatch(v));

  const subset = validateSenderPool({ declared: ARQY, actual: ["sales@arqysales.com"] });
  eq("a strict subset also passes", subset.status, "pass");
  eq("casing and padding are normalized", validateSenderPool({ declared: ARQY, actual: ["  SALES@ArqySales.com "] }).status, "pass");
}

// ── TEST 12 ────────────────────────────────────────────────────────────────
console.log("\n12 · Arqy campaign with 4 Arqy + 1 SWL sender → BLOCK");
{
  const contaminated = [...ARQY.slice(0, 4), "contact@swlsales.com"];
  const v = validateSenderPool({ declared: ARQY, actual: contaminated });
  eq("status", v.status, "block");
  eq("names the offender", v.violations, ["contact@swlsales.com"]);
  ok("blocks dispatch", blocksDispatch(v));
  ok("reason is safe to store in error_details", v.reason.includes("contact@swlsales.com") && !v.reason.includes("Bearer"));

  // The scenario that motivated the whole guard: the transferred arqysales.com
  // mailboxes now sit in the SWL workspace, so an SWL campaign could pick them up.
  const reverse = validateSenderPool({ declared: SWL, actual: [...SWL.slice(0, 3), "sales@arqysales.com"] });
  eq("SWL campaign borrowing an Arqy mailbox → block", reverse.status, "block");
  eq("names it", reverse.violations, ["sales@arqysales.com"]);

  eq("several offenders are all reported",
    validateSenderPool({ declared: ARQY, actual: ["sales@arqysales.com", "a@swlsales.com", "b@iebsales.com"] }).violations,
    ["a@swlsales.com", "b@iebsales.com"]);
}

// ── TEST 13 ────────────────────────────────────────────────────────────────
console.log("\n13 · campaign with an empty sender pool → BLOCK");
{
  const v = validateSenderPool({ declared: ARQY, actual: [] });
  eq("status", v.status, "block");
  ok("reason explains it", v.reason.includes("no sending accounts"));
  ok("blocks dispatch", blocksDispatch(v));
  eq("a non-array email_list is treated as empty, not as a pass", validateSenderPool({ declared: ARQY, actual: null }).status, "block");
  eq("undefined too", validateSenderPool({ declared: ARQY, actual: undefined }).status, "block");
}

// ── TEST 14 ────────────────────────────────────────────────────────────────
console.log("\n14 · SWL with five declared domains → PASS (a domain check would fail here)");
{
  const v = validateSenderPool({ declared: SWL, actual: SWL });
  eq("status", v.status, "pass");
  eq("all 20 accounted for", [v.expectedCount, v.actualCount], [20, 20]);
  const domains = new Set(SWL.map(a => a.split("@")[1]));
  eq("the pool really does span 5 domains", domains.size, 5);
  eq("a mixed-domain subset still passes", validateSenderPool({ declared: SWL, actual: ["sales@swlsales.com", "info@swladvisory.com"] }).status, "pass");
}

// ── TEST 15 ────────────────────────────────────────────────────────────────
console.log("\n15 · Grupo IEB with no declared pool → WARN, never BLOCK");
{
  for (const declared of [null, undefined, []] as unknown[]) {
    const v = validateSenderPool({ declared, actual: ["info@iebsales.com"] });
    eq(`declared=${JSON.stringify(declared)} → warn`, v.status, "warn");
    ok("does NOT block a live tenant", !blocksDispatch(v));
  }
  const v = validateSenderPool({ declared: null, actual: ["info@iebsales.com"] });
  ok("reason says why it could not be verified", v.reason.includes("no email_accounts declared"));
  eq("no violations invented", v.violations, []);
}

// ── TESTS 16-17 — clone-time behaviour ─────────────────────────────────────
console.log("\n16 · a clone that inherited the right pool is accepted");
{
  // resolveFlowCampaignId clones email_list from the template, then re-reads the
  // created campaign and validates the PERSISTED object.
  const template = { email_list: ARQY };
  const clone = { email_list: [...template.email_list] };
  eq("template validates", validateSenderPool({ declared: ARQY, actual: template.email_list }).status, "pass");
  eq("clone validates", validateSenderPool({ declared: ARQY, actual: clone.email_list }).status, "pass");
}

console.log("\n17 · a clone with drift is rejected, so it is never activated");
{
  // The 2026-05-07 failure mode: email_list silently drops and the campaign
  // comes up with zero accounts. Re-reading the clone is what catches it.
  const dropped = validateSenderPool({ declared: ARQY, actual: [] });
  eq("dropped pool → block", dropped.status, "block");
  ok("blocks, therefore the caller must not activate", blocksDispatch(dropped));

  const drifted = validateSenderPool({ declared: ARQY, actual: [...ARQY, "contact@swlsales.com"] });
  eq("extra foreign sender → block", drifted.status, "block");

  // A contaminated TEMPLATE must be caught before cloning: otherwise it mints
  // contaminated campaigns forever.
  eq("contaminated template → block before clone",
    validateSenderPool({ declared: ARQY, actual: ["contact@swlsales.com"] }).status, "block");
}

// ── TEST 18 — no N+1 ───────────────────────────────────────────────────────
console.log("\n18 · one request per campaign per window, not one per email");
{
  const realFetch = globalThis.fetch;
  let calls = 0;
  const bodyFor = (list: string[]) => ({
    ok: true, status: 200,
    json: async () => ({ id: "c", name: "Arqy — Test", status: 1, email_list: list }),
  });

  try {
    globalThis.fetch = (async (url: unknown) => {
      calls++;
      // A tiny delay so the 20 parallel callers genuinely overlap; without it
      // the first call could resolve before the others even start and the test
      // would pass without proving coalescing.
      await new Promise(r => setTimeout(r, 10));
      return bodyFor(String(url).includes("arqy-campaign") ? ARQY : SWL) as unknown as Response;
    }) as typeof fetch;

    // 20 concurrent callers = one dispatch-email tick at BATCH_SIZE.
    _resetCampaignPoolCache(); calls = 0;
    const burst = await Promise.all(
      Array.from({ length: 20 }, () => verifyCampaignSenderPool({ apiKey: "k", campaignId: "arqy-campaign", declared: ARQY })),
    );
    eq("20 parallel callers → 1 remote request (coalesced)", calls, 1);
    eq("all 20 got the same verdict", new Set(burst.map(b => b.verdict.status)).size, 1);
    eq("and it is a pass", burst[0].verdict.status, "pass");

    // Warm cache: further ticks inside the TTL cost nothing.
    const before = calls;
    await Promise.all(Array.from({ length: 40 }, () => verifyCampaignSenderPool({ apiKey: "k", campaignId: "arqy-campaign", declared: ARQY })));
    eq("40 more calls inside the TTL → 0 extra requests", calls - before, 0);

    // Two campaigns are two entries, not one shared blob.
    await verifyCampaignSenderPool({ apiKey: "k", campaignId: "swl-campaign", declared: SWL });
    eq("a second campaign costs exactly 1 more request", calls, 2);
    eq("cache holds both", campaignPoolCacheSize(), 2);

    // force=1 (the audit route) must see live state.
    const forced = calls;
    await verifyCampaignSenderPool({ apiKey: "k", campaignId: "arqy-campaign", declared: ARQY, force: true });
    eq("force bypasses the cache", calls - forced, 1);

    // Fail-closed: an unreadable campaign blocks instead of passing.
    globalThis.fetch = (async () => { calls++; return { ok: false, status: 500, json: async () => ({}) } as unknown as Response; }) as typeof fetch;
    _resetCampaignPoolCache();
    const broken = await verifyCampaignSenderPool({ apiKey: "k", campaignId: "unreadable", declared: ARQY });
    eq("Instantly 500 → block, not pass", broken.verdict.status, "block");
    eq("marked as not fetched", broken.fetched, false);
    ok("reason says we refused to send unverified", broken.verdict.reason.includes("blocking rather than sending unverified"));

    globalThis.fetch = (async () => { calls++; throw new Error("ECONNRESET"); }) as typeof fetch;
    _resetCampaignPoolCache();
    eq("network throw → block", (await verifyCampaignSenderPool({ apiKey: "k", campaignId: "x", declared: ARQY })).verdict.status, "block");
  } finally {
    globalThis.fetch = realFetch;
    _resetCampaignPoolCache();
  }
}

// ── logging hygiene ────────────────────────────────────────────────────────
console.log("\n· logging carries what an operator needs and no credentials");
{
  const v = validateSenderPool({ declared: ARQY, actual: [...ARQY.slice(0, 4), "contact@swlsales.com"] });
  const payload = senderPoolLogPayload({
    verdict: v, tenantBioId: "0902962f", tenantName: "Arqy",
    campaignId: "72a7d39c", flowName: "ARQY - ARG - Multicanal", stage: "dispatch",
  });
  eq("tenant", payload.tenant, "Arqy");
  eq("campaign", payload.instantly_campaign_id, "72a7d39c");
  eq("unexpected senders", payload.unexpected_senders, ["contact@swlsales.com"]);
  eq("expected pool size", payload.expected_pool_size, 5);
  eq("stage", payload.stage, "dispatch");
  ok("has a timestamp", typeof payload.at === "string");
  const serialized = JSON.stringify(payload).toLowerCase();
  ok("no api key, no bearer token, no secret in the log line",
    !serialized.includes("bearer") && !serialized.includes("api_key") && !serialized.includes("apikey"));
}

console.log("\n· normalization helpers");
{
  eq("dedupes and lowercases", normalizeAddressList(["A@x.com", "a@X.com", " a@x.com "]), ["a@x.com"]);
  eq("drops blanks and non-strings", normalizeAddressList(["a@x.com", "", null, 42, undefined]), ["a@x.com"]);
  eq("tolerates the {email} object shape", normalizeAddressList([{ email: "B@x.com" }]), ["b@x.com"]);
  eq("non-array → empty", normalizeAddressList("a@x.com"), []);
}

console.log(`\nSender pool guard: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("FAILURES:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
