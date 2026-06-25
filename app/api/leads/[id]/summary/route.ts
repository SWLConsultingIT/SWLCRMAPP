import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { fetchLinkedInProfileFull, linkedinIdentifier, fullProfileHasSignal, renderFullLinkedInBlock } from "@/lib/linkedin-profile";
import { resolveUnipileAccount } from "@/lib/unipile-account";

// Deep-dive research — the long-form companion to the 30-second Pre-Call Brief.
// Where the brief is glanceable cards before a dial, this is a multi-section
// dossier for prep / account planning: company deep-dive, why-now, account
// strategy, a suggested multi-touch sequence, and watch-outs. Anchored on the
// lead's LinkedIn profile + company + our solutions, not just the enrichment
// dump like the old single-paragraph summary.
//
// Stored as a JSON array of {heading, body} in `leads.ai_summary` (a text
// column). The component parses it; legacy plain-text summaries still render.

type Section = { heading: string; body: string };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const locale: string = (body as any).locale ?? "en";
  const langInstruction = locale === "es"
    ? "Write ALL content in Spanish (río-platense if Argentina, neutral otherwise). Section headings must also be in Spanish."
    : "Write ALL content in English.";

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: leadRow } = await svc.from("leads").select("*").eq("id", id).single();
  if (!leadRow) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Decrypt client-source PII so the dossier isn't blank for those tenants.
  let lead: Record<string, unknown> = leadRow;
  if (leadRow.source === "client" && leadRow.encrypted_payload && leadRow.company_bio_id) {
    try {
      const { key } = await resolveTenantKey(leadRow.company_bio_id as string);
      const decrypted = decryptWithResolvedKey(bufferFromSupabaseBytea(leadRow.encrypted_payload), key);
      lead = { ...leadRow, ...decrypted };
    } catch (e) {
      console.error("[deep-dive] decrypt failed for lead", id, e);
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

  // Our own value prop (so "account strategy" maps what we actually sell).
  let bio: { value_proposition?: string; main_services?: string } | null = null;
  if (lead.company_bio_id) {
    const { data: b } = await svc
      .from("company_bios")
      .select("value_proposition, main_services")
      .eq("id", lead.company_bio_id as string)
      .single();
    bio = b;
  }

  // LinkedIn profile — one view, human pace (same safety rule as the brief).
  let liBlock: string | null = null;
  const identifier = linkedinIdentifier(lead.linkedin_internal_id as string | null, lead.primary_linkedin_url as string | null);
  if (identifier && lead.company_bio_id) {
    const accountId = await resolveUnipileAccount(svc, lead.company_bio_id as string, lead.linkedin_assigned_account as string | null);
    if (accountId) {
      const profile = await fetchLinkedInProfileFull(identifier, accountId);
      if (fullProfileHasSignal(profile)) liBlock = renderFullLinkedInBlock(profile);
    }
  }

  const sections = await generate({ lead, icpContext, bio, liBlock, apiKey, langInstruction });
  if (!sections || sections.length === 0) return NextResponse.json({ error: "AI call failed" }, { status: 500 });

  const stored = JSON.stringify(sections);
  await svc.from("leads")
    .update({ ai_summary: stored, ai_summary_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, summary: stored });
}

async function generate({ lead, icpContext, bio, liBlock, apiKey, langInstruction }: {
  lead: Record<string, unknown>;
  icpContext: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null;
  bio: { value_proposition?: string; main_services?: string } | null;
  liBlock: string | null;
  apiKey: string;
  langInstruction: string;
}): Promise<Section[] | null> {
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "the lead";
  const enrichment = (lead.enrichment as Record<string, unknown> | null) ?? {};
  const enrichmentDump = Object.entries(enrichment)
    .filter(([k, v]) => k !== "source_file" && v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const companyLines = [
    lead.company_name ? `- Company: ${lead.company_name}` : "",
    [lead.company_industry, lead.company_sub_industry].filter(Boolean).length ? `- Industry: ${[lead.company_industry, lead.company_sub_industry].filter(Boolean).join(" · ")}` : "",
    [lead.company_city, lead.company_country].filter(Boolean).length ? `- Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ")}` : "",
    (lead.employees ?? lead.company_employee_count) ? `- Size: ${lead.employees ?? lead.company_employee_count} employees` : "",
    lead.annual_revenue ? `- Revenue: $${lead.annual_revenue}` : "",
    lead.company_website ? `- Website: ${lead.company_website}` : "",
    lead.organization_description ? `- Description: ${String(lead.organization_description).slice(0, 600)}` : "",
    lead.recent_linkedin_post ? `- Their recent post: ${String(lead.recent_linkedin_post).slice(0, 300)}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `You are a senior B2B account researcher writing a deep-dive prep dossier for a SELLER who is about to work this prospect. ~5 minutes of prep, not a 30-second summary.

There are TWO different companies — DO NOT mix them up:
  • THE PROSPECT'S COMPANY = "${lead.company_name ?? "the prospect's company"}" — the company we are selling TO. The dossier is ABOUT them.
  • OUR OFFERING = what the seller sells, used ONLY to figure out how to pitch the prospect. NEVER describe the prospect's company as if it were our product.

THE PROSPECT
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}
${lead.seller_notes ? `- Seller notes: ${lead.seller_notes}` : ""}

${liBlock ?? "PERSON: no personal LinkedIn available — infer from role + company; do not invent past employers."}

THE PROSPECT'S COMPANY — "${lead.company_name ?? "—"}" (what THEY do; this is who we sell to)
${companyLines || `- Company: ${lead.company_name ?? "—"}`}

ENRICHMENT DATA (signals about the prospect / their company)
${enrichmentDump || "(none)"}

OUR OFFERING (the seller's product — only for the Account-strategy mapping; this is NOT the prospect's company)
- Offering: ${icpContext?.solutions_offered ?? bio?.main_services ?? ""}
- Value prop: ${bio?.value_proposition ?? ""}
- Pain we solve: ${icpContext?.pain_points ?? ""}

TASK
Return ONLY a JSON array of {"heading","body"} sections, in this order:
[
  { "heading": "Company deep-dive", "body": "<what THE PROSPECT'S company (${lead.company_name ?? "—"}) actually does — their business, market, size/stack — based ONLY on the data above. NOT our product. 2-3 sentences.>" },
  { "heading": "Why now", "body": "<timing triggers from the data — tenure/role change, hiring, a post. 1-2 sentences. Omit if nothing real.>" },
  { "heading": "Account strategy", "body": "<how OUR offering maps to THIS prospect's company specifically + the value thesis. 2-3 sentences.>" },
  { "heading": "Suggested sequence", "body": "<3-4 bullet lines, each '- ' + channel + the one thing to say, grounded in their real situation.>" },
  { "heading": "Watch-outs", "body": "<1-3 '- ' bullet lines: likely objections/risks for this persona.>" }
]

LANGUAGE RULE: ${langInstruction}

HARD RULES — accuracy over detail:
- Use ONLY facts present in the data above. Do NOT invent metrics, ARR, customers, partners, competitors, or relationships. If a fact isn't given, don't state it.
- You may name a company as the prospect's employer/partner/customer ONLY if it appears VERBATIM in the data above (e.g. in their LinkedIn experience). Otherwise refer generically — "a prior role", "their background" — and NEVER guess a brand name.
- Never describe the prospect's company using OUR offering's words (lead scoring, sequencing, ICP, etc.) unless the data literally says so.
- A short, accurate dossier beats a long, embellished one. No filler.
- "body" is plain text ('- ' bullets where indicated, \\n between them). No markdown headers, no surrounding quotes.
- Output ONLY the JSON array.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2200,
      temperature: 0.3,
      system: "You output ONLY a JSON array of {heading, body} research sections grounded strictly in the data given. You never invent company names, employers, customers or metrics not present in the input. Never refuse, never write prose outside the JSON.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : text);
    if (!Array.isArray(parsed)) return null;
    const cleaned: Section[] = parsed
      .filter((s): s is { heading: string; body: string } =>
        !!s && typeof s === "object" && typeof (s as any).heading === "string" && typeof (s as any).body === "string")
      .map((s) => ({ heading: s.heading.trim(), body: s.body.trim() }))
      .filter((s) => s.heading && s.body);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}
