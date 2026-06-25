import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";

// Free company-site scraper for a lead — no Tavily/Apify. The server fetches the
// company homepage (+ a couple of common About/Services subpages), strips the
// HTML to text, and Haiku summarises "what they do" + core services. Result is
// stored on leads.company_scrape and surfaced in the Company section. Only cost
// is the LLM call we already use elsewhere.

const fetchPage = async (target: string, ms: number): Promise<string> => {
  try {
    const r = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SWLBot/1.0)" }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
};

const stripHtml = (raw: string): string => raw
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
  .replace(/<svg[\s\S]*?<\/svg>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const { id } = await params;
  const svc = getSupabaseService();
  const { data: lead } = await svc.from("leads").select("company_website, company_name, company_industry").eq("id", id).single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const raw = (lead as any).company_website as string | null;
  if (!raw) return NextResponse.json({ error: "No company website on this lead" }, { status: 422 });
  const url = raw.startsWith("http") ? raw : `https://${raw}`;

  let origin = url;
  try { origin = new URL(url).origin; } catch { /* keep raw */ }

  const home = await fetchPage(url, 10000);
  if (!home) return NextResponse.json({ error: "Could not reach the website" }, { status: 422 });
  const subs = await Promise.all([
    `${origin}/about`, `${origin}/services`, `${origin}/nosotros`, `${origin}/servicios`,
  ].map((t) => fetchPage(t, 6000)));

  const text = [home, ...subs].map(stripHtml).filter((t) => t.length > 100).join("\n\n").slice(0, 11000);
  if (text.length < 80) return NextResponse.json({ error: "The site returned no readable content (likely JS-only or bot-blocked)" }, { status: 422 });

  const prompt = `From this company's website text, extract what they actually do. Company: ${lead.company_name ?? "?"}${lead.company_industry ? ` (${lead.company_industry})` : ""}.

WEBSITE TEXT
${text}

Return ONLY JSON: {"summary":"<2-3 sentences: what the company does, who they serve, how — grounded only in the text>","services":["<up to 6 core offerings/services named on the site>"]}
Use only the text above. No markdown, no prose outside the JSON.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      temperature: 0.2,
      system: "You output ONLY a JSON object {summary, services[]} grounded strictly in the provided website text. Never invent facts.",
      messages: [{ role: "user", content: prompt }],
    });
    const out = res.content[0].type === "text" ? res.content[0].text : "";
    const m = out.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : out);
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const services = Array.isArray(parsed.services) ? parsed.services.filter((s: unknown) => typeof s === "string" && (s as string).trim()).slice(0, 6) : [];
    if (!summary) return NextResponse.json({ error: "Could not summarise the site" }, { status: 500 });

    const scrape = { summary, services, scraped_at: new Date().toISOString(), source_url: url };
    await svc.from("leads").update({ company_scrape: scrape }).eq("id", id);
    return NextResponse.json({ ok: true, scrape });
  } catch (e) {
    console.error("[scrape-company] failed", id, e);
    return NextResponse.json({ error: "AI summary failed" }, { status: 500 });
  }
}
