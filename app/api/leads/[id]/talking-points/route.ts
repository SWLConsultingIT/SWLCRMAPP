import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { fetchLinkedInProfile, linkedinIdentifier, profileHasSignal, renderLinkedInBlock } from "@/lib/linkedin-profile";

// Picks a connected LinkedIn account to view the profile through. Prefers the
// seller the lead is assigned to (linkedin_assigned_account holds a name);
// otherwise any active seller in the tenant with a Unipile account.
async function resolveUnipileAccount(
  svc: ReturnType<typeof getSupabaseService>,
  companyBioId: string,
  assignedName: string | null,
): Promise<string | null> {
  const { data: sellers } = await svc
    .from("sellers")
    .select("name, unipile_account_id, company_bio_id, shared_with_company_bio_ids, active")
    .eq("active", true)
    .or(`company_bio_id.eq.${companyBioId},shared_with_company_bio_ids.cs.{${companyBioId}}`);
  const rows = (sellers ?? []).filter((s: any) => s.unipile_account_id);
  if (rows.length === 0) return null;
  if (assignedName) {
    const match = rows.find((s: any) => (s.name ?? "").toLowerCase() === assignedName.toLowerCase());
    if (match) return match.unipile_account_id as string;
  }
  return rows[0].unipile_account_id as string;
}

// GET → return cached talking points (or null if not generated yet).
// POST → (re)generate and persist. The Pre-Call Brief card calls POST on
// first view (lazy) and again on explicit "Refresh" — same endpoint.
//
// Talking points live in their own column (not inside ai_summary) because
// they're operational copy meant for the 30s before a dial, while ai_summary
// is longer-form research. Schema: array of 3 short strings.

// Structured talking point. Each call brief has exactly three, one per type:
// - pain: a problem this specific lead is likely fighting today
// - fit:  why our offering maps to that pain for them in particular
// - opener: a literal opening line or question the seller can drop verbatim
//
// Backward compat: legacy rows persisted as `string[]` are rendered as
// generic numbered points by the client.
type TalkingPoint = { type: "pain" | "fit" | "opener"; text: string };

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
    points: (lead as any).call_talking_points,
    generatedAt: (lead as any).call_talking_points_at as string | null,
  });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: leadRow } = await svc.from("leads").select("*").eq("id", id).single();
  if (!leadRow) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Client-source leads keep PII (name, title, company, enrichment) in
  // encrypted_payload — the plain columns are NULL. Without decrypting, the
  // prompt had nothing to work with and the model refused ("I don't have
  // enough information"), so client-source leads never got a brief. Decrypt
  // and merge so the brief is as good as for any other lead.
  let lead: Record<string, unknown> = leadRow;
  if (leadRow.source === "client" && leadRow.encrypted_payload && leadRow.company_bio_id) {
    try {
      const { key } = await resolveTenantKey(leadRow.company_bio_id as string);
      const decrypted = decryptWithResolvedKey(bufferFromSupabaseBytea(leadRow.encrypted_payload), key);
      lead = { ...leadRow, ...decrypted };
    } catch (e) {
      console.error("[talking-points] decrypt failed for lead", id, e);
    }
  }

  let icpContext: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null = null;
  if (lead.icp_profile_id) {
    const { data: icp } = await svc
      .from("icp_profiles")
      .select("profile_name, solutions_offered, pain_points")
      .eq("id", lead.icp_profile_id as string)
      .single();
    icpContext = icp;
  }

  // Pull the lead's LinkedIn profile so the brief is anchored on their own
  // headline / About / experience / skills rather than thin CRM columns. One
  // profile view per brief, at human pace — never batch this (account safety).
  // Falls back to company info (handled in the prompt) when there's no
  // LinkedIn handle or the fetch yields nothing.
  let liBlock: string | null = null;
  const identifier = linkedinIdentifier(lead.linkedin_internal_id as string | null, lead.primary_linkedin_url as string | null);
  if (identifier && lead.company_bio_id) {
    const accountId = await resolveUnipileAccount(svc, lead.company_bio_id as string, lead.linkedin_assigned_account as string | null);
    if (accountId) {
      const profile = await fetchLinkedInProfile(identifier, accountId);
      if (profileHasSignal(profile)) liBlock = renderLinkedInBlock(profile);
    }
  }

  const points = await generate({ lead, icpContext, liBlock, apiKey });
  if (!points || points.length === 0) {
    return NextResponse.json({ error: "AI call failed" }, { status: 500 });
  }

  await svc.from("leads")
    .update({ call_talking_points: points, call_talking_points_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, points });
}

