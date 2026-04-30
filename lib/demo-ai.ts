// ─── AI-tailored demo data generation ─────────────────────────────────────
// Replaces the canned `pickSeedLeads` + `icpTemplates` pools with an OpenAI
// call that synthesizes leads / ICPs / campaign sequences directly from a
// scraped company bio. Output language is detected from the scrape so a
// Spanish-language site (.com.ar, scraped value_prop in ES) gets Spanish
// names, companies, and outreach copy. Falls back gracefully to canned
// pools when OpenAI is down or unconfigured.

import type { SeedLead } from "@/lib/demo-seeds";
import { pickSeedLeads, type DemoIndustryKey } from "@/lib/demo-seeds";

type ScrapedBio = {
  company_name?: string | null;
  industry?: string | null;
  target_market?: string | null;
  value_proposition?: string | null;
  main_services?: string[] | null;
  location?: string | null;
  description?: string | null;
};

export type AiIcp = {
  profile_name: string;
  target_industries: string[];
  target_roles: string[];
  company_size: string;
  geography: string[];
  pain_points: string;
  solutions_offered: string;
  notes: string;
};

export type AiCampaignSequence = {
  name: string;
  steps: Array<{
    step_number: number;
    channel: "linkedin" | "email";
    type: "connection_request" | "dm" | "email";
    delay_days: number;
    subject?: string;
    body: string;
  }>;
};

export type AiPayload = {
  language: string; // "en" | "es" | etc — what the AI used
  leads: SeedLead[];
  icps: AiIcp[];
  campaigns: AiCampaignSequence[];
};

// Detect language hint from the scrape so the AI generates in the right tongue.
// We don't fail hard — if detection's wrong, the AI sees both signals and
// resolves them with the value-prop's actual language.
function detectLanguage(scrape: ScrapedBio): string {
  const text = `${scrape.value_proposition ?? ""} ${scrape.description ?? ""} ${scrape.target_market ?? ""}`.toLowerCase();
  // Cheap heuristic: presence of common Spanish stop words.
  const esMarkers = (text.match(/\b(el|la|los|las|de|del|para|con|y|en|que|por|son|sus|tu|tus|sin|más)\b/g) ?? []).length;
  const enMarkers = (text.match(/\b(the|of|and|for|with|in|that|are|their|our|we|to|by|on|from)\b/g) ?? []).length;
  if (esMarkers > enMarkers && esMarkers >= 3) return "es";
  return "en";
}

const SYSTEM_PROMPT = `You generate fictional but realistic demo data for a B2B sales CRM. Given a real company bio (the SELLER), produce ICP profiles + lead contacts + campaign sequences that look like a coherent prospecting database for that seller.

CRITICAL RULES:
- Leads must be at companies that would PLAUSIBLY buy from the seller. They are PROSPECTS, not the seller themselves.
- Lead names + company names must be realistic for the geography you select. Argentinian seller → Argentinian buyer companies + LATAM Spanish names. UK manufacturing seller → UK manufacturing companies + British names. US QSR seller → US restaurant chains + American names.
- Match the seniority of the role to the buyer persona the seller is selling to.
- Do not use real well-known companies (no Apple, Amazon, McDonald's). Use plausible-sounding fictional ones.
- Campaign sequence bodies should reference the seller's actual value proposition + main services (use them verbatim where natural).
- Output ALL text fields in the language indicated by 'language' input.
- Return ONLY valid JSON, no markdown fences, no commentary.`;

function userPrompt(scrape: ScrapedBio, counts: { leads: number; icps: number; campaigns: number }, language: string): string {
  return JSON.stringify({
    seller: {
      company_name: scrape.company_name,
      industry: scrape.industry,
      value_proposition: scrape.value_proposition,
      target_market: scrape.target_market,
      main_services: scrape.main_services ?? [],
      description: scrape.description,
      location: scrape.location,
    },
    counts,
    language,
    output_schema: {
      language: "ISO code, e.g. 'es' or 'en'",
      leads: [
        {
          first: "first name",
          last: "last name",
          role: "job title",
          seniority: "owner | c_level | vp | director | manager | senior | individual",
          company: "fictional company name",
          industry: "industry of buyer's company",
          country: "country name",
          employees: "approximate employee count, integer 5-2000",
          linkedin: "fictional linkedin URL slug like https://www.linkedin.com/in/firstname-lastname-suffix",
        },
      ],
      icps: [
        {
          profile_name: "name describing the buyer persona",
          target_industries: ["industry1", "industry2"],
          target_roles: ["role1", "role2"],
          company_size: "e.g. '20-200 employees'",
          geography: ["country1", "country2"],
          pain_points: "what hurts them today",
          solutions_offered: "what the SELLER offers them (use their value prop + services)",
          notes: "free-form context",
        },
      ],
      campaigns: [
        {
          name: "campaign name in target language",
          steps: [
            {
              step_number: 0,
              channel: "linkedin",
              type: "connection_request",
              delay_days: 0,
              body: "60-200 char connection request body using {{first_name}}, {{role}}, {{company_name}} placeholders where natural",
            },
            {
              step_number: 1,
              channel: "linkedin",
              type: "dm",
              delay_days: 2,
              body: "200-400 char DM that mentions one of the seller's main_services and the value_proposition",
            },
            {
              step_number: 2,
              channel: "email",
              type: "email",
              delay_days: 4,
              subject: "subject line, in target language",
              body: "200-400 char email body",
            },
            {
              step_number: 3,
              channel: "linkedin",
              type: "dm",
              delay_days: 7,
              body: "follow-up DM",
            },
          ],
        },
      ],
    },
    instructions: [
      `Generate exactly ${counts.leads} leads.`,
      `Generate exactly ${counts.icps} ICPs.`,
      `Generate exactly ${counts.campaigns} campaign sequences (each with 4 steps).`,
      "All output text in the indicated language.",
      "Return JSON only.",
    ],
  });
}

