import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

// Wizard "AI draft" endpoint. Used to be a proxy to the n8n V7 Pro
// generator (workflow Y3gQXLpaWjpP37XP) but it had two persistent
// problems: it ignored the wizard's `language` (kept slipping into
// English when the seller picked Spanish) and sometimes returned an
// empty body for the first step in a sequence.
//
// Both bugs traced back to the same place: n8n's generator was the only
// thing in the chain that owned the prompt + LLM call, so any drift
// there hit production. Replaced with a direct Claude Haiku call here
// — one model per step, language explicitly pinned, retries on empty
// output, and supports the new `flowType: "tailored"` mode that embeds
// {{tailored:hook}} + {{tailored:fit}} slots so the post-approve
// per-lead tailor pass has somewhere to inject the per-lead copy.

export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";

type SequenceMeta = { channel: string; daysAfter: number };
type FlowType = "generic" | "tailored";

type Body = {
  channel?: string;
  fieldType?: string;
  idx?: number;
  leadId?: string;
  icpProfileId?: string;
  companyBioId?: string;
  language?: string;
  signals?: string[];
  user_prompt?: string;
  sequence_meta?: SequenceMeta[];
  flowType?: FlowType;
};

type StepType =
  | "LINKEDIN_CONNECTION_REQUEST"
  | "LINKEDIN_INTRO_DM"
  | "LINKEDIN_FOLLOWUP_BUMP"
  | "LINKEDIN_FOLLOWUP_PROOF"
  | "LINKEDIN_FOLLOWUP_INTERRUPT"
  | "LINKEDIN_FOLLOWUP_BREAKUP"
  | "EMAIL_INTRO"
  | "EMAIL_FOLLOWUP"
  | "EMAIL_FOLLOWUP_CROSS"
  | "CALL_FIRST"
  | "CALL_FOLLOWUP"
  | "AUTO_REPLY_POSITIVE"
  | "AUTO_REPLY_NEGATIVE";

const STEP_LENGTH_HINT: Record<StepType, string> = {
  LINKEDIN_CONNECTION_REQUEST: "≤195 chars — one warm hook + ask to connect, NO pitch.",
  LINKEDIN_INTRO_DM: "≤120 words. Open with a specific observation about THEM, then one short value line, then ONE question. Sign off with {{seller_name}}.",
  LINKEDIN_FOLLOWUP_BUMP: "≤80 words. Light yes/no bump referencing your earlier note. End with a question. Sign off with {{seller_name}}.",
  LINKEDIN_FOLLOWUP_PROOF: "≤80 words. Concrete proof point or tangible offer (case study, asset, intro). End with a question. Sign off with {{seller_name}}.",
  LINKEDIN_FOLLOWUP_INTERRUPT: "≤80 words. Curiosity-open with a specific question that interrupts the silence. Sign off with {{seller_name}}.",
  LINKEDIN_FOLLOWUP_BREAKUP: "≤80 words. Polite breakup — closes the loop, leaves door open. Sign off with {{seller_name}}.",
  EMAIL_INTRO: "≤200 words body + a SUBJECT line (≤55 chars, no greeting). Opener pegs to the lead specifically, body shows the offer, close with ONE question. Sign off with {{seller_name}}.",
  EMAIL_FOLLOWUP: "≤150 words body + SUBJECT (≤55 chars). References the previous touch. End with a question. Sign off with {{seller_name}}.",
  EMAIL_FOLLOWUP_CROSS: "≤150 words body + SUBJECT (≤55 chars). Notes you're swinging to email after LinkedIn silence. End with a question. Sign off with {{seller_name}}.",
  CALL_FIRST: "120-160 words. Spoken phone script: warm opener using first name + reason for call, one open question, 2-line value pitch tied to their pain, close proposing a 15-min follow-up. Use {{first_name}}, {{company_name}}, {{seller_name}}.",
  CALL_FOLLOWUP: "120-160 words. Follow-up phone script referencing the prior touch. Use {{first_name}}, {{company_name}}, {{seller_name}}.",
  AUTO_REPLY_POSITIVE: "≤80 words. Warm, brief reply when the lead says YES / interested. Propose a concrete next step (link, time). Sign off with {{seller_name}}.",
  AUTO_REPLY_NEGATIVE: "≤60 words. Gracious reply when lead is not interested. Leaves door open, no push. Sign off with {{seller_name}}.",
};

const REPLY_MAP: Record<string, StepType> = {
  replyPositive: "AUTO_REPLY_POSITIVE",
  replyNegative: "AUTO_REPLY_NEGATIVE",
};

