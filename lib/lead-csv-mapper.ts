// AI-driven CSV column mapper. Given the headers + a few sample rows from a
// client-uploaded spreadsheet, asks GPT-4o-mini to map every recognisable
// column to a canonical `leads` field, or to an `_extra:<header>` slot that
// flows into the per-lead enrichment JSON.
//
// Prompt mirrors the production n8n workflow `rkQvDu8FJcs0bLZm` so the same
// scrapes (Apollo, Phantom Buster, ZoomInfo, RFA, etc.) map identically.
// Ported in-app to remove the n8n dependency for client onboarding.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

export type LeadColumnMapping = {
  source: string;
  target: string; // canonical leads column OR `_extra:<original>` OR `_fullname` / `_location`
};

export type LeadMappingResult = {
  source_tool: string;
  mappings: LeadColumnMapping[];
};

const CANONICAL_COLUMNS = [
  "primary_first_name", "primary_last_name", "primary_personal_email", "primary_work_email",
  "primary_phone", "primary_secondary_phone", "primary_linkedin_url", "primary_instagram",
  "primary_facebook", "primary_photo_url", "primary_headline", "primary_title_role",
  "primary_career", "primary_seniority", "primary_email_status",
  "company_name", "company_website", "company_address_1", "company_address_2", "company_cp",
  "company_city", "company_state", "company_country", "company_phone", "company_email",
  "company_linkedin", "company_instagram", "company_google_mybusiness",
  "twitter_url", "facebook_url",
  "company_industry", "company_sub_industry", "keywords", "employees", "annual_revenue",
  "organization_tagline", "organization_description", "organization_short_desc",
  "organization_seo_desc", "organization_logo_url", "organization_technologies",
  "similar_organization", "google_reviews_rating", "company_posts_content",
  "source_tool", "source_universe", "source_campaign_name", "source_campaign_type",
  "source_campaign_id", "source_campaign_industry", "source_campaign_subindustry",
  "source_campaign_countries", "source_campaign_cities",
  "industry_trends", "company_linkedin_post", "company_blog",
  "instagram_last_posts", "twitter_last_posts",
  "company_mission", "recent_website_news", "website_summary",
  "recent_linkedin_post", "recent_ig_post",
] as const;

const FORBIDDEN = ["company_bio_id", "icp_profile_id", "lead_id", "is_priority", "lead_score", "assigned_seller", "sync_status", "sync_date"];

