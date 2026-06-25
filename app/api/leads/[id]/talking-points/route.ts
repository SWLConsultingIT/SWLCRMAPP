import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { fetchLinkedInProfileFull, linkedinIdentifier, fullProfileHasSignal, renderFullLinkedInBlock } from "@/lib/linkedin-profile";
import { resolveUnipileAccount } from "@/lib/unipile-account";

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
type PointType = "snapshot" | "account" | "read" | "pain" | "fit" | "hook" | "opener" | "objection";
type TalkingPoint = { type: PointType; text: string };

// Canonical render order so the brief always reads the same regardless of the
// order the model emits the objects in. Flow: who they are → their company &
// what to pitch it → how to talk to this person → pain/fit/hook/opener/objection.
const POINT_ORDER: PointType[] = ["snapshot", "account", "read", "pain", "fit", "hook", "opener", "objection"];

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const locale: string = (body as any).locale ?? "en";
  const langInstruction = locale === "es"
    ? "Write ALL content in Spanish (río-platense if Argentina, neutral otherwise). The seller's interface is in Spanish — the brief must be readable in Spanish."
    : "Write ALL content in English.";

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
      const profile = await fetchLinkedInProfileFull(identifier, accountId);
      if (fullProfileHasSignal(profile)) liBlock = renderFullLinkedInBlock(profile);
    }
  }

  const points = await generate({ lead, icpContext, liBlock, apiKey, langInstruction });
  if (!points || points.length === 0) {
    return NextResponse.json({ error: "AI call failed" }, { status: 500 });
  }

  await svc.from("leads")
    .update({ call_talking_points: points, call_talking_points_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, points });
}