function resolveStepType(body: Body): StepType {
  const ft = body.fieldType;
  if (!ft) return "LINKEDIN_INTRO_DM";

  if (ft === "connectionNote" || ft === "LINKEDIN_CONNECTION_REQUEST") return "LINKEDIN_CONNECTION_REQUEST";
  if (ft === "LINKEDIN_INTRO_DM") return "LINKEDIN_INTRO_DM";
  if (ft === "EMAIL_INTRO") return "EMAIL_INTRO";
  if (ft === "EMAIL_FOLLOWUP_CROSS") return "EMAIL_FOLLOWUP_CROSS";
  if (ft === "EMAIL_FOLLOWUP") return "EMAIL_FOLLOWUP";
  if (ft === "CALL_FIRST") return "CALL_FIRST";
  if (ft === "CALL_FOLLOWUP") return "CALL_FOLLOWUP";
  if (REPLY_MAP[ft]) return REPLY_MAP[ft];

  if (ft === "LINKEDIN_FOLLOWUP") {
    const seqMeta = Array.isArray(body.sequence_meta) ? body.sequence_meta : [];
    const idx = typeof body.idx === "number" ? body.idx : 0;
    const liIdxs = seqMeta.map((s, i) => (s.channel === "linkedin" ? i : -1)).filter(i => i >= 0);
    const myPos = liIdxs.indexOf(idx);
    const totalLi = liIdxs.length;
    const isLast = myPos === totalLi - 1;
    if (myPos <= 0) return "LINKEDIN_INTRO_DM";
    if (myPos === 1) return isLast && totalLi >= 4 ? "LINKEDIN_FOLLOWUP_BREAKUP" : "LINKEDIN_FOLLOWUP_BUMP";
    if (myPos === 2) return isLast && totalLi >= 4 ? "LINKEDIN_FOLLOWUP_BREAKUP" : "LINKEDIN_FOLLOWUP_PROOF";
    return isLast && totalLi >= 4 ? "LINKEDIN_FOLLOWUP_BREAKUP" : "LINKEDIN_FOLLOWUP_INTERRUPT";
  }

  return "LINKEDIN_INTRO_DM";
}

// Output language. Default to ES — the user's default UX is rioplatense
// Spanish; English when explicitly chosen.
function describeLanguage(code?: string): string {
  switch ((code ?? "es").toLowerCase()) {
    case "es": return "Spanish (Argentine/rioplatense register — informal vos, never use tú)";
    case "en": return "English (US business register, plain, no fluff)";
    case "pt": return "Brazilian Portuguese (informal you/você, plain)";
    case "fr": return "French (vouvoiement, plain business)";
    case "de": return "German (Sie form, plain business)";
    case "it": return "Italian (Lei form, plain business)";
    default: return "English";
  }
}

type Lead = {
  primary_first_name?: string | null;
  primary_last_name?: string | null;
  primary_title_role?: string | null;
  primary_headline?: string | null;
  company_name?: string | null;
  company_industry?: string | null;
  company_size?: string | null;
  primary_linkedin_url?: string | null;
  organization_description?: string | null;
  organization_short_desc?: string | null;
  organization_technologies?: string | null;
  recent_website_news?: string | null;
  recent_linkedin_post?: string | null;
  company_linkedin_post?: string | null;
  industry_trends?: string | null;
  website_summary?: string | null;
  company_mission?: string | null;
  call_talking_points?: string | null;
  source?: string | null;
  encrypted_payload?: unknown;
  company_bio_id?: string | null;
};

type Icp = {
  profile_name?: string | null;
  pain_points?: string | null;
  solutions_offered?: string | null;
  target_industries?: string | null;
  target_roles?: string | null;
  notes?: string | null;
};

type Bio = {
  company_name?: string | null;
  tagline?: string | null;
  value_proposition?: string | null;
  differentiators?: string | null;
  main_services?: string | null;
  tone_of_voice?: string | null;
};

// Coerces ANY value into a clean trimmed string. Some lead enrichment
// columns (organization_technologies, recent_website_news, etc.) are
// stored as jsonb arrays/objects by ZoomInfo/Apollo ingestion, so a
// naive .trim() throws "e.trim is not a function". Stringify whatever
// comes in so the prompt always sees text, never throws.
function clampSig(s: unknown, max = 280): string {
  if (s == null) return "";
  const str = typeof s === "string"
    ? s
    : Array.isArray(s)
      ? s.filter(Boolean).join(", ")
      : typeof s === "object"
        ? JSON.stringify(s)
        : String(s);
  const trimmed = str.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() + "…" : trimmed;
}

