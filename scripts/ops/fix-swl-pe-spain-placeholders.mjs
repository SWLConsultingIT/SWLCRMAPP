// PE Spain emails went out with raw placeholders ({{first_name}},
// {{fund_name}}, {{seller_name}}). This script:
//   1. Pauses every active PE Spain campaign so no more bad emails fire.
//   2. For every queued + draft message (any channel) in those campaigns,
//      hydrates lead + seller data and substitutes the placeholders inline.
//      Writes the personalized text into BOTH campaign_messages.content and
//      metadata.rendered_content (the UI prefers the latter; the dispatcher
//      reads the former).
//   3. Re-activates the campaigns.
//
// Placeholders handled:
//   {{first_name}}, {{firstName}}     → lead.primary_first_name
//   {{last_name}}, {{lastName}}       → lead.primary_last_name
//   {{company_name}}, {{companyName}} → lead.company_name
//   {{fund_name}}                     → lead.company_name (alias used in PE copy)
//   {{seller_name}}, {{sellerName}}   → seller.name
//
// Anything else in {{...}} form is left alone + reported at the end.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const SWL_BIO = "7c02e222-be59-416d-9434-acf4685f8590";
const CAMPAIGN_NAME_PATTERN = "%Private Equity%Spain%";

function substitute(text, ctx) {
  if (!text) return text;
  let out = text;
  out = out.replaceAll("{{first_name}}",  ctx.firstName ?? "");
  out = out.replaceAll("{{firstName}}",   ctx.firstName ?? "");
  out = out.replaceAll("{{last_name}}",   ctx.lastName ?? "");
  out = out.replaceAll("{{lastName}}",    ctx.lastName ?? "");
  out = out.replaceAll("{{company_name}}", ctx.companyName ?? "");
  out = out.replaceAll("{{companyName}}",  ctx.companyName ?? "");
  out = out.replaceAll("{{fund_name}}",    ctx.companyName ?? ""); // alias used in PE copy
  out = out.replaceAll("{{company}}",      ctx.companyName ?? "");
  out = out.replaceAll("{{seller_name}}",  ctx.sellerName ?? "");
  out = out.replaceAll("{{sellerName}}",   ctx.sellerName ?? "");
  return out;
}

async function main() {
  // 1. Find PE Spain campaigns scoped to SWL leads
  console.log(`→ Locating PE Spain campaigns for SWL Consulting ...`);
  const { data: leads } = await svc.from("leads")
    .select("id, primary_first_name, primary_last_name, company_name")
    .eq("company_bio_id", SWL_BIO)
    .limit(5000);
  const leadMap = new Map((leads ?? []).map(l => [l.id, l]));
  const leadIds = [...leadMap.keys()];

  let camps = [];
  for (let i = 0; i < leadIds.length; i += 500) {
    const sub = leadIds.slice(i, i + 500);
    const { data } = await svc.from("campaigns")
      .select("id, name, status, seller_id, sellers(name)")
      .in("lead_id", sub)
      .ilike("name", CAMPAIGN_NAME_PATTERN);
    camps.push(...(data ?? []));
  }
  console.log(`  ${camps.length} PE Spain campaigns`);
  if (!camps.length) { console.log("Nothing to do."); return; }

  const sellerName = camps[0]?.sellers?.name ?? "Lucho";
  console.log(`  Seller for substitution: ${sellerName}`);

  // 2. Pause every campaign (was active)
  console.log(`\n→ Pausing campaigns ...`);
  const campIds = camps.map(c => c.id);
  let paused = 0;
  for (let i = 0; i < campIds.length; i += 200) {
    const sub = campIds.slice(i, i + 200);
    const { count, error } = await svc.from("campaigns").update({ status: "paused" }, { count: "exact" }).in("id", sub).neq("status", "paused");
    if (error) { console.error(`pause: ${error.message}`); process.exit(1); }
    paused += count ?? 0;
  }
  console.log(`  ${paused} campaigns now paused`);

  // 3. Pull every queued + draft message in those campaigns
  console.log(`\n→ Fetching messages to rewrite ...`);
  let msgs = [];
  for (let i = 0; i < campIds.length; i += 200) {
    const sub = campIds.slice(i, i + 200);
    const { data } = await svc.from("campaign_messages")
      .select("id, campaign_id, lead_id, step_number, channel, status, content, metadata, sent_at")
      .in("campaign_id", sub)
      .in("status", ["queued", "draft"]);
    msgs.push(...(data ?? []));
  }
  console.log(`  ${msgs.length} queued + draft messages`);

  const PLACEHOLDER_RE = /\{\{([\w_]+)\}\}/g;
  const unknownPh = new Map(); // placeholder name → count

  // 4. Rewrite content + rendered_content
  console.log(`\n→ Substituting placeholders ...`);
  let rewrote = 0, skipped = 0, missingLead = 0;
  const updates = [];
  for (const m of msgs) {
    const before = m.content ?? "";
    if (!before.includes("{{")) { skipped++; continue; }
    const lead = leadMap.get(m.lead_id);
    if (!lead) { missingLead++; continue; }
    const ctx = {
      firstName:   lead.primary_first_name ?? "",
      lastName:    lead.primary_last_name ?? "",
      companyName: lead.company_name ?? "",
      sellerName,
    };
    const after = substitute(before, ctx);
    // Detect unknown placeholders that survived
    for (const m2 of after.matchAll(PLACEHOLDER_RE)) {
      const key = m2[1];
      unknownPh.set(key, (unknownPh.get(key) ?? 0) + 1);
    }
    if (after === before) { skipped++; continue; }
    const newMeta = { ...(m.metadata ?? {}), rendered_content: after };
    updates.push({ id: m.id, content: after, metadata: newMeta });
    rewrote++;
  }

  // Apply updates in chunks
  console.log(`  Rewriting ${rewrote} rows ...`);
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    for (const u of chunk) {
      const { error } = await svc.from("campaign_messages").update({ content: u.content, metadata: u.metadata }).eq("id", u.id);
      if (error) { console.error(`update ${u.id}: ${error.message}`); process.exit(1); }
    }
    process.stdout.write(`    ${Math.min(i+50, updates.length)}/${updates.length}\r`);
  }
  console.log(`\n  ${rewrote} rewritten · ${skipped} had no placeholders · ${missingLead} missing-lead skips`);

  if (unknownPh.size > 0) {
    console.log(`\n  ⚠ Placeholders left unresolved (not in our known list):`);
    for (const [k, n] of [...unknownPh.entries()].sort((a,b) => b[1]-a[1])) {
      console.log(`    {{${k}}} × ${n}`);
    }
  }

  // 5. Re-activate campaigns
  console.log(`\n→ Re-activating campaigns ...`);
  let reactivated = 0;
  for (let i = 0; i < campIds.length; i += 200) {
    const sub = campIds.slice(i, i + 200);
    const { count, error } = await svc.from("campaigns").update({ status: "active" }, { count: "exact" }).in("id", sub).eq("status", "paused");
    if (error) { console.error(`re-activate: ${error.message}`); process.exit(1); }
    reactivated += count ?? 0;
  }
  console.log(`  ${reactivated} campaigns active again`);

  console.log(`\n✓ Done.`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
