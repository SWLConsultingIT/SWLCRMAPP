import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// POST /api/companies/hooks — distills every enrichment field on a lead
// into 3–5 punchy "call hooks" the seller can open with. Sellers were
// burning 20–30 minutes per call digging through the portfolio site
// looking for an angle (Fran 2026-06-01 pending-tasks #3). This is the
// concierge version: same data we already display in the company tabs,
// summarized as ready-to-read bullets.
//
// No caching layer — generation is on-demand. Cost is one Haiku call
// (cheap), the client caches in component state + localStorage so
// re-opening the page doesn't burn another call until the seller hits
// Refresh.
//
// Body: { leadId: string }
// Returns: { hooks: string[] } (empty if not enough enrichment data)

type LeadEnrichment = {
  company_name?: string | null;
  organization_description?: string | null;
  organization_short_desc?: string | null;
  organization_tagline?: string | null;
  organization_seo_desc?: string | null;
  organization_technologies?: string[] | null;
  company_industry?: string | null;
  company_sub_industry?: string | null;
  employees?: number | string | null;
  annual_revenue?: number | string | null;
  company_mission?: string | null;
  recent_website_news?: string | null;
  website_summary?: string | null;
  recent_linkedin_post?: string | null;
  company_linkedin_post?: string | null;
  company_blog?: string | null;
  industry_trends?: string | null;
  google_reviews_rating?: number | null;
};

function buildPrompt(l: LeadEnrichment): string {
  const lines: string[] = [];
  if (l.company_name) lines.push(`Company: ${l.company_name}`);
  if (l.company_industry) lines.push(`Industry: ${l.company_industry}${l.company_sub_industry ? ` / ${l.company_sub_industry}` : ""}`);
  if (l.employees) lines.push(`Headcount: ${l.employees}`);
  if (l.annual_revenue) lines.push(`Revenue: ${l.annual_revenue}`);
  if (l.organization_tagline) lines.push(`Tagline: ${l.organization_tagline}`);
  if (l.organization_short_desc ?? l.organization_description) {
    lines.push(`Description: ${l.organization_short_desc ?? l.organization_description}`);
  }
  if (l.organization_seo_desc) lines.push(`SEO description: ${l.organization_seo_desc}`);
  if (l.company_mission) lines.push(`Mission: ${l.company_mission}`);
  if (Array.isArray(l.organization_technologies) && l.organization_technologies.length > 0) {
    lines.push(`Tech stack: ${l.organization_technologies.slice(0, 12).join(", ")}`);
  }
  if (l.recent_website_news) lines.push(`Recent website news: ${l.recent_website_news}`);
  if (l.recent_linkedin_post ?? l.company_linkedin_post) lines.push(`Recent LinkedIn post: ${l.recent_linkedin_post ?? l.company_linkedin_post}`);
  if (l.website_summary) lines.push(`Website keywords: ${l.website_summary}`);
  if (l.industry_trends) lines.push(`Industry trends: ${l.industry_trends}`);
  if (l.google_reviews_rating) lines.push(`Google rating: ${l.google_reviews_rating}/5`);
  return lines.join("\n");
}

const SYSTEM = `You are a senior B2B sales rep distilling research into 3 to 5 short,
specific call hooks. A "hook" is a one-liner the seller can drop in the first
30 seconds of a call to prove they did their homework and earn the right to ask
a question. Hooks must be:
- Concrete: reference a specific fact (a product, a market move, a hire, a
  technology, a number) — never generic ("you're growing").
- Bridgeable: each hook implies a follow-up question or angle to explore.
- Independent: each hook stands on its own, no overlap.
- Short: ideally 12–22 words.

Return strict JSON: {"hooks": ["...", "...", ...]}. No prose. No markdown
fencing. 3–5 entries. Empty array if the input is too thin to support hooks.`;

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { leadId } = (await req.json().catch(() => ({}))) as { leadId?: string };
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const svc = getSupabaseService();
  const { data: lead, error } = await svc
    .from("leads")
    .select(`
      id, company_bio_id,
      company_name, company_industry, company_sub_industry,
      employees, annual_revenue,
      organization_tagline, organization_description, organization_short_desc,
      organization_seo_desc, organization_technologies, company_mission,
      recent_website_news, recent_linkedin_post, company_linkedin_post,
      website_summary, industry_trends, google_reviews_rating
    `)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const research = buildPrompt(lead as LeadEnrichment);
  if (research.trim().length < 40) {
    // Not enough enrichment to bother calling Haiku — the prompt
    // wouldn't surface anything beyond generic platitudes.
    return NextResponse.json({ hooks: [], reason: "insufficient_enrichment" });
  }

  const client = new Anthropic({ apiKey });
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: `Research dump:\n\n${research}\n\nProduce the JSON now.` }],
    });
    const text = msg.content
      .filter(c => c.type === "text")
      .map(c => (c as { type: "text"; text: string }).text)
      .join("");
    let parsed: { hooks?: unknown };
    try { parsed = JSON.parse(text); } catch {
      // Best-effort recovery — model sometimes wraps in ``` despite the
      // system prompt forbidding it. Strip fences and retry.
      const stripped = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, "$1").trim();
      try { parsed = JSON.parse(stripped); } catch {
        return NextResponse.json({ error: "model returned non-JSON", raw: text.slice(0, 200) }, { status: 502 });
      }
    }
    const hooks = Array.isArray(parsed.hooks) ? parsed.hooks.filter((h): h is string => typeof h === "string" && h.trim().length > 0).slice(0, 5) : [];
    return NextResponse.json({ hooks });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Haiku call failed" }, { status: 500 });
  }
}
