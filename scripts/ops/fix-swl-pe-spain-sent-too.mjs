// Earlier pass only rewrote queued+draft so the historical record of what
// effectively went out was preserved. Fran wants the campaign detail page
// to surface resolved copy for every message, including the ones that
// already shipped raw. This script substitutes placeholders on sent +
// failed messages too — purely cosmetic for what already left, but it
// makes the lead detail / campaign detail surfaces consistent.
//
// We tuck the pre-substitution body into metadata.original_content so the
// "this is what actually went out raw" record is still recoverable.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const SWL_BIO = "7c02e222-be59-416d-9434-acf4685f8590";

function substitute(text, ctx) {
  if (!text) return text;
  let out = text;
  out = out.replaceAll("{{first_name}}",  ctx.firstName ?? "");
  out = out.replaceAll("{{firstName}}",   ctx.firstName ?? "");
  out = out.replaceAll("{{last_name}}",   ctx.lastName ?? "");
  out = out.replaceAll("{{lastName}}",    ctx.lastName ?? "");
  out = out.replaceAll("{{company_name}}", ctx.companyName ?? "");
  out = out.replaceAll("{{companyName}}",  ctx.companyName ?? "");
  out = out.replaceAll("{{fund_name}}",    ctx.companyName ?? "");
  out = out.replaceAll("{{company}}",      ctx.companyName ?? "");
  out = out.replaceAll("{{seller_name}}",  ctx.sellerName ?? "");
  out = out.replaceAll("{{sellerName}}",   ctx.sellerName ?? "");
  return out;
}

async function main() {
  // Scope to SWL PE Spain
  const { data: leads } = await svc.from("leads")
    .select("id, primary_first_name, primary_last_name, company_name")
    .eq("company_bio_id", SWL_BIO)
    .limit(5000);
  const leadMap = new Map((leads ?? []).map(l => [l.id, l]));
  const lids = [...leadMap.keys()];

  let camps = [];
  for (let i = 0; i < lids.length; i += 500) {
    const { data } = await svc.from("campaigns")
      .select("id, sellers(name)")
      .in("lead_id", lids.slice(i, i + 500))
      .ilike("name", "%Private Equity%Spain%");
    camps.push(...(data ?? []));
  }
  if (!camps.length) { console.log("Nothing to do."); return; }
  const sellerName = camps[0]?.sellers?.name ?? "Lucho";
  const campIds = camps.map(c => c.id);
  console.log(`Scope: ${camps.length} PE Spain campaigns · seller=${sellerName}`);

  // Sent + failed messages that still carry raw placeholders
  let target = [];
  for (let i = 0; i < campIds.length; i += 200) {
    const sub = campIds.slice(i, i + 200);
    const { data } = await svc.from("campaign_messages")
      .select("id, lead_id, content, metadata, status, step_number, channel")
      .in("campaign_id", sub)
      .in("status", ["sent", "failed"]);
    target.push(...(data ?? []));
  }
  const dirty = target.filter(m => /\{\{\w+\}\}/.test(m.content ?? ""));
  console.log(`Sent+failed with placeholders: ${dirty.length} (of ${target.length})`);

  let rewrote = 0;
  for (const m of dirty) {
    const lead = leadMap.get(m.lead_id);
    if (!lead) continue;
    const ctx = {
      firstName:   lead.primary_first_name ?? "",
      lastName:    lead.primary_last_name ?? "",
      companyName: lead.company_name ?? "",
      sellerName,
    };
    const before = m.content ?? "";
    const after = substitute(before, ctx);
    if (after === before) continue;
    const newMeta = {
      ...(m.metadata ?? {}),
      original_content: m.metadata?.original_content ?? before,
      rendered_content: after,
    };
    const { error } = await svc.from("campaign_messages")
      .update({ content: after, metadata: newMeta })
      .eq("id", m.id);
    if (error) { console.error(`update ${m.id}: ${error.message}`); process.exit(1); }
    rewrote++;
    if (rewrote % 25 === 0) process.stdout.write(`  ${rewrote}/${dirty.length}\r`);
  }
  console.log(`\n✓ ${rewrote} rewritten. Original raw template preserved in metadata.original_content.`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