async function generate({ lead, icpContext, liBlock, apiKey }: {
  lead: Record<string, unknown>;
  icpContext: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null;
  liBlock: string | null;
  apiKey: string;
}): Promise<TalkingPoint[] | null> {
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "the lead";
  const enrichment = (lead.enrichment as Record<string, unknown> | null) ?? {};
  const enrichmentDump = Object.entries(enrichment)
    .filter(([k, v]) => k !== "source_file" && v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  // Company fallback — used when there's no LinkedIn profile to anchor on
  // (Fran 2026-06-05: "si no tiene linkedin, sumar info de la empresa").
  const companyLines = [
    lead.company_name ? `- Company: ${lead.company_name}` : "",
    lead.company_industry ? `- Industry: ${lead.company_industry}` : "",
    [lead.company_city, lead.company_country].filter(Boolean).length ? `- Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ")}` : "",
    lead.company_linkedin ? `- Company LinkedIn: ${lead.company_linkedin}` : "",
    lead.website_summary ? `- Website summary: ${String(lead.website_summary).slice(0, 500)}` : "",
    lead.company_linkedin_post ? `- Recent company post: ${String(lead.company_linkedin_post).slice(0, 300)}` : "",
    lead.recent_linkedin_post ? `- Recent post: ${String(lead.recent_linkedin_post).slice(0, 300)}` : "",
  ].filter(Boolean).join("\n");

  const profileSection = liBlock
    ? liBlock
    : `COMPANY CONTEXT (no personal LinkedIn available — anchor on the company)
${companyLines || `- Company: ${lead.company_name ?? "—"}`}`;

  const prompt = `You are a senior B2B SDR coach. The seller dials ${name} in 30 seconds. Generate a tight call brief: one likely pain, one fit reason, one opening line. They will literally read your output before pressing dial.

LEAD
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}
- Industry: ${lead.company_industry ?? "—"}
- Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ") || "—"}
${lead.seller_notes ? `- Notes: ${lead.seller_notes}` : ""}

${profileSection}

ENRICHMENT DATA (use these specific signals)
${enrichmentDump || "(none)"}

${icpContext ? `WHAT WE SELL
- Offering: ${icpContext.solutions_offered ?? ""}
- Pain we solve: ${icpContext.pain_points ?? ""}` : ""}

TASK
Return EXACTLY this JSON shape, nothing else:
[
  { "type": "pain",   "text": "<one pain this lead is likely fighting given role + company signals — ≤140 chars, concrete>" },
  { "type": "fit",    "text": "<why our offering maps to that pain for THIS lead specifically — cite an enrichment data point, ≤140 chars>" },
  { "type": "opener", "text": "<a literal opening line or question the seller can say verbatim, ≤140 chars, ends with a question mark when natural>" }
]

Rules:
- Plain text inside the strings (no markdown, no quotes around the values, no leading numbers).
- Pain must be a problem, not a feature. Fit must be a relevance claim, not a sales pitch. Opener must be something a human would actually say.
- Use the lead's first name in the opener if you have it.
- Output ONLY the JSON array. No prose, no fences.
- ALWAYS return the three points. NEVER refuse, NEVER ask for more information, NEVER reply in prose. If the lead data is sparse, infer sensible points from whatever you have — the role, the industry, the company name, or what we sell — falling back to solid role-based generics for that seniority. There is always enough to write a useful brief.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: "You output ONLY a JSON array of exactly three objects {type, text}. You never refuse, never ask for more information, and never write prose — sparse input still yields a useful role-based brief.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    // Tolerate models that wrap the array in prose or fence it.
    const match = text.match(/\[[\s\S]*\]/);
    const json = match ? match[0] : text;
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const allowedTypes = new Set(["pain", "fit", "opener"]);
    const cleaned: TalkingPoint[] = parsed
      .filter((p): p is { type: string; text: string } =>
        !!p && typeof p === "object" &&
        typeof (p as any).type === "string" &&
        typeof (p as any).text === "string")
      .filter((p) => allowedTypes.has(p.type))
      .map((p) => ({ type: p.type as TalkingPoint["type"], text: p.text.trim() }))
      .filter((p) => p.text.length > 0)
      .slice(0, 3);
    return cleaned.length === 3 ? cleaned : null;
  } catch {
    return null;
  }
}