function buildPrompt(input: {
  fileName: string;
  sourceHeaders: string[];
  sampleRows: Array<Record<string, string>>;
}): string {
  return `You are a data mapping assistant. Your job is to map source spreadsheet column headers to a target CRM template. You MUST map every source header that has a reasonable match - do NOT skip any.

## SOURCE HEADERS (from the uploaded file):
${input.sourceHeaders.join("\n")}

## SAMPLE DATA (first rows):
${JSON.stringify(input.sampleRows, null, 2)}

## TARGET TEMPLATE COLUMNS (CRM Lead Sheet) — CANONICAL FIELDS:
${CANONICAL_COLUMNS.join(", ")}

## EXTRAS (NEW — schemaless catch-all for client-specific fields):
For ANY source column that does NOT cleanly match a canonical target above (e.g. "RFA Rating", "Credit Score", "Trade Debtors", "MRR", "Open Roles"; or any custom column from a niche scrape), DO NOT skip them. Instead, map them as:

\`\`\`
{ "source": "<exact source header>", "target": "_extra:<exact source header>" }
\`\`\`

The target value MUST be \`_extra:\` followed by the EXACT original source header (case and spaces preserved). The downstream code takes those and writes them to a per-lead enrichment JSONB column.

NEVER use \`_extra:\` for fields that DO have a canonical match. Always prefer canonical mapping when reasonable.

## FORBIDDEN COLUMNS - NEVER map anything to these (they are manual/internal):
${FORBIDDEN.join(", ")}

## MANDATORY MAPPING RULES (canonical — these MUST go to canonical columns, never to _extra):
- "Person Linkedin Url" or any linkedin profile URL column MUST map to "primary_linkedin_url"
- "Email" from Apollo/work tools MUST map to "primary_work_email" (not personal_email). Only map to primary_personal_email if the header explicitly says personal/home.
- Any column with "linkedin" in its name referring to a person MUST map to "primary_linkedin_url"
- Any column with "linkedin" referring to a company MUST map to "company_linkedin"
- "Title" or "Job Title" MUST map to "primary_title_role"
- "Industry" MUST map to "company_industry"
- "Website" or "Domain" MUST map to "company_website"
- "Phone" or "Direct Phone" or "Mobile" MUST map to "primary_phone"
- "# Employees" or "Number of Employees" or "Employee Count" or "Employees" MUST map to "employees"
- "Annual Revenue" or "Revenue" or "Yearly Revenue" MUST map to "annual_revenue"
- "Email Status", "Verification Status", "Email Verified", "Email Validity" MUST map to "primary_email_status"
- "Technologies", "Tech Stack", "Tools Used", "Software Used", "Org Technologies" (REFERRING TO THE COMPANY's tech stack) MUST map to "organization_technologies"
- "Headline" or "LinkedIn Headline" or "Bio" MUST map to "primary_headline"
- "Seniority" or "Seniority Level" MUST map to "primary_seniority"
- "Tagline" or "Company Tagline" MUST map to "organization_tagline"
- "Description" or "Company Description" or "About" (about the company) MUST map to "organization_description"
- "Short Description" MUST map to "organization_short_desc"
- "SEO Description" or "Meta Description" MUST map to "organization_seo_desc"
- "Logo" or "Logo URL" or "Company Logo" MUST map to "organization_logo_url"
- "Similar Companies" or "Similar Organizations" or "Competitors" MUST map to "similar_organization"
- "Google Reviews" or "Reviews Rating" or "Rating" MUST map to "google_reviews_rating"
- "Keywords" or "Tags" MUST map to "keywords"
- "City" alone MUST map to "company_city"; "State" → "company_state"; "Country" → "company_country"
- If a source header contains a full name (like "Name"), map target as "_fullname"
- If a source header is a location (like "Location" with "City, State, Country" data), map target as "_location"
- Do NOT map internal tracking fields (Email Open, Email Bounced, Replied, Demoed, Stage, Contact Owner, Account Owner) - skip those.

## CRITICAL: You MUST include ALL source headers that have a match (canonical OR extra). Do NOT skip any column unless it's an internal tracking field.

## Detect source_tool: Apollo, Phantom Buster, LinkedIn Sales Nav, ZoomInfo, RFA, Companies House, or Other.
## File name: ${input.fileName}

## OUTPUT FORMAT (respond ONLY with this JSON, no markdown, no explanation):
{"source_tool": "Apollo", "mappings": [{"source": "First Name", "target": "primary_first_name"}, {"source": "RFA Rating", "target": "_extra:RFA Rating"}]}`;
}

