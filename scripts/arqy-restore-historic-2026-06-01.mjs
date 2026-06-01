// Restores the 102 Arqy campaigns + 685 messages from the
// arqy-full-delete-flows-2026-06-01.backup.json snapshot, but forces
// every campaign's status to 'completed' so the historic rows show up
// in the Past Flows collapse inside /leads/ticket/[id] WITHOUT being
// candidates for the dispatcher.
//
// Idempotent: if any campaign in the backup already exists in DB, the
// script skips that row.

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

const ARQY = "0902962f-4b15-4810-a5bd-730d4b22a527";
const CHUNK = 30;

const backupPath = join(__dirname, "arqy-full-delete-flows-2026-06-01.backup.json");
const backup = JSON.parse(readFileSync(backupPath, "utf8"));
console.log(`Backup loaded: ${backup.campaigns.length} campaigns, ${backup.messages.length} messages.`);

// Sanity: all campaigns belong to Arqy.
const nonArqy = backup.campaigns.filter(c => c.company_bio_id !== ARQY);
if (nonArqy.length > 0) {
  console.error(`SAFETY ABORT — ${nonArqy.length} non-Arqy campaigns in backup.`);
  process.exit(1);
}

// Skip rows that already exist (idempotency).
const { data: existingCamps } = await svc.from("campaigns").select("id").eq("company_bio_id", ARQY);
const existingCampIds = new Set((existingCamps || []).map(c => c.id));
console.log(`Already-present Arqy campaigns: ${existingCampIds.size}.`);

const campsToInsert = backup.campaigns
  .filter(c => !existingCampIds.has(c.id))
  .map(c => ({
    ...c,
    // Force historic — never active, never paused. Past Flows in
    // /leads/ticket/[id] reads only completed/failed rows.
    status: c.status === "failed" ? "failed" : "completed",
    // Keep the original lead_id / seller_id / sequence_steps / name /
    // channel / current_step / created_at intact so the cohort split
    // logic (lib/dashboard-data) lines up with what actually happened.
  }));

console.log(`Inserting ${campsToInsert.length} campaigns as historic…`);
for (let i = 0; i < campsToInsert.length; i += CHUNK) {
  const slice = campsToInsert.slice(i, i + CHUNK);
  const { error } = await svc.from("campaigns").insert(slice);
  if (error) { console.error(`Insert campaign chunk failed at ${i}:`, error); process.exit(1); }
}
console.log("  done.");

// Re-insert messages — these are what give the historic cards their
// "365 sent · 0 replies" stats. Skip messages whose campaign_id isn't
// among the campaigns we just restored.
const restoredCampIds = new Set(campsToInsert.map(c => c.id));
const msgsToInsert = backup.messages.filter(m => restoredCampIds.has(m.campaign_id));
console.log(`Inserting ${msgsToInsert.length} campaign_messages…`);
for (let i = 0; i < msgsToInsert.length; i += CHUNK) {
  const slice = msgsToInsert.slice(i, i + CHUNK);
  const { error } = await svc.from("campaign_messages").insert(slice);
  if (error) { console.error(`Insert message chunk failed at ${i}:`, error); process.exit(1); }
}
console.log("  done.");

// Verify.
const { count: campCount } = await svc.from("campaigns").select("*", { count: "exact", head: true }).eq("company_bio_id", ARQY);
console.log(`\nArqy campaigns now in DB: ${campCount}`);
const { data: statusBreakdown } = await svc.from("campaigns").select("status").eq("company_bio_id", ARQY);
const byStatus = {};
for (const c of statusBreakdown) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
console.log(`By status:`, byStatus);

console.log("\nDone. The 3 historic flows should now appear under Past Flows in /leads/ticket/[id] for each Arqy ICP.");
