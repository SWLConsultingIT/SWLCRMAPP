import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";

// GET → return cached talking points (or null if not generated yet).
// POST → (re)generate and persist. The Pre-Call Brief card calls POST on
// first view (lazy) and again on explicit "Refresh" — same endpoint.
//
// Talking points live in their own column (not inside ai_summary) because
// they're operational copy meant for the 30s before a dial, while ai_summary
// is longer-form research. Schema: array of 3 short strings.

type TalkingPoint = string;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const svc = getSupabaseService();
  const { data: lead } = await svc
    .from("leads")
    .select("call_talking_points, call_talking_points_at")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  return NextResponse.json({
    points: (lead as any).call_talking_points as TalkingPoint[] | null,
    generatedAt: (lead as any).call_talking_points_at as string | null,
  });
}

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

  const points = await generate({ lead, icpContext, apiKey });
  if (!points || points.length === 0) {
    return NextResponse.json({ error: "AI call failed" }, { status: 500 });
  }

  await svc.from("leads")
    .update({ call_talking_points: points, call_talking_points_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, points });
}

async function generate({ lead, icpContext, apiKey }: {
  lead: Record<string, unknown>;
  icpContext: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null;
  apiKey: string;
}): Promise<TalkingPoint[] | null> {
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "the lead";
  const enrichment = (lead.enrichment as Record<string, unknown> | null) ?? {};
  const enrichmentDump = Object.entries(enrichment)
    .filter(([k, v]) => k !== "source_file" && v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const prompt = `You are a senior B2B SDR coach. The seller is about to dial ${name} in the next 30 seconds. Your job: surface the THREE strongest things to anchor that call on. No fluff, no preamble — they read your output literally seconds before pressing dial.

LEAD
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}
- Industry: ${lead.company_industry ?? "—"}
- Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ") || "—"}
${lead.primary_headline ? `- LinkedIn headline: ${lead.primary_headline}` : ""}
${lead.primary_career ? `- Career: ${lead.primary_career}` : ""}
${lead.seller_notes ? `- Notes: ${lead.seller_notes}` : ""}

ENRICHMENT DATA (use these specific signals)
${enrichmentDump || "(none)"}

${icpContext ? `WHAT WE SELL
- Offering: ${icpContext.solutions_offered ?? ""}
- Pain we solve: ${icpContext.pain_points ?? ""}` : ""}

TASK
Output exactly 3 talking points the seller should anchor on. Format as a JSON array of 3 strings, nothing else. Each string ≤ 140 chars, written as a direct fact + why-it-matters, plain text, no markdown, no leading numbers, no quotes around the string.

The 3 points should be a mix of:
1. The single sharpest fit signal (cite the specific enrichment number/data point)
2. The most credible reason to call them specifically (role, recent move, company event)
3. An opening hook or question that ties enrichment to our offering

Output ONLY the JSON array. Example shape: ["Point one ...","Point two ...","Point three ..."]`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    // Tolerate models that wrap the array in prose or fence it.
    const match = text.match(/\[[\s\S]*?\]/);
    const json = match ? match[0] : text;
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const cleaned = parsed
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, 3);
    return cleaned.length === 3 ? cleaned : null;
  } catch {
    return null;
  }
}
