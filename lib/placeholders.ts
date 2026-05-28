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
