// Sender-pool guard — the ONLY thing standing between a tenant's outreach and
// another tenant's mailboxes now that SWL, Arqy and Grupo IEB share one
// physical Instantly workspace.
//
// Background. Instantly picks the sending inbox itself, from the campaign's
// `email_list`. Growth Engine never chooses a sender: `resolveFlowCampaignId`
// clones the tenant's template campaign and the clone inherits whatever
// `email_list` the template carried. Until the 2026-09 workspace consolidation
// there was a physical backstop — an Arqy campaign literally could not attach an
// SWL inbox, because they lived in different Instantly organizations. Sharing one
// workspace removes that backstop: the only remaining separation is the
// `email_list` a human configured in the Instantly UI, and nothing in this
// codebase read it.
//
// This module is that missing check. `company_bios.email_accounts` — until now
// pure bookkeeping consumed only by the /accounts page filter — becomes the
// declared allow-list, and every campaign we dispatch through must draw its
// senders from inside it.
//
// Deliberately NOT a domain check. SWL legitimately sends from five domains
// (swlconsultant / swlsales / swladvisory / swlsolution / swltechsolutions), so
// "every sender shares one domain" would both false-positive on SWL and
// false-negative on an arqysales.com address that belongs to a different tenant.
// Set membership against the declared pool is stricter and correct.
//
// Pure module: no IO, no Supabase, no fetch. Callers supply both lists. That
// keeps it unit-testable (scripts/test-sender-pool.mts) and cheap to call.

export type SenderPoolStatus = "pass" | "block" | "warn";

export type SenderPoolVerdict = {
  status: SenderPoolStatus;
  /** Senders present on the campaign that are NOT in the tenant's declared pool. */
  violations: string[];
  /** Declared pool size, after normalization. */
  expectedCount: number;
  /** Campaign pool size, after normalization. */
  actualCount: number;
  /** Human-readable, safe to put in error_details and logs. Never contains keys. */
  reason: string;
};

/** Lowercase + trim. Instantly echoes addresses back with inconsistent casing. */
export function normalizeAddress(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeAddressList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    // Instantly returns a plain string array for `email_list`, but tolerate the
    // object shape ({ email }) some of their endpoints use so a future response
    // change degrades into a violation report instead of an empty pool that
    // silently blocks every send.
    const raw = typeof entry === "string"
      ? entry
      : (entry && typeof entry === "object" && "email" in entry ? (entry as { email?: unknown }).email : null);
    const norm = normalizeAddress(raw);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * Is the campaign's sender pool a subset of the tenant's declared pool?
 *
 *   declared = company_bios.email_accounts
 *   actual   = the Instantly campaign's email_list
 *
 * Cases, matching the agreed policy:
 *   1. actual contains an address outside declared  → block
 *   2. actual is empty                              → block (a pool-less campaign
 *      auto-suspends in Instantly anyway; blocking here gives a clear reason
 *      instead of a silent stall)
 *   3. declared is empty / undeclared               → warn, never block. Grupo IEB
 *      has no email_accounts yet and blocking it would take a live tenant down to
 *      close a gap it never had.
 *   4. actual ⊆ declared, both non-empty            → pass
 */
export function validateSenderPool(input: {
  declared: unknown;
  actual: unknown;
}): SenderPoolVerdict {
  const declared = normalizeAddressList(input.declared);
  const actual = normalizeAddressList(input.actual);

  // Case 3 first: an undeclared pool cannot produce a meaningful subset test.
  // Reported as warn so the audit route surfaces it without stopping dispatch.
  if (declared.length === 0) {
    return {
      status: "warn",
      violations: [],
      expectedCount: 0,
      actualCount: actual.length,
      reason: "tenant has no email_accounts declared — sender pool cannot be verified",
    };
  }

  // Case 2: nothing to send from.
  if (actual.length === 0) {
    return {
      status: "block",
      violations: [],
      expectedCount: declared.length,
      actualCount: 0,
      reason: "campaign has no sending accounts attached (email_list is empty)",
    };
  }

  // Case 1: any sender outside the declared pool.
  const allowed = new Set(declared);
  const violations = actual.filter((addr) => !allowed.has(addr));
  if (violations.length > 0) {
    return {
      status: "block",
      violations,
      expectedCount: declared.length,
      actualCount: actual.length,
      reason: `campaign sends from ${violations.length} address(es) outside the tenant's pool: ${violations.join(", ")}`,
    };
  }

  // Case 4.
  return {
    status: "pass",
    violations: [],
    expectedCount: declared.length,
    actualCount: actual.length,
    reason: "all campaign senders belong to the tenant's declared pool",
  };
}

/** True when dispatch must not proceed. Only `block` stops a send; `warn` does not. */
export function blocksDispatch(verdict: SenderPoolVerdict): boolean {
  return verdict.status === "block";
}

/**
 * Structured, credential-free log line for a guard decision. Emitted with a
 * stable `[sender-pool]` prefix so it is greppable in Vercel logs and can back
 * an alert rule later. Never include an API key, and never the whole payload.
 */
export function senderPoolLogPayload(input: {
  verdict: SenderPoolVerdict;
  tenantBioId: string;
  tenantName?: string | null;
  campaignId: string;
  flowName?: string | null;
  stage: "provision" | "dispatch" | "audit";
}): Record<string, unknown> {
  return {
    event: "sender_pool_guard",
    stage: input.stage,
    status: input.verdict.status,
    tenant_bio_id: input.tenantBioId,
    tenant: input.tenantName ?? null,
    instantly_campaign_id: input.campaignId,
    flow: input.flowName ?? null,
    unexpected_senders: input.verdict.violations,
    expected_pool_size: input.verdict.expectedCount,
    actual_pool_size: input.verdict.actualCount,
    reason: input.verdict.reason,
    at: new Date().toISOString(),
  };
}
