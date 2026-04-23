import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: lead } = await svc.from("leads").select("*").eq("id", id).single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  let icpContext: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null = null;
  if (lead.icp_profile_id) {
    const { data: icp } = await svc
      .from("icp_profiles")
      .select("profile_name, solutions_offered, pain_points")
      .eq("id", lead.icp_profile_id)
      .single();
    icpContext = icp;
  }

  const summary = await generate({ lead, icpContext, apiKey });
  if (!summary) return NextResponse.json({ error: "AI call failed" }, { status: 500 });

  await svc.from("leads")
    .update({ ai_summary: summary, ai_summary_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, summary });
}

async function generate({ lead, icpContext, apiKey }: {
  lead: Record<string, unknown>;
  icpContext: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null;
  apiKey: string;
}) {
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
  const enrichment = (lead.enrichment as Record<string, unknown> | null) ?? {};
  const enrichmentDump = Object.entries(enrichment)
    .filter(([k, v]) => k !== "source_file" && v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const prompt = `You are a B2B sales intelligence analyst. Write a concise, useful summary paragraph of the lead below — the kind of thing an AE reads in 10 seconds before a call.

LEAD
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}
- Industry: ${lead.company_industry ?? "—"}
- Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ") || "—"}
${lead.primary_headline ? `- LinkedIn headline: ${lead.primary_headline}` : ""}
${lead.primary_career ? `- Career: ${lead.primary_career}` : ""}
${lead.seller_notes ? `- Notes: ${lead.seller_notes}` : ""}

ENRICHMENT DATA (client-specific signals — use these to craft a sharp angle)
${enrichmentDump || "(none)"}

${icpContext ? `CLIENT CONTEXT
- Offering: ${icpContext.solutions_offered ?? ""}
- Pain they solve: ${icpContext.pain_points ?? ""}` : ""}

TASK
Write ONE paragraph (80-140 words, plain text, no markdown, no bullet points, no headers) that:
1. Names the person and their role at the company.
2. Surfaces the 2-3 strongest signals from the enrichment data that make them a fit (be specific — cite numbers/ratings).
3. Suggests the single best outreach angle given those signals and the client's offering.
Do not repeat data the reader can already see in a table — synthesize.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    return text.trim() || null;
  } catch {
    return null;
  }
}