/** Calls OpenAI to synthesize tailored demo data. Returns null on failure
 *  (caller should fall back to canned pools). */
export async function aiGenerateDemoData(
  scrape: ScrapedBio,
  counts: { leads: number; icps: number; campaigns: number }
): Promise<AiPayload | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const language = detectLanguage(scrape);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(scrape, counts, language) },
        ],
      }),
      // 30s timeout — populating 30 leads + ICPs + campaigns can take a while
      // on busy days. Better than blocking forever.
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as Partial<AiPayload>;

    // Normalize + defensive trims so a flaky response doesn't poison the DB.
    const leads = Array.isArray(parsed.leads) ? parsed.leads.slice(0, counts.leads).map(normalizeLead) : [];
    const icps = Array.isArray(parsed.icps) ? parsed.icps.slice(0, counts.icps).map(normalizeIcp) : [];
    const campaigns = Array.isArray(parsed.campaigns) ? parsed.campaigns.slice(0, counts.campaigns).map(normalizeCampaign) : [];

    if (leads.length === 0) return null; // can't recover from zero — fall back

    return {
      language: parsed.language ?? language,
      leads,
      icps,
      campaigns,
    };
  } catch {
    return null;
  }
}

// ── Normalizers — clamp + fill missing fields so DB inserts don't blow up.
function normalizeLead(l: Partial<SeedLead>): SeedLead {
  return {
    first: String(l.first ?? "Demo").slice(0, 60),
    last: String(l.last ?? "Lead").slice(0, 60),
    role: String(l.role ?? "Manager").slice(0, 120),
    seniority: validSeniority(l.seniority),
    company: String(l.company ?? "Demo Co.").slice(0, 120),
    industry: String(l.industry ?? "B2B").slice(0, 80),
    country: String(l.country ?? "United States").slice(0, 60),
    employees: clampInt(l.employees, 5, 5000, 50),
    linkedin: String(l.linkedin ?? `https://www.linkedin.com/in/${(l.first ?? "demo").toString().toLowerCase()}-${(l.last ?? "lead").toString().toLowerCase()}`).slice(0, 200),
  };
}

function validSeniority(s: unknown): SeedLead["seniority"] {
  const allowed: SeedLead["seniority"][] = ["owner", "c_level", "vp", "director", "manager", "senior", "individual"];
  return allowed.includes(s as SeedLead["seniority"]) ? (s as SeedLead["seniority"]) : "manager";
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function normalizeIcp(i: Partial<AiIcp>): AiIcp {
  return {
    profile_name: String(i.profile_name ?? "Demo persona").slice(0, 120),
    target_industries: Array.isArray(i.target_industries) ? i.target_industries.map(String).slice(0, 8) : [],
    target_roles: Array.isArray(i.target_roles) ? i.target_roles.map(String).slice(0, 8) : [],
    company_size: String(i.company_size ?? "10-200").slice(0, 60),
    geography: Array.isArray(i.geography) ? i.geography.map(String).slice(0, 8) : [],
    pain_points: String(i.pain_points ?? "").slice(0, 600),
    solutions_offered: String(i.solutions_offered ?? "").slice(0, 600),
    notes: String(i.notes ?? "").slice(0, 600),
  };
}

function normalizeCampaign(c: Partial<AiCampaignSequence>): AiCampaignSequence {
  return {
    name: String(c.name ?? "Demo campaign").slice(0, 120),
    steps: Array.isArray(c.steps)
      ? c.steps.slice(0, 6).map((s, i) => ({
          step_number: clampInt(s.step_number, 0, 10, i),
          channel: s.channel === "email" ? "email" : "linkedin",
          type: (s.type === "connection_request" || s.type === "dm" || s.type === "email") ? s.type : "dm",
          delay_days: clampInt(s.delay_days, 0, 30, i * 2),
          subject: s.subject ? String(s.subject).slice(0, 200) : undefined,
          body: String(s.body ?? "").slice(0, 1000),
        }))
      : [],
  };
}

/** Fallback when AI is unavailable — wraps the existing canned pool. */
export function fallbackPayload(
  scrape: ScrapedBio,
  industryPreset: DemoIndustryKey,
  counts: { leads: number; icps: number; campaigns: number }
): AiPayload {
  return {
    language: detectLanguage(scrape),
    leads: pickSeedLeads(industryPreset, counts.leads),
    icps: [], // populateDemo's existing icpTemplates handles this branch
    campaigns: [], // ditto for canned campaign sequences
  };
}
