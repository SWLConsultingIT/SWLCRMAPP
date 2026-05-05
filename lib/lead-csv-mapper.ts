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
  if (!apiKey) throw new Error("OPENAI_API_KEY env var not set");

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
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.mappings)) {
      throw new Error("Mapper response missing 'mappings' array");
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
  } finally {
    clearTimeout(timer);
  }
}

// Applies the mapping AI returned to one CSV row. Returns:
//   - canonical fields as direct keys
//   - extras collected under `enrichment` key (which lives in leads.enrichment JSONB)
// `_fullname` and `_location` are split into their canonical parts.
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
