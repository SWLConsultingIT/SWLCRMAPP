// Referral enrichment — the single pluggable seam for the referral-capture
// feature. When a lead replies "I left the company, talk to X" or "I'm on
// vacation, contact Y", the reply handler (n8n, Haiku) extracts the referred
// contacts into `lead_replies.metadata.referred_contacts`. Before we create a
// lead from one of those contacts we run it through here to fill in the
// person-level fields we don't get from the referral text (title, LinkedIn
// URL, phone).
//
// STATUS: stub. Returns `found: false` for every contact, so referred leads
// are created EMAIL-ONLY (name + email + inherited company). The whole feature
// works without it — enrichment only upgrades a lead to a full multichannel
// flow.
//
// TO WIRE APOLLO (pending boss approval): implement `enrichReferral` against
// Apollo's people/match endpoint (POST https://api.apollo.io/api/v1/people/match,
// header `X-Api-Key`, body { email, first_name, last_name, domain }). Resolve
// the key like the Instantly one — env var `APOLLO_API_KEY` with an optional
// per-tenant override on `company_bios`. Nothing else in the feature changes.

export type ReferralEnrichInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  /** Company domain, usually derived from the referred email or inherited from the original lead. */
  domain?: string | null;
  companyName?: string | null;
};

export type ReferralEnrichResult = {
  /** false → no person-level data found; caller falls back to email-only. */
  found: boolean;
  title?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  /** Which provider produced the data, for the UI badge + audit. */
  provider: "none" | "apollo" | "clay";
};

const EMAIL_ONLY: ReferralEnrichResult = { found: false, provider: "none" };

/**
 * Enrich a single referred contact. Stubbed: always returns email-only.
 * Never throws — a failed enrichment must degrade gracefully to email-only,
 * never block lead creation.
 */
export async function enrichReferral(
  _input: ReferralEnrichInput,
): Promise<ReferralEnrichResult> {
  // Apollo/Clay wiring goes here once approved. Until then every referred
  // lead is created email-only.
  return EMAIL_ONLY;
}

/** Whether enrichment is live yet — drives the UI badge in the preview modal. */
export function isEnrichmentEnabled(): boolean {
  return false;
}
