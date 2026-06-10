// Tailored-slot prompt builder.
//
// /api/campaigns/tailor calls Claude Haiku once per (lead, step-with-slots)
// pair and asks it to produce { hook, fit } — the two AI slots the wizard
// allows in template bodies. This file is the prompt assembler: takes
// the lead row, the ICP profile, the company bio, the per-lead talking
// points (Pre-Call Brief), the seller, and the step type, and builds
// a single Haiku prompt that returns strict JSON.
//
// Design constraints (Fran's 2026-06-02 spec):
//   • Slots are READ-ALOUD-ABLE. The hook is the first sentence a seller
//     drops in the door — has to reference something specific the lead
//     could not deny.
//   • The fit is the second sentence — connects the hook to OUR
//     service, in the lead's words. No buzzwords, no generic copy.
//   • Both kept short (hook ≤25 words, fit ≤30) so they slot cleanly
//     into LinkedIn DMs / email intros without blowing length caps.
//   • Step-aware: a LinkedIn DM hook reads differently from a call
//     opener. The prompt receives stepChannel + stepType for tuning.

export type TailorLead = {
  id: string;
  primary_first_name?: string | null;
  primary_last_name?: string | null;
  primary_title_role?: string | null;
  primary_seniority?: string | null;
  primary_headline?: string | null;
  company_name?: string | null;
  company_industry?: string | null;
  company_sub_industry?: string | null;
  organization_description?: string | null;
  organization_short_desc?: string | null;
  organization_technologies?: string[] | null;
  recent_website_news?: string | null;
  recent_linkedin_post?: string | null;
  website_summary?: string | null;
  industry_trends?: string | null;
  employees?: number | string | null;
  annual_revenue?: number | string | null;
  call_talking_points?: unknown;
};

export type TailorIcp = {
  profile_name?: string | null;
  target_industries?: string[] | null;
  target_roles?: string[] | null;
  pain_points?: string[] | string | null;
  solutions_offered?: string[] | string | null;
  notes?: string | null;
};

export type TailorCompanyBio = {
  company_name?: string | null;
  tagline?: string | null;
  value_proposition?: string | null;
  differentiators?: string | null;
  main_services?: string[] | string | null;
  tone_of_voice?: string | null;
};

export type TailorSeller = { name?: string | null };

export type TailorContext = {
  lead: TailorLead;
  icp: TailorIcp | null;
  companyBio: TailorCompanyBio;
  seller: TailorSeller;
  /** "linkedin" | "email" | "call" — the channel of the step that's being filled. */
  stepChannel: "linkedin" | "email" | "call" | string;
  /** Optional language hint ("en" | "es"). Falls back to "en". */
  language?: string;
};

// Lossless join for fields that might be string | string[] | null.
function joinList(v: unknown, sep = ", "): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(sep);
  return String(v);
}

// Extracts the "pain/fit/opener" entries from the lead's pre-call brief
// (`call_talking_points` — same shape rendered on /leads/[id]). Stays
// tolerant of the historic JSON variants: array of strings, array of
// `{type, text}`, or null.
function summarizeTalkingPoints(raw: unknown): string {
  if (!raw) return "";
  const list = Array.isArray(raw) ? raw : [];
  const lines: string[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      lines.push("- " + item);
    } else if (item && typeof item === "object") {
      const t = (item as { type?: string; text?: string }).type;
      const text = (item as { type?: string; text?: string }).text;
      if (text) lines.push(`- [${t ?? "note"}] ${text}`);
    }
  }
  return lines.slice(0, 6).join("\n"); // cap so the prompt stays compact
}

export const TAILOR_SYSTEM_PROMPT = `You are a senior B2B outreach copywriter generating two short, specific personalizations for ONE prospect.

Your output goes into a templated message that already has structure (greeting, CTA, sign-off). You only write TWO sentences:

1. **hook** — the opener after the greeting. Must reference something CONCRETE about THIS lead's company, role, recent move, or industry. NOT generic. NOT "I noticed your company is growing". Examples of good hooks:
   - "Most architecture studios at {{company}}-size are getting the same ask from developer clients: 'can we see the project live, not in monthly PDFs?'"
   - "PE/VC partners we talk to spend 4–6h/week on manual deal sourcing — first thing that stalls in a heavy quarter."
   - Bad: "Hope you're doing well at {{company}}."

2. **fit** — the next sentence connecting the hook to OUR service. Must read like a peer explaining, not a pitch. References our value prop in their words. Examples:
   - "We built ARQY for exactly that — your client sees the project live, no PDF in the middle."
   - "We automate the first three layers of sourcing so your team only touches qualified leads."

## 🌐 LANGUAGE LOCK (CRITICAL — OVERRIDES EVERYTHING ELSE)
The OUTPUT LANGUAGE is declared at the top of the user prompt as "## 🌐 OUTPUT LANGUAGE". BOTH the hook AND the fit MUST be written in that exact language. If Spanish (rioplatense) is declared, write in Spanish using "vos" — NEVER mix languages, NEVER default to English. Mixed-language output is a HARD FAILURE. The outer template already uses that language; your hook+fit must match so the substituted message reads as one coherent piece.

## Rules
- Length: hook ≤25 words, fit ≤30 words. Hard caps.
- No buzzwords: synergies, leverage, disruptive, cutting-edge, world-class, best-in-class, seamlessly, game-changer.
- No fabricated statistics — only ranges/quotes ("4–6h/week", "many partners say…").
- No emojis.
- DO NOT include placeholders like {{first_name}} or {{company}}. The outer template handles those. You write CONTENT.
- Adapt tone to the company's tone_of_voice if provided.

## Output — strict JSON only, no markdown, no prose:
{"hook": "...", "fit": "..."}

If the research is too thin to support a specific hook (only generic data), still try — pick the best angle from what you have. Empty strings are NEVER acceptable.`;

