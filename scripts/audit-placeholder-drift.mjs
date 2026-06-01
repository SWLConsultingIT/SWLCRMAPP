// Reads every campaign_message and flags any whose `content` or
// `metadata.subject` still contains FOREIGN placeholder syntax
// (`[First Name]`, `{First Name}`, `<<First Name>>`, `%FIRST_NAME%`,
// `__first_name__`). These are the tokens the dispatcher CAN'T render —
// the bug that shipped `[First Name]` to Craig Wilson on LinkedIn lives
// in this same shape.
//
// Output:
//   1. Total rows affected grouped by status (queued / draft / sent / failed).
//   2. Per-tenant breakdown: company_bio_id → count by status.
//   3. Per-campaign breakdown for rows that have NOT been sent yet
//      (status in queued/draft/scheduled). These are the actionable rows.
//   4. Sample of 5 actual offending substrings so we eyeball patterns.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Same regexes as lib/placeholders.ts SUSPICIOUS_PATTERNS.
const PATTERNS = [
  { name: "brackets",     regex: /\[[A-Za-z][A-Za-z0-9_\- ]{0,40}\]/g },
  { name: "single-brace", regex: /(?<!\{)\{(?!\{)\s*[A-Za-z][A-Za-z0-9_\- ]{0,40}\s*\}(?!\})/g },
  { name: "chevrons",     regex: /<<\s*[A-Za-z][A-Za-z0-9_\- ]{0,40}\s*>>/g },
  { name: "percent",      regex: /%[A-Z][A-Z0-9_]{1,40}%/g },
  { name: "underscores",  regex: /__[A-Za-z][A-Za-z0-9_]{1,40}__/g },
];

// Tokens that look bracket-y but are legitimate prose, not placeholders.
const BRACKET_ALLOWLIST = new Set([
  "[link]", "[here]", "[click here]", "[see attached]",
]);

function scan(text) {
  if (!text || typeof text !== "string") return [];
  const hits = [];
  for (const { name, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const tok = m[0];
      if (name === "brackets" && BRACKET_ALLOWLIST.has(tok.toLowerCase())) continue;
      hits.push({ pattern: name, token: tok });
    }
  }
  return hits;
}

const PAGE = 1000;
let from = 0;
const offending = [];

console.log("Scanning campaign_messages…");
while (true) {
  const { data, error } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, status, channel, step_number, content, metadata, created_at")
    .order("created_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); process.exit(1); }
  if (!data || data.length === 0) break;

  for (const row of data) {
    const subjectHits = row.metadata?.subject ? scan(String(row.metadata.subject)) : [];
    const bodyHits = scan(row.content);
    if (bodyHits.length === 0 && subjectHits.length === 0) continue;
    offending.push({
      id: row.id,
      campaign_id: row.campaign_id,
      lead_id: row.lead_id,
      status: row.status,
      channel: row.channel,
      step_number: row.step_number,
      created_at: row.created_at,
      body_tokens: bodyHits.map(h => h.token),
      subject_tokens: subjectHits.map(h => h.token),
    });
  }

  if (data.length < PAGE) break;
  from += PAGE;
}

console.log(`\nTotal offending campaign_messages: ${offending.length}`);
if (offending.length === 0) {
  console.log("Nothing to clean. Exiting.");
  process.exit(0);
}

// Group by status.
const byStatus = {};
for (const r of offending) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log("\nBy status:");
for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(14)} ${n}`);
}

// Pull campaigns + leads in batch for tenant lookup.
const campaignIds = [...new Set(offending.map(r => r.campaign_id).filter(Boolean))];
const { data: campaigns } = await svc
  .from("campaigns")
  .select("id, name, status, company_bio_id, channel")
  .in("id", campaignIds);
const campaignById = new Map((campaigns || []).map(c => [c.id, c]));

const companyIds = [...new Set((campaigns || []).map(c => c.company_bio_id).filter(Boolean))];
const { data: bios } = await svc
  .from("company_bios")
  .select("id, brand_name")
  .in("id", companyIds);
const bioById = new Map((bios || []).map(b => [b.id, b]));

// Per-tenant breakdown.
const byTenant = {};
for (const r of offending) {
  const c = campaignById.get(r.campaign_id);
  const bio = c ? bioById.get(c.company_bio_id) : null;
  const key = `${bio?.brand_name ?? "(unknown)"} [${c?.company_bio_id ?? "?"}]`;
  if (!byTenant[key]) byTenant[key] = { total: 0, queued: 0, draft: 0, sent: 0, failed: 0, other: 0 };
  byTenant[key].total += 1;
  if (r.status === "queued" || r.status === "draft" || r.status === "sent" || r.status === "failed") {
    byTenant[key][r.status] += 1;
  } else {
    byTenant[key].other += 1;
  }
}
console.log("\nBy tenant (status breakdown):");
for (const [k, v] of Object.entries(byTenant).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${k.padEnd(50)} total=${v.total}  queued=${v.queued}  draft=${v.draft}  sent=${v.sent}  failed=${v.failed}`);
}

// Per-campaign breakdown (only rows still actionable).
const actionable = offending.filter(r =>
  r.status === "queued" || r.status === "draft" || r.status === "scheduled"
);
const byCampaign = {};
for (const r of actionable) {
  const c = campaignById.get(r.campaign_id);
  const bio = c ? bioById.get(c.company_bio_id) : null;
  const key = `${bio?.brand_name ?? "(?)"} :: ${c?.name ?? "(?)"} [${r.campaign_id}]`;
  if (!byCampaign[key]) byCampaign[key] = { count: 0, campaign_status: c?.status, channels: new Set() };
  byCampaign[key].count += 1;
  if (r.channel) byCampaign[key].channels.add(r.channel);
}
console.log(`\nActionable rows (queued/draft/scheduled): ${actionable.length}`);
console.log("Per campaign:");
for (const [k, v] of Object.entries(byCampaign).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(v.count).padStart(4)}  [${v.campaign_status ?? "?"}]  channels=${[...v.channels].join(",")}  ${k}`);
}

// Sample 8 offending tokens so we can confirm pattern types.
console.log("\nSample tokens (first 8 actionable):");
for (const r of actionable.slice(0, 8)) {
  const c = campaignById.get(r.campaign_id);
  const bio = c ? bioById.get(c.company_bio_id) : null;
  console.log(`  ${r.id} [${bio?.brand_name ?? "?"} / ${c?.name ?? "?"} / step ${r.step_number} / ${r.channel}] body=${JSON.stringify(r.body_tokens)} subj=${JSON.stringify(r.subject_tokens)}`);
}

// Save full list as JSON for the fix script.
import { writeFileSync } from "node:fs";
const outPath = join(__dirname, "audit-placeholder-drift.out.json");
writeFileSync(outPath, JSON.stringify(offending, null, 2));
console.log(`\nFull list written to: ${outPath}`);
