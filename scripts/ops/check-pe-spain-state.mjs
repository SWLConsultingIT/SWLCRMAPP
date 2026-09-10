#!/usr/bin/env node
// Diagnose SWL PE Spain campaign state: are the 142 Email Draft cards
// actually sent, queued, or draft? And are they still carrying raw
// `{{firstName}}` / `{{fund_name}}` placeholders, or did the retroactive
// fix script catch them?
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => {
      const idx = l.indexOf("="); return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const CAMPAIGN_NAME_LIKE = "Private Equity%Spain%";
const { data: camps } = await supabase
  .from("campaigns")
  .select("id, name, status, current_step")
  .ilike("name", CAMPAIGN_NAME_LIKE);

console.log(`Found ${camps?.length ?? 0} campaigns matching "${CAMPAIGN_NAME_LIKE}"`);
if (!camps?.length) process.exit(0);

const campIds = camps.map(c => c.id);

// Status breakdown
const { data: msgs } = await supabase
  .from("campaign_messages")
  .select("id, status, channel, step_number, content")
  .in("campaign_id", campIds);

console.log(`\nTotal messages: ${msgs.length}`);
const byStatus = {};
const byChannelStep = {};
let withFirstName = 0, withFundName = 0, withFirstNameSnake = 0, withCompanyName = 0;
const firstNameSamples = [];
for (const m of msgs) {
  byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  const key = `${m.channel}_step${m.step_number}_${m.status}`;
  byChannelStep[key] = (byChannelStep[key] ?? 0) + 1;
  const c = m.content ?? "";
  if (c.includes("{{firstName}}")) { withFirstName++; if (firstNameSamples.length < 3) firstNameSamples.push(m); }
  if (c.includes("{{fund_name}}")) withFundName++;
  if (c.includes("{{first_name}}")) withFirstNameSnake++;
  if (c.includes("{{company_name}}") || c.includes("{{company}}")) withCompanyName++;
}
console.log("\nBy status:");
for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}`);
console.log("\nBy channel/step/status:");
for (const [k, n] of Object.entries(byChannelStep).sort()) console.log(`  ${k}: ${n}`);

console.log("\nRaw placeholders STILL in DB content (post-fix audit):");
console.log(`  {{firstName}} (camel) : ${withFirstName}`);
console.log(`  {{first_name}} (snake): ${withFirstNameSnake}`);
console.log(`  {{fund_name}}         : ${withFundName}`);
console.log(`  {{company_name|company}}: ${withCompanyName}`);

if (firstNameSamples.length) {
  console.log("\nSample messages still carrying {{firstName}}:");
  for (const s of firstNameSamples) {
    console.log(`  id=${s.id} status=${s.status} step=${s.step_number}`);
    console.log(`    "${(s.content ?? "").slice(0, 220).replace(/\n/g, " ")}"`);
  }
}

// And — most useful — when was the LAST send and what was its rendered content?
const { data: lastSent } = await supabase
  .from("campaign_messages")
  .select("id, sent_at, channel, step_number, content, metadata")
  .in("campaign_id", campIds)
  .not("sent_at", "is", null)
  .order("sent_at", { ascending: false })
  .limit(5);
console.log(`\nLast 5 actually-sent messages:`);
for (const m of lastSent ?? []) {
  console.log(`  ${m.sent_at} ${m.channel}/step${m.step_number} id=${m.id}`);
  console.log(`    rendered: ${(m.metadata?.rendered_content ?? m.content ?? "").slice(0, 220).replace(/\n/g, " ")}`);
}