// Resolve a language code to a human-readable name + register hint
// so the Haiku call gets unambiguous instructions about which
// language to write in (and which register/dialect).
function describeLanguage(code?: string): string {
  switch ((code ?? "en").toLowerCase()) {
    case "es": return "Spanish (Argentine / rioplatense register — use \"vos\", NEVER \"tú\")";
    case "en": return "English (US business register, plain, no fluff)";
    case "pt": return "Brazilian Portuguese (informal você, plain)";
    case "fr": return "French (vouvoiement, plain business)";
    case "de": return "German (Sie form, plain business)";
    case "it": return "Italian (Lei form, plain business)";
    default: return "English";
  }
}

/** Build the user-message portion of the Haiku call. */
export function buildTailorUserPrompt(ctx: TailorContext): string {
  const { lead, icp, companyBio, seller, stepChannel, language } = ctx;
  const lines: string[] = [];

  // 🌐 LANGUAGE FIRST — at the top so the model sees it before any
  // other content. Bug 2026-06-10: hooks/fits came back in English
  // when the rest of the message was in Spanish because the language
  // hint was buried at the bottom of the prompt and the model
  // defaulted to English from the prevalent English example
  // sentences in the SYSTEM_PROMPT.
  lines.push(`## 🌐 OUTPUT LANGUAGE — STRICT\n**${describeLanguage(language)}**\nBoth the hook and the fit MUST be written in this language. Do NOT switch to English. Mixed-language is a HARD FAILURE.\n`);

  lines.push("## THE PROSPECT");
  const firstName = lead.primary_first_name ?? "Prospect";
  const lastName = lead.primary_last_name ?? "";
  lines.push(`Name: ${firstName} ${lastName}`.trim());
  if (lead.primary_title_role) lines.push(`Role: ${lead.primary_title_role}${lead.primary_seniority ? ` (${lead.primary_seniority})` : ""}`);
  if (lead.primary_headline) lines.push(`LinkedIn headline: ${lead.primary_headline}`);

  lines.push("\n## THEIR COMPANY");
  if (lead.company_name) lines.push(`Name: ${lead.company_name}`);
  if (lead.company_industry) lines.push(`Industry: ${lead.company_industry}${lead.company_sub_industry ? ` / ${lead.company_sub_industry}` : ""}`);
  if (lead.employees) lines.push(`Headcount: ${lead.employees}`);
  if (lead.annual_revenue) lines.push(`Revenue: ${lead.annual_revenue}`);
  if (lead.organization_short_desc ?? lead.organization_description) {
    lines.push(`What they do: ${lead.organization_short_desc ?? lead.organization_description}`);
  }
  if (Array.isArray(lead.organization_technologies) && lead.organization_technologies.length > 0) {
    lines.push(`Tech stack: ${lead.organization_technologies.slice(0, 10).join(", ")}`);
  }
  if (lead.recent_website_news) lines.push(`Recent website news: ${lead.recent_website_news}`);
  if (lead.recent_linkedin_post) lines.push(`Recent LinkedIn post: ${lead.recent_linkedin_post}`);
  if (lead.website_summary) lines.push(`Website keywords: ${lead.website_summary}`);
  if (lead.industry_trends) lines.push(`Industry trends: ${lead.industry_trends}`);

  if (icp) {
    lines.push("\n## TARGET ICP — what we look for in a prospect");
    if (icp.profile_name) lines.push(`Profile: ${icp.profile_name}`);
    const pains = joinList(icp.pain_points, "; ");
    if (pains) lines.push(`Pain points we solve: ${pains}`);
    const sols = joinList(icp.solutions_offered, "; ");
    if (sols) lines.push(`Solutions we offer: ${sols}`);
    if (icp.notes) lines.push(`ICP notes: ${icp.notes}`);
  }

  lines.push("\n## OUR COMPANY (the sender — you can mention by name in the fit sentence, in plain text, NO placeholder)");
  if (companyBio.company_name) lines.push(`Name (use as plain text in the fit if needed, NEVER write {{seller_company}} — it's not a supported placeholder): ${companyBio.company_name}`);
  if (companyBio.tagline) lines.push(`Tagline: ${companyBio.tagline}`);
  if (companyBio.value_proposition) lines.push(`Value prop: ${companyBio.value_proposition}`);
  const services = joinList(companyBio.main_services, ", ");
  if (services) lines.push(`Services: ${services}`);
  if (companyBio.differentiators) lines.push(`Differentiators: ${companyBio.differentiators}`);
  if (companyBio.tone_of_voice) lines.push(`Tone of voice to match: ${companyBio.tone_of_voice}`);

  const tp = summarizeTalkingPoints(lead.call_talking_points);
  if (tp) {
    lines.push("\n## PRE-CALL TALKING POINTS (from seller research)");
    lines.push(tp);
  }

  lines.push("\n## STEP CONTEXT");
  lines.push(`Channel: ${stepChannel}`);
  lines.push(`Language: ${language ?? "en"}`);
  lines.push(`Seller: ${seller.name ?? "the seller"}`);
  lines.push(`Prospect first name (do NOT include in your output — for context only): ${firstName}`);

  lines.push("\nReturn the JSON now: {\"hook\":\"...\",\"fit\":\"...\"}");
  return lines.join("\n");
}