export async function inferLeadMapping(input: {
  fileName: string;
  sourceHeaders: string[];
  sampleRows: Array<Record<string, string>>;
}): Promise<LeadMappingResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  // No key configured → skip the network round-trip and serve the heuristic
  // mapping straight away. The wizard surfaces it as suggestions the user
  // can edit, so a slightly worse first guess is still useful.
  if (!apiKey) return heuristicLeadMapping(input);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise data-mapping assistant. Reply with JSON only." },
          { role: "user", content: buildPrompt(input) },
        ],
      }),
    });
    if (!res.ok) {
      // OpenAI billing / quota / rate-limit / 5xx → fall back to the heuristic
      // mapper instead of bricking the entire upload wizard. The user still
      // gets a usable starting mapping at step 2 that they can fine-tune.
      const text = await res.text().catch(() => "");
      console.warn(`[lead-csv-mapper] OpenAI ${res.status}, falling back to heuristic. body=${text.slice(0, 200)}`);
      return heuristicLeadMapping(input);
    }
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.mappings)) {
      console.warn("[lead-csv-mapper] OpenAI response missing 'mappings', falling back to heuristic");
      return heuristicLeadMapping(input);
    }
    return {
      source_tool: typeof parsed.source_tool === "string" ? parsed.source_tool : "Other",
      mappings: parsed.mappings.filter(
        (m: unknown): m is LeadColumnMapping =>
          typeof m === "object" && m !== null &&
          typeof (m as LeadColumnMapping).source === "string" &&
          typeof (m as LeadColumnMapping).target === "string",
      ),
    };
  } catch (err) {
    // Network / abort / JSON parse / anything else → same fallback. The
    // wizard must never get stuck at step 1 because OpenAI hiccuped.
    console.warn("[lead-csv-mapper] OpenAI threw, falling back to heuristic:", err);
    return heuristicLeadMapping(input);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Heuristic fallback ──────────────────────────────────────────────────
// Pure-regex column mapper. Mirrors the canonical-mapping rules listed in
// `buildPrompt` so a CSV that the AI mapper would handle correctly also
// works without OpenAI. The fallback is intentionally conservative — it
// prefers to leave a column as `_skip` over a wrong guess, since the user
// gets to fix everything at step 2 anyway.

const TRACKING_HEADERS = new Set([
  "email open", "email opens", "email bounced", "email replied", "replied", "demoed",
  "stage", "contact owner", "account owner", "owner",
  "find people", "find work email", "enrich person",
  // Status side-columns the validators emit ("Validate LeadMagic" etc.):
  // they're either statuses or empty so we treat them as skip; the real
  // value sits in the matching "Find Work Email" column we already map.
]);

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Returns the canonical target for a normalized header, or null if no rule
// fires. `_fullname` / `_location` use a leading underscore to flag the
// special split logic in `applyMappingToRow`.
function heuristicTargetFor(headerNorm: string): string | null {
  const h = headerNorm;
  if (!h) return null;
  if (TRACKING_HEADERS.has(h)) return null;
  // Name
  if (/(^|\b)full name\b/.test(h)) return "_fullname";
  if (/(^|\b)name\b$/.test(h) && !/company|business|first|last/.test(h)) return "_fullname";
  if (/\bfirst ?name\b/.test(h)) return "primary_first_name";
  if (/\blast ?name\b/.test(h)) return "primary_last_name";
  // LinkedIn — person vs company
  if (/(person|profile|primary).*linkedin|linkedin.*(profile|url)|linkedin profile/.test(h)) return "primary_linkedin_url";
  if (/company.*linkedin|linkedin.*company/.test(h)) return "company_linkedin";
  if (/^linkedin( url)?$/.test(h)) return "primary_linkedin_url";
  // Emails
  if (/personal.*email|home.*email/.test(h)) return "primary_personal_email";
  if (/work.*email|company.*email|business.*email|find.*work.*email|work email$/.test(h)) return "primary_work_email";
  if (h === "email") return "primary_work_email";
  if (/email status|email verified|email validity|verification status|validate/.test(h)) return "primary_email_status";
  // Phones
  if (/direct.*phone|mobile|cell|phone number$|^phone$/.test(h)) return "primary_phone";
  if (/secondary.*phone|other.*phone|alt.*phone/.test(h)) return "primary_secondary_phone";
  if (/company.*phone|office.*phone/.test(h)) return "company_phone";
  // Socials
  if (/instagram/.test(h) && /company/.test(h)) return "company_instagram";
  if (/instagram/.test(h)) return "primary_instagram";
  if (/facebook/.test(h) && /company/.test(h)) return "company_facebook";
  if (/facebook/.test(h)) return "primary_facebook";
  if (/twitter/.test(h)) return "twitter_url";
  // Photo / headline / summary / role
  if (/photo|avatar|picture/.test(h)) return "primary_photo_url";
  if (/headline/.test(h)) return "primary_headline";
  if (/^summary$|profile summary|bio$/.test(h)) return "primary_career";
  if (/title|role|position|job title/.test(h)) return "primary_title_role";
  if (/seniority/.test(h)) return "primary_seniority";
  // Company core
  if (/company name|organization name|account name$/.test(h)) return "company_name";
  if (/website|domain|company url/.test(h)) return "company_website";
  if (/industry/.test(h) && /sub/.test(h)) return "company_sub_industry";
  if (/industry/.test(h)) return "company_industry";
  if (/employees|employee count|number of employees|head ?count/.test(h)) return "employees";
  if (/annual revenue|yearly revenue|revenue/.test(h)) return "annual_revenue";
  if (/keywords|tags/.test(h)) return "keywords";
  if (/(company|org).*tagline|tagline/.test(h)) return "organization_tagline";
  if (/(company|org).*description|description|about/.test(h)) return "organization_description";
  if (/short desc/.test(h)) return "organization_short_desc";
  if (/seo desc|meta desc/.test(h)) return "organization_seo_desc";
  if (/logo/.test(h)) return "organization_logo_url";
  if (/technolog|tech stack|tools used|software used/.test(h)) return "organization_technologies";
  if (/similar (companies|orgs|organizations)|competitors/.test(h)) return "similar_organization";
  if (/google reviews|reviews rating|rating/.test(h)) return "google_reviews_rating";
  // Geography
  if (/^city$|company city/.test(h)) return "company_city";
  if (/^state$|company state|region|province/.test(h)) return "company_state";
  if (/^country$|company country/.test(h)) return "company_country";
  if (/^address ?1?$|street/.test(h)) return "company_address_1";
  if (/^address ?2$/.test(h)) return "company_address_2";
  if (/postal|zip|^cp$/.test(h)) return "company_cp";
  if (/^location$/.test(h)) return "_location";
  // Connections, jobs count, headlines about LinkedIn → enrichment extras
  return null;
}

function detectSourceTool(fileName: string, headers: string[]): string {
  const blob = (fileName + " " + headers.join(" ")).toLowerCase();
  if (/apollo/.test(blob)) return "Apollo";
  if (/phantom/.test(blob)) return "Phantom Buster";
  if (/sales ?nav|sn export/.test(blob)) return "LinkedIn Sales Nav";
  if (/zoominfo|zi export/.test(blob)) return "ZoomInfo";
  if (/rfa|red flag/.test(blob)) return "RFA";
  if (/companies ?house/.test(blob)) return "Companies House";
  return "Other";
}

export function heuristicLeadMapping(input: {
  fileName: string;
  sourceHeaders: string[];
  sampleRows: Array<Record<string, string>>;
}): LeadMappingResult {
  const mappings: LeadColumnMapping[] = [];
  // If both First Name and Last Name exist we want them to win over a
  // generic "Full Name" → first-pass scan establishes that signal.
  const lower = input.sourceHeaders.map(h => normHeader(h));
  const hasFirst = lower.some(h => /\bfirst ?name\b/.test(h));
  const hasLast = lower.some(h => /\blast ?name\b/.test(h));
  for (let i = 0; i < input.sourceHeaders.length; i++) {
    const raw = input.sourceHeaders[i];
    const h = lower[i];
    let target: string | null = heuristicTargetFor(h);
    // "Full Name" when First + Last are already present is pure duplication —
    // skip instead of stashing it in enrichment so we don't bloat the JSONB.
    if (target === "_fullname" && hasFirst && hasLast) {
      target = "_skip";
    }
    // Unknown column with non-empty data in the sample → bucket into the
    // schemaless `_extra:` slot so it survives import.
    if (!target) {
      const hasValue = input.sampleRows.some(r => (r[raw] ?? "").toString().trim() !== "");
      target = hasValue && !TRACKING_HEADERS.has(h) ? `_extra:${raw}` : "_skip";
    }
    mappings.push({ source: raw, target });
  }
  return {
    source_tool: detectSourceTool(input.fileName, input.sourceHeaders),
    mappings,
  };
}

// Applies the mapping AI returned to one CSV row. Returns:
//   - canonical fields as direct keys
//   - extras collected under `enrichment` key (which lives in leads.enrichment JSONB)
// `_fullname` and `_location` are split into their canonical parts.
// primary_seniority is a Postgres enum (seniority_level): intern, junior, mid,
// senior, lead, manager, director, vp, c_level, founder, owner. CSVs (Apollo)
// ship free-text like "Partner", "Entry", "C suite", "VP" → inserting verbatim
// throws "invalid input value for enum seniority_level" and the whole batch
// fails. Normalize to a valid label, or drop the field (null) when unknown.
const SENIORITY_ENUM = new Set([
  "intern", "junior", "mid", "senior", "lead", "manager", "director", "vp",
  "c_level", "founder", "owner",
]);
const SENIORITY_MAP: Record<string, string> = {
  partner: "owner", owner: "owner", founder: "founder", "co-founder": "founder",
  cofounder: "founder", "c suite": "c_level", "c-suite": "c_level", csuite: "c_level",
  "c level": "c_level", "c_level": "c_level", chief: "c_level", cxo: "c_level",
  ceo: "c_level", cto: "c_level", cfo: "c_level", coo: "c_level", cmo: "c_level",
  executive: "c_level", vp: "vp", "vice president": "vp", svp: "vp", evp: "vp",
  director: "director", head: "director", manager: "manager", mgr: "manager",
  senior: "senior", "senior management": "director", entry: "junior",
  junior: "junior", associate: "junior", staff: "mid", mid: "mid",
  intern: "intern", trainee: "intern", lead: "lead",
};
function normSeniority(v: string): string | null {
  const k = v.trim().toLowerCase();
  if (SENIORITY_ENUM.has(k)) return k;
  return SENIORITY_MAP[k] ?? null;
}

// Lead columns typed as Postgres text[] (udt _text). A CSV cell for these
// arrives as a comma-separated string (Apollo's "Technologies" column: "Amazon
// AWS, Slack, Stripe, …"); written verbatim Postgres throws "malformed array
// literal" and the whole insert fails. Split into a JS array so supabase-js
// serializes a valid array literal.
const ARRAY_FIELDS = new Set<string>(["organization_technologies"]);

export function applyMappingToRow(
  row: Record<string, string>,
  mapping: LeadMappingResult,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const enrichment: Record<string, string> = {};

  for (const m of mapping.mappings) {
    const value = (row[m.source] ?? "").toString().trim();
    if (!value) continue;

    if (m.target === "_fullname") {
      const parts = value.split(/\s+/);
      if (parts.length === 1) {
        out.primary_first_name = parts[0];
      } else {
        out.primary_first_name = parts[0];
        out.primary_last_name = parts.slice(1).join(" ");
      }
    } else if (m.target === "_location") {
      const parts = value.split(",").map(p => p.trim()).filter(Boolean);
      if (parts.length >= 1) out.company_city = parts[0];
      if (parts.length >= 2) out.company_state = parts[1];
      if (parts.length >= 3) out.company_country = parts[2];
    } else if (m.target.startsWith("_extra:")) {
      const key = m.target.slice("_extra:".length);
      enrichment[key] = value;
    } else if (FORBIDDEN.includes(m.target)) {
      // ignore — never write internal columns from CSV
    } else if (ARRAY_FIELDS.has(m.target)) {
      out[m.target] = value.split(",").map(p => p.trim()).filter(Boolean);
    } else if (m.target === "primary_seniority") {
      const s = normSeniority(value);
      if (s) out.primary_seniority = s; // unknown → leave null, never break the insert
    } else {
      out[m.target] = value;
    }
  }

  if (Object.keys(enrichment).length > 0) {
    out.enrichment = enrichment;
  }
  if (mapping.source_tool && !out.source_tool) {
    out.source_tool = mapping.source_tool;
  }
  return out;
}
