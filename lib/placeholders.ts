// Single source of truth for the placeholders the dispatcher knows how to
// render. The wizard reads this to show authors what's available, and the
// dispatcher's `personalizeNote` accepts every alias listed here. The two
// must stay in sync — if you add a new placeholder, add it here AND in
// `personalizeNote` (app/api/cron/dispatch-queue/route.ts).
//
// Why this exists: on 2026-05-27 the PE Spain campaign shipped 8 emails
// with raw `{{firstName}}` and `{{fund_name}}` because the wizard offered
// no guidance on which placeholders work and the dispatcher silently let
// unsupported tokens through. This module fixes both halves.

export type PlaceholderGroup = {
  label: string;
  /** What the placeholder renders to, shown as helper text in the wizard. */
  description: string;
  /** Aliases — first entry is the canonical form we recommend. */
  tokens: string[];
};

export const PLACEHOLDER_GROUPS: PlaceholderGroup[] = [
  {
    label: "First name",
    description: "Lead's first name (falls back to \"there\" if missing).",
    tokens: ["{{first_name}}", "{{firstName}}", "{{name}}"],
  },
  {
    label: "Last name",
    description: "Lead's last name.",
    tokens: ["{{last_name}}", "{{lastName}}"],
  },
  {
    label: "Full name",
    description: "First + last joined with a space.",
    tokens: ["{{full_name}}", "{{fullName}}"],
  },
  {
    label: "Company",
    description: "Lead's company name. PE templates may use `fund_name`/`firm_name` as aliases.",
    tokens: ["{{company_name}}", "{{companyName}}", "{{company}}", "{{fund_name}}", "{{firm_name}}"],
  },
  {
    label: "Role / Title",
    description: "Lead's job title.",
    tokens: ["{{role}}", "{{title}}", "{{position}}"],
  },
  {
    label: "Seller name",
    description: "The seller assigned to this campaign — your name.",
    tokens: ["{{seller_name}}", "{{sellerName}}", "{{sender_name}}", "{{my_name}}"],
  },
];

/** Flat list of every supported token. Useful for validation / autocomplete. */
export const SUPPORTED_PLACEHOLDERS: string[] = PLACEHOLDER_GROUPS.flatMap(g => g.tokens);

/** Returns true if every `{{…}}` in the body is one we can render. */
export function hasOnlySupportedPlaceholders(body: string): boolean {
  const matches = body.match(/\{\{\s*[^}\s]+\s*\}\}/g);
  if (!matches) return true;
  return matches.every(m => SUPPORTED_PLACEHOLDERS.includes(m));
}

/** Returns the unsupported tokens in the body, if any. */
export function unsupportedPlaceholdersIn(body: string): string[] {
  const matches = body.match(/\{\{\s*[^}\s]+\s*\}\}/g);
  if (!matches) return [];
  const bad = matches.filter(m => !SUPPORTED_PLACEHOLDERS.includes(m));
  return [...new Set(bad)];
}

// ── Render-time helpers ───────────────────────────────────────────────
//
// Both /api/cron/dispatch-queue (LinkedIn) and /api/cron/dispatch-email
// (Instantly) call into here so the substitution table cannot drift.
// Before 2026-05-31 each dispatcher had its own private personalize()
// — the LinkedIn one knew about {{fund_name}} after the PE Spain fix,
// the email one did not, and a US PE follow-up went out with literal
// `{{fund_name}}` because the wizard let it through and the email
// dispatcher silently passed it on. Single source of truth fixes both
// halves: render here, refuse-on-unsupported here.

export type PlaceholderLead = {
  primary_first_name?: string | null;
  primary_last_name?: string | null;
  company_name?: string | null;
  primary_title_role?: string | null;
};

export type PlaceholderSeller = {
  name?: string | null;
};

export function renderPlaceholders(
  template: string,
  lead: PlaceholderLead,
  seller: PlaceholderSeller,
): string {
  const first = lead.primary_first_name ?? "there";
  const last = lead.primary_last_name ?? "";
  const full = `${first} ${last}`.trim();
  const company = lead.company_name ?? "";
  const role = lead.primary_title_role ?? "";
  const sellerName = seller.name ?? "";
  return (template ?? "")
    // First name — snake, camel, and "name" alone.
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{firstName}}", first)
    .replaceAll("{{name}}", first)
    // Last name.
    .replaceAll("{{last_name}}", last)
    .replaceAll("{{lastName}}", last)
    // Full name.
    .replaceAll("{{full_name}}", full)
    .replaceAll("{{fullName}}", full)
    // Company — including PE-specific `fund_name` / `firm_name` aliases.
    .replaceAll("{{company_name}}", company)
    .replaceAll("{{companyName}}", company)
    .replaceAll("{{company}}", company)
    .replaceAll("{{fund_name}}", company)
    .replaceAll("{{fundName}}", company)
    .replaceAll("{{firm_name}}", company)
    .replaceAll("{{firmName}}", company)
    // Role / title.
    .replaceAll("{{role}}", role)
    .replaceAll("{{title}}", role)
    .replaceAll("{{position}}", role)
    // Seller name — several aliases sellers wrote by hand.
    .replaceAll("{{seller_name}}", sellerName)
    .replaceAll("{{sellerName}}", sellerName)
    .replaceAll("{{sender_name}}", sellerName)
    .replaceAll("{{senderName}}", sellerName)
    .replaceAll("{{my_name}}", sellerName)
    .replaceAll("{{seller_company}}", "")
    .replaceAll("{{sellerCompany}}", "");
}

/** Any `{{…}}` left in the rendered string. Dispatchers must fail-the-row
 *  on a non-empty result, never ship raw. PE Spain incident origin. */
export function findUnresolvedPlaceholders(rendered: string): string[] {
  const matches = rendered.match(/\{\{\s*[^}\s]+\s*\}\}/g);
  if (!matches) return [];
  return [...new Set(matches)];
}
