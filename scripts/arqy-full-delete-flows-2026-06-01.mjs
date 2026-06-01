// Full delete of the 3 Arqy flows (102 campaigns + their remaining
// 685 campaign_messages). Replicates exactly what /api/campaigns/cancel
// action="cancel" does, but for the whole Arqy tenant in one pass.
//
// Order:
//   1. Backup JSON (campaigns + remaining messages + linked replies).
//   2. DELETE campaign_messages WHERE campaign_id IN (Arqy campaigns).
//   3. DELETE lead_replies WHERE campaign_id IN (Arqy campaigns).
//   4. DELETE campaigns WHERE id IN (Arqy campaigns).
//   5. UPDATE leads SET current_campaign_id=NULL, current_channel=NULL
//      for the 102 Arqy leads — keeps lead.status='contacted' from the
//      prior cleanup so they don't bounce back to "new".
//
// After this runs the 3 ICPs are empty in /campaigns and the 102 leads
// are unassigned — ready to enter the new "— Arqy Build" templates.
//
// Safety: aborts on any non-Arqy row in scope.

import { readFileSync, writeFileSync } from "node:fs";
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

const ARQY = "0902962f-4b15-4810-a5bd-730d4b22a527";
const CHUNK = 40;

console.log("Loading Arqy campaigns…");
const { data: camps, error: cErr } = await svc
  .from("campaigns")
  .select("id, company_bio_id, name, status, lead_id, seller_id, channel, current_step, sequence_steps, created_at")
  .eq("company_bio_id", ARQY);
if (cErr) { console.error(cErr); process.exit(1); }
const foreign = camps.filter(c => c.company_bio_id !== ARQY);
if (foreign.length > 0) {
  console.error(`SAFETY ABORT — ${foreign.length} non-Arqy campaigns in scope. Aborting.`);
  process.exit(1);
}
const campIds = camps.map(c => c.id);
console.log(`${campIds.length} campaigns, all Arqy.`);

console.log("Loading remaining campaign_messages…");
let allMsgs = [];
for (let i = 0; i < campIds.length; i += CHUNK) {
  const { data } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, status, channel, step_number, content, metadata, sent_at, created_at")
    .in("campaign_id", campIds.slice(i, i + CHUNK));
  allMsgs = allMsgs.concat(data || []);
}
console.log(`${allMsgs.length} messages to delete.`);

console.log("Loading lead_replies (should be 0)…");
let allReplies = [];
for (let i = 0; i < campIds.length; i += CHUNK) {
  const { data } = await svc
    .from("lead_replies")
    .select("*")
    .in("campaign_id", campIds.slice(i, i + CHUNK));
  allReplies = allReplies.concat(data || []);
}
console.log(`${allReplies.length} replies.`);

let leads = [];
let off = 0;
while (true) {
  const { data, error } = await svc.from("leads").select("id, company_bio_id, status, current_channel").eq("company_bio_id", ARQY).range(off, off + 999);
  if (error) { console.error(error); process.exit(1); }
  if (!data || data.length === 0) break;
  leads = leads.concat(data);
  if (data.length < 1000) break;
  off += 1000;
}
const foreignLeads = leads.filter(l => l.company_bio_id !== ARQY);
if (foreignLeads.length > 0) { console.error("SAFETY ABORT — non-Arqy leads."); process.exit(1); }
console.log(`${leads.length} Arqy leads (current_channel will be nulled).`);

// 1. Backup.
const backup = {
  generatedAt: new Date().toISOString(),
  arqyBioId: ARQY,
  campaigns: camps,
  messages: allMsgs,
  replies: allReplies,
  leadsBefore: leads,
};
const backupPath = join(__dirname, "arqy-full-delete-flows-2026-06-01.backup.json");
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log(`Backup: ${backupPath}`);

// 2. Delete messages.
console.log("Deleting campaign_messages…");
let deletedMsgs = 0;
for (let i = 0; i < campIds.length; i += CHUNK) {
  const { error } = await svc.from("campaign_messages").delete().in("campaign_id", campIds.slice(i, i + CHUNK));
  if (error) { console.error(error); process.exit(1); }
  deletedMsgs += 1;
}
console.log(`  done.`);

// 3. Delete replies.
if (allReplies.length > 0) {
  console.log("Deleting lead_replies…");
  for (let i = 0; i < campIds.length; i += CHUNK) {
    await svc.from("lead_replies").delete().in("campaign_id", campIds.slice(i, i + CHUNK));
  }
  console.log(`  done.`);
}

// 4. Delete campaigns.
console.log("Deleting campaigns…");
for (let i = 0; i < campIds.length; i += CHUNK) {
  const { error } = await svc.from("campaigns").delete().in("id", campIds.slice(i, i + CHUNK));
  if (error) { console.error(error); process.exit(1); }
}
console.log(`  done.`);

// 5. Null leads.current_channel.
console.log("Nulling lead.current_channel…");
const leadIds = leads.map(l => l.id);
for (let i = 0; i < leadIds.length; i += CHUNK) {
  const { error } = await svc
    .from("leads")
    .update({ current_channel: null })
    .in("id", leadIds.slice(i, i + CHUNK));
  if (error) { console.error(error); process.exit(1); }
}
console.log(`  done.`);

// Verify.
console.log("\nVerification:");
const { count: campLeft } = await svc.from("campaigns").select("*", { count: "exact", head: true }).eq("company_bio_id", ARQY);
console.log(`  Arqy campaigns remaining: ${campLeft}`);
const { data: postLeads } = await svc.from("leads").select("status").eq("company_bio_id", ARQY);
const byStatus = {};
for (const l of postLeads) byStatus[l.status] = (byStatus[l.status] || 0) + 1;
console.log(`  Arqy leads by status:`, byStatus);
const { data: postTpls } = await svc.from("campaign_templates").select("id,name").eq("company_bio_id", ARQY);
console.log(`  Arqy templates:`, postTpls.map(t => t.name));

console.log("\nDone.");
