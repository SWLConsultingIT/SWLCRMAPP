// One-off backfill: pre-generate Pre-Call Briefs (call_talking_points) for the
// actionable leads of SWL + Pathway — those sitting in an active/paused
// campaign — so sellers see the brief instantly instead of waiting on the
// on-demand generation. Mirrors the prompt/parse logic of
// app/api/leads/[id]/talking-points/route.ts exactly (kept in sync by hand;
// this is a throwaway backfill, the route stays the source of truth for new
// leads via auto-generate-on-view).
//
// Run: node scripts/backfill-talking-points-2026-06-05.mjs
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY,
// ANTHROPIC_API_KEY.

import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;
if (!SB_URL || !SB_KEY || !ANTHROPIC_KEY) { console.error("Missing env"); process.exit(1); }

const TENANTS = {
  "SWL Consulting": "7c02e222-be59-416d-9434-acf4685f8590",
  "Pathway Commercial Finance": "10969697-f900-47f5-ba64-2287fa72b44d",
};
const CONCURRENCY = 8;

const sb = (path, opts = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });

async function fetchAll(pathBuilder) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await sb(pathBuilder, { headers: { Range: `${from}-${from + 999}` } });
    const rows = await res.json();
    if (!Array.isArray(rows)) { console.error("fetch err", rows); break; }
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

function buildPrompt(lead, icp) {
  const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "the lead";
  const enrichment = lead.enrichment ?? {};
  const enrichmentDump = Object.entries(enrichment)
    .filter(([k, v]) => k !== "source_file" && v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`).join("\n");
  return `You are a senior B2B SDR coach. The seller dials ${name} in 30 seconds. Generate a tight call brief: one likely pain, one fit reason, one opening line. They will literally read your output before pressing dial.

LEAD
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}
- Industry: ${lead.company_industry ?? "—"}
- Location: ${[lead.company_city, lead.company_country].filter(Boolean).join(", ") || "—"}
${lead.primary_headline ? `- LinkedIn headline: ${lead.primary_headline}` : ""}
${lead.primary_career ? `- Career: ${lead.primary_career}` : ""}
${lead.seller_notes ? `- Notes: ${lead.seller_notes}` : ""}

ENRICHMENT DATA (use these specific signals)
${enrichmentDump || "(none)"}

${icp ? `WHAT WE SELL
- Offering: ${icp.solutions_offered ?? ""}
- Pain we solve: ${icp.pain_points ?? ""}` : ""}

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
}

async function generate(lead, icp) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system: "You output ONLY a JSON array of exactly three objects {type, text}. You never refuse, never ask for more information, and never write prose — sparse input still yields a useful role-based brief.", messages: [{ role: "user", content: buildPrompt(lead, icp) }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.type === "text" ? data.content[0].text : "";
  const match = text.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(match ? match[0] : text);
  if (!Array.isArray(parsed)) return null;
  const allowed = new Set(["pain", "fit", "opener"]);
  const cleaned = parsed
    .filter(p => p && typeof p === "object" && typeof p.type === "string" && typeof p.text === "string")
    .filter(p => allowed.has(p.type))
    .map(p => ({ type: p.type, text: p.text.trim() }))
    .filter(p => p.text.length > 0)
    .slice(0, 3);
  return cleaned.length === 3 ? cleaned : null;
}

async function main() {
  const bioFilter = Object.values(TENANTS).map(id => `"${id}"`).join(",");
  console.log("Fetching actionable leads without a brief…");
  // Leads in an active/paused campaign, no brief yet, for the two tenants.
  const camps = await fetchAll(`campaigns?select=lead_id,status&status=in.(active,paused)`);
  const activeLeadIds = new Set(camps.map(c => c.lead_id).filter(Boolean));

  const leads = (await fetchAll(
    `leads?select=id,primary_first_name,primary_last_name,primary_title_role,company_name,company_industry,company_city,company_country,primary_headline,primary_career,seller_notes,enrichment,icp_profile_id,call_talking_points,company_bio_id&company_bio_id=in.(${bioFilter})`
  )).filter(l => !l.call_talking_points && activeLeadIds.has(l.id));

  console.log(`Targets: ${leads.length} leads`);

  // ICP context cache
  const icpIds = [...new Set(leads.map(l => l.icp_profile_id).filter(Boolean))];
  const icpMap = {};
  if (icpIds.length) {
    const icps = await fetchAll(`icp_profiles?select=id,profile_name,solutions_offered,pain_points&id=in.(${icpIds.map(i => `"${i}"`).join(",")})`);
    for (const i of icps) icpMap[i.id] = i;
  }

  let ok = 0, fail = 0, done = 0;
  const queue = [...leads];
  async function worker() {
    while (queue.length) {
      const lead = queue.shift();
      try {
        const points = await generate(lead, lead.icp_profile_id ? icpMap[lead.icp_profile_id] : null);
        if (points) {
          const r = await sb(`leads?id=eq.${lead.id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ call_talking_points: points, call_talking_points_at: new Date().toISOString() }),
          });
          if (r.ok) ok++; else { fail++; console.error("patch fail", lead.id, await r.text()); }
        } else { fail++; }
      } catch (e) { fail++; console.error("gen fail", lead.id, e.message); }
      if (++done % 50 === 0) console.log(`  ${done}/${leads.length} (ok ${ok}, fail ${fail})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`DONE — ok ${ok}, fail ${fail}, total ${leads.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
