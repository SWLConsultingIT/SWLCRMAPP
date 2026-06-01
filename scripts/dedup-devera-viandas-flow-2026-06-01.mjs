// De-dupe the "Viandas - Buenos Aires" flow (De Vera Grill).
// Root cause: the eligible-leads query truncated its active-campaign set at
// Supabase's 1000-row default, so already-enrolled leads reappeared in "Add
// Leads" and got re-added — 225 duplicate campaign rows, all at step 0.
// Strategy: keep the EARLIEST-created row per lead, delete the rest.
// Safety: all duplicate rows verified at current_step=0 (no dispatch history).
// Backs up every row it deletes before deleting.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(envText.split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const NAME = "Viandas - Buenos Aires";
const APPLY = process.argv.includes("--apply");

const { data: rows, error } = await svc.from("campaigns")
  .select("*").eq("name", NAME).order("created_at", { ascending: true });
if (error) { console.error("ERR", error); process.exit(1); }

const byLead = {};
rows.forEach(r => { (byLead[r.lead_id] ||= []).push(r); });
const toDelete = [];
for (const [, list] of Object.entries(byLead)) {
  if (list.length <= 1) continue;
  // list is ascending by created_at → keep [0], delete the rest
  const extras = list.slice(1);
  // Guard: never delete a row with progress
  for (const e of extras) {
    if ((e.current_step ?? 0) > 0) { console.error("ABORT: extra row has progress", e.id); process.exit(1); }
    toDelete.push(e);
  }
}
console.log(`Flow "${NAME}": ${rows.length} rows, ${Object.keys(byLead).length} distinct leads, ${toDelete.length} duplicate rows to delete.`);

const stamp = "2026-06-01";
const backupPath = join(__dirname, `dedup-devera-viandas-flow-${stamp}.backup.json`);
writeFileSync(backupPath, JSON.stringify(toDelete, null, 2));
console.log(`Backup of rows-to-delete written → ${backupPath}`);

if (!APPLY) { console.log("\nDRY RUN. Re-run with --apply to delete."); process.exit(0); }

const ids = toDelete.map(r => r.id);
let deleted = 0;
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const { error: delErr } = await svc.from("campaigns").delete().in("id", chunk);
  if (delErr) { console.error("DELETE ERR", delErr); process.exit(1); }
  deleted += chunk.length;
}
console.log(`Deleted ${deleted} duplicate rows.`);

// Verify
const { data: after } = await svc.from("campaigns").select("lead_id").eq("name", NAME);
const distinct = new Set(after.map(r => r.lead_id)).size;
console.log(`AFTER: ${after.length} rows, ${distinct} distinct leads, ${after.length - distinct} remaining dupes.`);
