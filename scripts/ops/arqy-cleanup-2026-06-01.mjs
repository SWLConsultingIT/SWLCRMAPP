// Arqy cleanup — 2026-06-01.
//
// Removes ONLY the `queued` + `draft` campaign_messages under Arqy
// campaigns (the rows that would have shipped with `[First Name]` literal
// if the placeholder guard hadn't been deployed). Keeps the 365 sent +
// 320 skipped rows intact so the per-ICP history view inside
// /leads/ticket/[id] still has the receipts to render.
//
// Also flips the 48 leads that landed in `closed_lost` purely because
// no one replied (Arqy has 0 lead_replies) back to `contacted`. The
// page-level bucket logic at app/leads/page.tsx:380 then routes them to
// the Renurture lane (reason='no_reply' → goesToRenurture=true) — matches
// the no-reply-goes-to-renurture rule in memory.
//
// Backup: a JSON dump of every campaign_message it deletes + every lead
// row it touches lands at scripts/arqy-cleanup-2026-06-01.backup.json
// before the destructive writes. That file is the rollback artifact.
//
// Blast-radius guarantee: every campaign_id, lead_id, and message_id
// touched in this run was verified to be inside Arqy's company_bio_id
// (0902962f-4b15-4810-a5bd-730d4b22a527) on 2026-06-01.

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
const CHUNK = 40; // .in() URL-length safety margin.

// 1. Pull Arqy campaigns and verify ownership.
console.log("Loading Arqy campaigns…");
const { data: camps, error: cErr } = await svc
  .from("campaigns")
  .select("id, company_bio_id, name, status")
  .eq("company_bio_id", ARQY);
if (cErr) { console.error(cErr); process.exit(1); }
const foreign = camps.filter(c => c.company_bio_id !== ARQY);
if (foreign.length > 0) {
  console.error(`SAFETY ABORT — ${foreign.length} campaigns leaked into the query that aren't Arqy. Aborting.`);
  process.exit(1);
}
const campIds = camps.map(c => c.id);
console.log(`Confirmed: ${campIds.length} campaigns, all under Arqy.`);

// 2. Pull all campaign_messages under those campaigns, chunked.
console.log("Loading campaign_messages…");
let allMsgs = [];
for (let i = 0; i < campIds.length; i += CHUNK) {
  const { data } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, status, channel, step_number, content, metadata, created_at")
    .in("campaign_id", campIds.slice(i, i + CHUNK));
  allMsgs = allMsgs.concat(data || []);
}
const toDelete = allMsgs.filter(m => m.status === "queued" || m.status === "draft");
console.log(`Total messages: ${allMsgs.length}. To delete (queued+draft): ${toDelete.length}.`);

// 3. Pull leads + identify the 48 closed_lost-by-no-reply.
console.log("Loading Arqy leads…");
const { data: leads } = await svc
  .from("leads")
  .select("id, company_bio_id, status, icp_profile_id, primary_first_name, primary_last_name")
  .eq("company_bio_id", ARQY);
const foreignLeads = leads.filter(l => l.company_bio_id !== ARQY);
if (foreignLeads.length > 0) {
  console.error(`SAFETY ABORT — ${foreignLeads.length} leads leaked. Aborting.`);
  process.exit(1);
}
const leadsToReset = leads.filter(l => l.status === "closed_lost");
console.log(`Total leads: ${leads.length}. closed_lost to recover: ${leadsToReset.length}.`);

// 4. Confirm 0 lead_replies — if non-zero, abort because the recovery
//    rule (closed_lost → contacted) is only safe when reason='no_reply'.
let replyCount = 0;
for (let i = 0; i < leads.length; i += CHUNK) {
  const slice = leads.slice(i, i + CHUNK).map(l => l.id);
  const { count } = await svc.from("lead_replies").select("*", { count: "exact", head: true }).in("lead_id", slice);
  replyCount += count ?? 0;
}
if (replyCount > 0) {
  console.error(`SAFETY ABORT — ${replyCount} lead_replies exist for Arqy leads. The "no replies" assumption is broken; not safe to flip closed_lost → contacted without re-classifying. Aborting.`);
  process.exit(1);
}
console.log(`Confirmed: 0 lead_replies for Arqy leads.`);

// 5. Backup everything we're about to mutate.
const backup = {
  generatedAt: new Date().toISOString(),
  arqyBioId: ARQY,
  campaignsInScope: camps,
  messagesToDelete: toDelete,
  leadsToReset: leadsToReset.map(l => ({
    id: l.id,
    status_was: l.status,
    icp_profile_id: l.icp_profile_id,
    first_name: l.primary_first_name,
    last_name: l.primary_last_name,
  })),
};
const backupPath = join(__dirname, "arqy-cleanup-2026-06-01.backup.json");
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log(`Backup written: ${backupPath}`);

// 6. Delete the queued + draft messages, chunked.
console.log(`Deleting ${toDelete.length} campaign_messages…`);
const toDeleteIds = toDelete.map(m => m.id);
let deleted = 0;
for (let i = 0; i < toDeleteIds.length; i += CHUNK) {
  const slice = toDeleteIds.slice(i, i + CHUNK);
  const { error } = await svc.from("campaign_messages").delete().in("id", slice);
  if (error) { console.error(`Delete failed at chunk ${i}:`, error); process.exit(1); }
  deleted += slice.length;
}
console.log(`Deleted: ${deleted}.`);

// 7. Flip the 48 closed_lost leads back to contacted.
console.log(`Updating ${leadsToReset.length} leads to status='contacted'…`);
const toResetIds = leadsToReset.map(l => l.id);
let updated = 0;
for (let i = 0; i < toResetIds.length; i += CHUNK) {
  const slice = toResetIds.slice(i, i + CHUNK);
  const { error } = await svc.from("leads").update({ status: "contacted" }).in("id", slice);
  if (error) { console.error(`Update failed at chunk ${i}:`, error); process.exit(1); }
  updated += slice.length;
}
console.log(`Updated: ${updated}.`);

// 8. Verify final state.
console.log("\nVerifying final state…");
let postMsgs = [];
for (let i = 0; i < campIds.length; i += CHUNK) {
  const { data } = await svc
    .from("campaign_messages")
    .select("id, status")
    .in("campaign_id", campIds.slice(i, i + CHUNK));
  postMsgs = postMsgs.concat(data || []);
}
const postByStatus = {};
for (const m of postMsgs) postByStatus[m.status] = (postByStatus[m.status] || 0) + 1;
console.log("Remaining Arqy campaign_messages:", postMsgs.length, "by status:", postByStatus);

const { data: postLeads } = await svc.from("leads").select("status").eq("company_bio_id", ARQY);
const postLeadStatus = {};
for (const l of postLeads) postLeadStatus[l.status] = (postLeadStatus[l.status] || 0) + 1;
console.log("Arqy leads by status:", postLeadStatus);

console.log("\nDone.");