function leadBlock(lead: Lead): string {
  const lines: string[] = [];
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim();
  if (name) lines.push(`Name: ${name}`);
  if (lead.primary_title_role) lines.push(`Role: ${lead.primary_title_role}`);
  if (lead.company_name) lines.push(`Company: ${lead.company_name}`);
  if (lead.company_industry) lines.push(`Industry: ${lead.company_industry}`);
  if (lead.company_size) lines.push(`Size: ${lead.company_size}`);
  if (lead.primary_headline) lines.push(`Headline: ${clampSig(lead.primary_headline, 200)}`);
  if (lead.organization_short_desc || lead.organization_description) lines.push(`What the company does: ${clampSig(lead.organization_short_desc ?? lead.organization_description ?? "", 300)}`);
  if (lead.website_summary) lines.push(`Website summary: ${clampSig(lead.website_summary, 300)}`);
  if (lead.company_mission) lines.push(`Mission: ${clampSig(lead.company_mission, 200)}`);
  if (lead.organization_technologies) lines.push(`Tech stack: ${clampSig(lead.organization_technologies, 250)}`);
  if (lead.recent_linkedin_post) lines.push(`Recent LinkedIn post (the lead's own): ${clampSig(lead.recent_linkedin_post, 400)}`);
  if (lead.company_linkedin_post) lines.push(`Recent company LinkedIn post: ${clampSig(lead.company_linkedin_post, 300)}`);
  if (lead.recent_website_news) lines.push(`Recent news: ${clampSig(lead.recent_website_news, 300)}`);
  if (lead.industry_trends) lines.push(`Industry trends: ${clampSig(lead.industry_trends, 250)}`);
  if (lead.call_talking_points) lines.push(`Pre-call talking points: ${clampSig(lead.call_talking_points, 300)}`);
  return lines.join("\n");
}

function icpBlock(icp: Icp | null): string {
  if (!icp) return "(no ICP context)";
  const lines: string[] = [];
  if (icp.profile_name) lines.push(`Targeting: ${icp.profile_name}`);
  if (icp.target_industries) lines.push(`Industries: ${icp.target_industries}`);
  if (icp.target_roles) lines.push(`Roles: ${icp.target_roles}`);
  if (icp.pain_points) lines.push(`Pain we solve: ${clampSig(icp.pain_points, 400)}`);
  if (icp.solutions_offered) lines.push(`What we offer: ${clampSig(icp.solutions_offered, 400)}`);
  if (icp.notes) lines.push(`Notes: ${clampSig(icp.notes, 200)}`);
  return lines.join("\n");
}

