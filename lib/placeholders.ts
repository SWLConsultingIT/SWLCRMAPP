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

// ── Suspicious placeholders (defense in depth) ────────────────────────
//
// The wizard accepts `{{first_name}}` etc. but operators paste in copy
// from other platforms that use different placeholder syntaxes:
//   • Mailchimp / Apollo / HubSpot: `[First Name]`, `[FIRSTNAME]`
//   • Instantly older versions:     `{First Name}` (single brace)
//   • Outreach / Klenty:            `<<First Name>>`
//   • Mailshake / Klaviyo:          `%FIRST_NAME%`
//   • Salesloft snippets:           `__first_name__`
//
// 2026-05-31: a LinkedIn DM shipped to Craig Wilson with the literal
// string `[First Name]` because none of the validators looked for
// brackets. findUnresolvedPlaceholders only catches `{{…}}`. This
// function catches ANY token that looks like a placeholder in a foreign
// syntax — so the dispatcher can refuse-the-row before send, and the
// wizard can highlight it in the editor.

// Patterns we recognise as "this was meant to be a placeholder but
// isn't the canonical {{snake_case}} form".
const SUSPICIOUS_PATTERNS: { name: string; regex: RegExp }[] = [
  // [First Name], [FIRSTNAME], [first-name]
  { name: "brackets",      regex: /\[[A-Za-z][A-Za-z0-9_\- ]{0,40}\]/g },
  // {First Name} — single brace, but EXCLUDE {{...}} (those are caught
  // by findUnresolvedPlaceholders if unsupported). Negative lookbehind
  // and lookahead keep us off the canonical form.
  { name: "single-brace",  regex: /(?<!\{)\{(?!\{)\s*[A-Za-z][A-Za-z0-9_\- ]{0,40}\s*\}(?!\})/g },
  // <<First Name>>
  { name: "chevrons",      regex: /<<\s*[A-Za-z][A-Za-z0-9_\- ]{0,40}\s*>>/g },
  // %FIRST_NAME% — at least 2 alpha chars to skip `%20` URL-encoding etc.
  { name: "percent",       regex: /%[A-Z][A-Z0-9_]{1,40}%/g },
  // __first_name__ — leading + trailing double underscore
  { name: "underscores",   regex: /__[A-Za-z][A-Za-z0-9_]{1,40}__/g },
];

export type SuspiciousMatch = {
  token: string;
  /** Pattern that flagged it — useful when explaining to the operator
   *  ("looks like a Mailchimp bracket placeholder"). */
  pattern: string;
  /** Best-guess canonical replacement, when we can infer one. Null when
   *  the inner label doesn't map to any supported placeholder (e.g.
   *  `[Custom Tag]` — operator has to decide). */
  suggested: string | null;
};

/** Returns every suspicious-looking token in a body — anything that
 *  reads like a placeholder but isn't the canonical `{{…}}` form. */
export function findSuspiciousPlaceholders(body: string): SuspiciousMatch[] {
  if (!body) return [];
  const found: SuspiciousMatch[] = [];
  const seen = new Set<string>();
  for (const p of SUSPICIOUS_PATTERNS) {
    const matches = body.match(p.regex);
    if (!matches) continue;
    for (const tok of matches) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      found.push({ token: tok, pattern: p.name, suggested: suggestCanonical(tok) });
    }
  }
  return found;
}

// Map an alien token to its canonical {{…}} equivalent when the inner
// label clearly matches a supported placeholder. Returns null when we
// can't infer — operator picks manually.
function suggestCanonical(token: string): string | null {
  // Strip outer wrappers + normalize: "[First Name]" → "first_name",
  // "%FIRST_NAME%" → "first_name", "<<firstName>>" → "first_name".
  const inner = token
    .replace(/^[\[\{<%_]+|[\]\}>%_]+$/g, "") // strip wrappers
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")    // camelCase → snake_case
    .replace(/[\s\-]+/g, "_")               // spaces/hyphens → _
    .toLowerCase();

  // Map normalized labels to canonical {{tokens}}.
  const NORMAL_TO_CANONICAL: Record<string, string> = {
    first_name: "{{first_name}}", firstname: "{{first_name}}", fname: "{{first_name}}",
    name: "{{first_name}}",
    last_name: "{{last_name}}", lastname: "{{last_name}}", lname: "{{last_name}}", surname: "{{last_name}}",
    full_name: "{{full_name}}", fullname: "{{full_name}}",
    company_name: "{{company_name}}", companyname: "{{company_name}}", company: "{{company_name}}",
    fund_name: "{{company_name}}", fundname: "{{company_name}}",
    firm_name: "{{company_name}}", firmname: "{{company_name}}",
    organization: "{{company_name}}", organisation: "{{company_name}}",
    role: "{{role}}", title: "{{role}}", position: "{{role}}", job_title: "{{role}}", jobtitle: "{{role}}",
    seller_name: "{{seller_name}}", sellername: "{{seller_name}}",
    sender_name: "{{seller_name}}", sendername: "{{seller_name}}",
    my_name: "{{seller_name}}", myname: "{{seller_name}}",
  };
  return NORMAL_TO_CANONICAL[inner] ?? null;
}

/** Rewrites a body, replacing every recognised foreign placeholder with
 *  its canonical `{{…}}` equivalent. Tokens we don't recognise are left
 *  untouched (so the suspicious-placeholders check still fires on them
 *  and the operator gets to decide). Pure function — caller persists. */
export function autoNormalizePlaceholders(body: string): { normalized: string; changes: Array<{ from: string; to: string }> } {
  if (!body) return { normalized: body ?? "", changes: [] };
  let out = body;
  const changes: Array<{ from: string; to: string }> = [];
  for (const m of findSuspiciousPlaceholders(body)) {
    if (!m.suggested) continue;
    // Replace all occurrences of this exact token. Order matters: do
    // longer tokens first so `[First Name]` doesn't get partially
    // gobbled by a shorter pattern.
    out = out.split(m.token).join(m.suggested);
    changes.push({ from: m.token, to: m.suggested });
  }
  return { normalized: out, changes };
}