async function generate({ lead, icpContext, liBlock, apiKey, langInstruction }: {
  lead: Record<string, unknown>;
  icpContext: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null;
  liBlock: string | null;
  apiKey: string;
  langInstruction: string;
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

  // The PERSON section (LinkedIn-anchored when available).
  const profileSection = liBlock
    ? liBlock
    : `PERSON (no personal LinkedIn available — infer them from their role + the company below)
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}`;

  // The COMPANY section — always present so the "account angle" card can map
  // our solutions to their industry, tech stack and size, even when we have a
  // rich personal profile.
  const companySize = [
    lead.company_employees ? `${lead.company_employees} employees` : "",
    lead.company_revenue ? `revenue ${lead.company_revenue}` : "",
  ].filter(Boolean).join(", ");
  const techStack = (() => {
    const t = (enrichment.technologies ?? enrichment.tech_stack ?? enrichment.keywords) as unknown;
    if (Array.isArray(t)) return t.slice(0, 20).join(", ");
    if (typeof t === "string") return t.slice(0, 300);
    return "";
  })();
  const companySection = `COMPANY (for the ACCOUNT ANGLE — map our solutions to their industry, size and stack)
${companyLines || `- Company: ${lead.company_name ?? "—"}`}${companySize ? `\n- Size: ${companySize}` : ""}${techStack ? `\n- Tech stack / keywords: ${techStack}` : ""}`;

  const prompt = `You are a senior B2B SDR coach prepping a seller who dials ${name} in 30 seconds. Build a SHORT but genuinely personalized pre-call brief, grounded in the lead's real profile below. The seller reads it verbatim before pressing dial. Generic lines are useless — every point must cite something specific about THIS person or company (a role, tenure, a prior employer, their school, a skill, a post, an enrichment signal).

LEAD
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}
- Industry: ${lead.company_industry ?? "—"}
- Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ") || "—"}
${lead.seller_notes ? `- Notes: ${lead.seller_notes}` : ""}

${profileSection}

${companySection}

ENRICHMENT DATA (use these specific signals)
${enrichmentDump || "(none)"}

${icpContext ? `WHAT WE SELL
- Offering: ${icpContext.solutions_offered ?? ""}
- Pain we solve: ${icpContext.pain_points ?? ""}` : ""}

TASK
Return ONLY a JSON array of objects {type, text}, one per type, in this order:
[
  { "type": "snapshot",  "text": "<who they are in one line: current role @ company, ~tenure (infer from dates), seniority, location — ≤170 chars>" },
  { "type": "account",   "text": "<the ACCOUNT ANGLE: what THIS company does in one phrase + the single most relevant thing we could do for a company in their industry/size/stack, mapping OUR solutions. Concrete, e.g. 'construction developer → automate internal project & vendor workflows / score which bids to chase'. ≤210 chars>" },
  { "type": "read",      "text": "<HOW TO TALK TO THIS PERSON: a quick sales-psychology read from their role, seniority, background and tenure — what they likely care about, their communication style, and one DO + one DON'T. ≤210 chars>" },
  { "type": "pain",      "text": "<the most likely problem THIS person fights, tied to their role/industry and a profile signal — a problem, not a feature, ≤190 chars>" },
  { "type": "fit",       "text": "<why our offering maps to that pain for them specifically — name our solution AND one of their signals, ≤190 chars>" },
  { "type": "hook",      "text": "<one concrete human detail to open rapport: a recent job change/tenure, a prior employer, their school, a notable skill/cert, or a recent post — name the exact detail, ≤190 chars>" },
  { "type": "opener",    "text": "<a verbatim opening line the seller says out loud that USES the hook above — natural, ends with a question, ≤190 chars>" },
  { "type": "objection", "text": "<the most likely pushback for their role + a one-line counter, ≤170 chars>" }
]

Rules:
- Ground EVERY line in the data above. Any fact you state (tenure, prior company, school, skill, tech stack) must come from the profile/company/enrichment — NEVER invent specifics or names.
- "account": map OUR solutions to THEIR industry, size and stack. Generic-by-industry is fine, but name what we'd actually do for a company like theirs — not a vague benefit.
- "read": use real sales psychology. Adapt to seniority (Director/CxO = strategic, time-poor, outcome-driven; manager = execution/relief-driven), background (partnerships/sales = relationship-led; engineering/ops = detail & proof-led), and tenure (new in seat = wants quick wins to prove themselves). Make it actionable (a do + a don't), never fluffy.
- If the current role started recently (under ~12 months per the dates), lead the hook with that "new in seat" angle — it's the strongest opener.
- ${langInstruction}
- Plain text inside strings: no markdown, no fences, no surrounding quotes, no leading numbers.
- NEVER refuse, NEVER ask for more info, NEVER reply in prose. If data is genuinely thin, still return snapshot/pain/fit/opener, and OMIT the account/read/hook/objection objects rather than inventing fake specifics.
- Output ONLY the JSON array.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: "You output ONLY a JSON array of pre-call brief objects {type, text}. You never refuse, never ask for more information, and never write prose — sparse input still yields a useful role-based brief grounded only in the data given.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    // Tolerate models that wrap the array in prose or fence it.
    const match = text.match(/\[[\s\S]*\]/);
    const json = match ? match[0] : text;
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set<string>(POINT_ORDER);
    const byType = new Map<PointType, TalkingPoint>();
    for (const p of parsed) {
      if (!p || typeof p !== "object") continue;
      const t = (p as any).type, txt = (p as any).text;
      if (typeof t !== "string" || typeof txt !== "string") continue;
      if (!allowed.has(t) || byType.has(t as PointType)) continue; // first wins, dedupe by type
      const clean = txt.trim();
      if (clean) byType.set(t as PointType, { type: t as PointType, text: clean });
    }
    const cleaned = POINT_ORDER.filter((t) => byType.has(t)).map((t) => byType.get(t)!);
    // The brief is only useful with the three core points; hook/snapshot/
    // objection are enrichment on top.
    const hasCore = ["pain", "fit", "opener"].every((t) => byType.has(t as PointType));
    return hasCore ? cleaned : null;
  } catch {
    return null;
  }
}