function bioBlock(bio: Bio | null): string {
  if (!bio) return "(no company context)";
  const lines: string[] = [];
  if (bio.company_name) lines.push(`Company: ${bio.company_name}`);
  if (bio.tagline) lines.push(`Tagline: ${bio.tagline}`);
  if (bio.value_proposition) lines.push(`Value prop: ${clampSig(bio.value_proposition, 300)}`);
  if (bio.differentiators) lines.push(`Differentiators: ${clampSig(bio.differentiators, 300)}`);
  if (bio.main_services) lines.push(`Main services: ${clampSig(bio.main_services, 300)}`);
  if (bio.tone_of_voice) lines.push(`Tone of voice: ${clampSig(bio.tone_of_voice, 200)}`);
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are an elite B2B outreach copywriter. You write outreach messages that sound human — never templated, never hollow. You honor the OUTPUT FORMAT exactly: no headings, no labels, no commentary, just the message text the seller will send.

Hard bans (never use):
- emojis
- "hope this finds you well", "just wanted to reach out", "touching base", "circle back"
- "synergy", "leverage", "cutting-edge", "game-changer", "seamlessly", "best-in-class", "world-class", "state-of-the-art"
- vague CTAs like "let me know if you're interested"
- fabricated stats or metrics
- re-introducing your own company in follow-ups

Always:
- Sign off DMs/emails with {{seller_name}} on its own line (not the seller's literal name)
- Use {{first_name}} for the lead and {{company_name}} for their company where natural
- For LinkedIn follow-ups, never restate sender company
- Keep one clear question or one clear next-step ask per message
- Match the requested LANGUAGE exactly — do NOT slip into English when Spanish was requested`;

function buildPrompt(args: {
  stepType: StepType;
  lead: Lead;
  icp: Icp | null;
  bio: Bio | null;
  language: string;
  userPrompt: string;
  flowType: FlowType;
}): string {
  const { stepType, lead, icp, bio, language, userPrompt, flowType } = args;
  const langDesc = describeLanguage(language);
  const lengthHint = STEP_LENGTH_HINT[stepType];
  const needsSubject = stepType === "EMAIL_INTRO" || stepType === "EMAIL_FOLLOWUP" || stepType === "EMAIL_FOLLOWUP_CROSS";

  const tailoredSection = flowType === "tailored"
    ? `

TAILORED MODE — IMPORTANT:
The body MUST include the literal token {{tailored:hook}} as the opening line (before any greeting line) AND the literal token {{tailored:fit}} embedded near the end of the body, before any CTA / question line. Write the rest of the body around them — these two slots get filled per-lead at send time with copy that references that lead's recent posts/news/tech stack. Do NOT replace them with concrete text; leave them as the literal tokens.
Example body opening (Spanish): "{{tailored:hook}}\\n\\nHola {{first_name}}, vimos que ..."
Example body cue near close: "{{tailored:fit}}\\n\\n¿Tenés 15 min esta semana?"`
    : "";

  const outputSection = needsSubject
    ? `\n\nOUTPUT FORMAT (strict, no extra text):\nSUBJECT: <subject line, ≤55 chars, no greeting>\nBODY:\n<message body>`
    : `\n\nOUTPUT FORMAT (strict, no extra text):\n<just the message body — no SUBJECT line, no headers, nothing else>`;

  return `LANGUAGE: ${langDesc}

STEP TYPE: ${stepType}
LENGTH / STRUCTURE: ${lengthHint}

OUR COMPANY (the sender):
${bioBlock(bio)}

OUR ICP (who we sell to and why):
${icpBlock(icp)}

THE LEAD (who you're writing TO):
${leadBlock(lead)}

${userPrompt ? `SELLER'S INTENT FOR THIS STEP (honor it):\n${clampSig(userPrompt, 600)}\n\n` : ""}${tailoredSection}${outputSection}

Write only what the OUTPUT FORMAT asks for — no preamble, no notes, no fences.`;
}

async function loadContext(body: Body, scopeBioId: string | null): Promise<{ lead: Lead; icp: Icp | null; bio: Bio | null }> {
  const svc = getSupabaseService();

  const leadPromise = body.leadId
    ? svc.from("leads").select("primary_first_name, primary_last_name, primary_title_role, primary_headline, company_name, company_industry, company_size, primary_linkedin_url, organization_description, organization_short_desc, organization_technologies, recent_website_news, recent_linkedin_post, company_linkedin_post, industry_trends, website_summary, company_mission, call_talking_points, source, encrypted_payload, company_bio_id").eq("id", body.leadId).maybeSingle().then(r => ({ data: r.data as unknown }))
    : Promise.resolve({ data: null as unknown });

  const icpPromise = body.icpProfileId
    ? svc.from("icp_profiles").select("profile_name, pain_points, solutions_offered, target_industries, target_roles, notes").eq("id", body.icpProfileId).maybeSingle().then(r => ({ data: r.data as unknown }))
    : Promise.resolve({ data: null as unknown });

  // Bio: explicit > resolved from lead > resolved from caller's tenant
  const bioId = body.companyBioId ?? scopeBioId;
  const bioPromise = bioId
    ? svc.from("company_bios").select("company_name, tagline, value_proposition, differentiators, main_services, tone_of_voice").eq("id", bioId).maybeSingle().then(r => ({ data: r.data as unknown }))
    : Promise.resolve({ data: null as unknown });

  const [leadRes, icpRes, bioRes] = await Promise.all([leadPromise, icpPromise, bioPromise]);
  let lead = (leadRes.data ?? {}) as Lead;
  const icp = (icpRes.data ?? null) as Icp | null;
  let bio = (bioRes.data ?? null) as Bio | null;

  // Decrypt client-source leads so the prompt sees real text.
  if (lead?.source === "client" && lead.encrypted_payload && lead.company_bio_id) {
    try {
      const { key } = await resolveTenantKey(lead.company_bio_id);
      const decrypted = decryptWithResolvedKey(bufferFromSupabaseBytea(lead.encrypted_payload), key) as Record<string, unknown>;
      lead = { ...lead, ...(decrypted as Lead) };
    } catch { /* fall back to redacted row */ }
  }

  // Fall back to lead's bio if caller didn't pass one.
  if (!bio && lead?.company_bio_id) {
    const { data } = await svc.from("company_bios").select("company_name, tagline, value_proposition, differentiators, main_services, tone_of_voice").eq("id", lead.company_bio_id).maybeSingle();
    bio = (data ?? null) as Bio | null;
  }

  return { lead, icp, bio };
}

function parseSubjectAndBody(raw: string, needsSubject: boolean): { content: string; subject: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!needsSubject) return { content: text, subject: "" };
  const m = text.match(/^\s*SUBJECT\s*:\s*(.+?)\s*\n+BODY\s*:?\s*\n?([\s\S]+)$/i);
  if (m) return { subject: m[1].trim().slice(0, 80), content: m[2].trim() };
  // Fallback: first non-empty line as subject if it looks like one.
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length > 1 && lines[0].length < 80 && !lines[0].endsWith(".")) {
    return { subject: lines[0].trim(), content: lines.slice(1).join("\n").trim() };
  }
  return { subject: "", content: text };
}

function postProcess(stepType: StepType, content: string, subject: string): { content: string; subject: string } {
  let body = content;

  // LinkedIn CR cap (200 chars, dispatcher-enforced) — clamp at sentence boundary if needed.
  if (stepType === "LINKEDIN_CONNECTION_REQUEST" && body.length > 200) {
    const trimmed = body.slice(0, 200);
    const lastPunct = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf("?"), trimmed.lastIndexOf("!"));
    body = lastPunct > 120 ? trimmed.slice(0, lastPunct + 1).trimEnd() : trimmed.trimEnd();
  }

  // If the model wrote a literal seller name on the last 1-3 token line,
  // swap it for {{seller_name}} so dispatchers substitute at send time.
  const lines = body.split("\n");
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx -= 1;
  if (lastIdx >= 0) {
    const last = lines[lastIdx].trim();
    const tokens = last.split(/\s+/).filter(Boolean);
    if (tokens.length >= 1 && tokens.length <= 3 && !/[.?!]$/.test(last) && last.length <= 40 && !last.includes("{{seller_name}}") && !last.match(/^\{\{tailored:/)) {
      lines[lastIdx] = "{{seller_name}}";
      body = lines.join("\n");
    }
  }

  // Subject cap
  let subj = subject;
  if (subj.length > 70) subj = subj.slice(0, 67).trimEnd() + "…";

  return { content: body.trim(), subject: subj };
}

export async function POST(req: NextRequest) {
  // Wrapped in a try/catch so ANY runtime crash (missing env var,
  // module load error, DB outage) returns a JSON body the wizard can
  // surface instead of the generic Next.js HTML error page that the
  // front shows as "HTTP 500" with no detail. The wizard reads
  // res.json().error → seller sees the real cause.
  try {
    return await handlePOST(req);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[generate-field] UNHANDLED:", msg, stack);
    return NextResponse.json({ error: `Server crash: ${msg}` }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  // The legacy n8n-proxy version of this endpoint had no auth gate —
  // the wizard hits it from the browser via fetch on a same-origin URL
  // and only the bio/icp/lead text it sends informs the prompt. Keep
  // that behavior. Scope is read for the bio fallback, not enforced.
  const scope = await getUserScope().catch(() => null);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[generate-field] ANTHROPIC_API_KEY not configured in env");
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured on the server. Add it in Vercel → Settings → Environment Variables and redeploy." }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const stepType = resolveStepType(body);
  const flowType: FlowType = body.flowType === "tailored" ? "tailored" : "generic";
  const language = body.language ?? "es";
  const userPrompt = body.user_prompt ?? "";

  const { lead, icp, bio } = await loadContext(body, scope?.isScoped ? scope.companyBioId : null);

  const needsSubject = stepType === "EMAIL_INTRO" || stepType === "EMAIL_FOLLOWUP" || stepType === "EMAIL_FOLLOWUP_CROSS";
  const prompt = buildPrompt({ stepType, lead, icp, bio, language, userPrompt, flowType });

  const client = new Anthropic({ apiKey });

  // One retry on empty — Haiku occasionally returns an empty content array
  // when the system prompt + user prompt edge into refusal territory.
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 900,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = res.content
        .filter(c => c.type === "text")
        .map(c => (c as { type: "text"; text: string }).text)
        .join("")
        .trim();
      if (!raw) { lastError = "empty model output"; continue; }
      const parsed = parseSubjectAndBody(raw, needsSubject);
      const finalOut = postProcess(stepType, parsed.content, parsed.subject);
      if (!finalOut.content) { lastError = "empty parsed body"; continue; }
      return NextResponse.json({ content: finalOut.content, subject: finalOut.subject });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[generate-field] attempt ${attempt + 1} failed for ${stepType}:`, lastError);
      if (attempt === 1) return NextResponse.json({ error: `AI call failed: ${lastError}` }, { status: 502 });
    }
  }

  return NextResponse.json({ error: `AI returned empty output after retry (${lastError ?? "unknown"})` }, { status: 502 });
}
