// Remove the active campaign rows (+ their queued messages) that "Add all
// compatible" wrongly created today for leads that already had a terminal row
// in the flow (2 closed_lost re-nurture leads + 1 previously-cancelled lead).
// Keeps the older terminal row (history); deletes only the new active dupe.
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

const { data: sibs } = await svc.from("campaigns").select("id, lead_id, status, current_step, created_at").eq("name", NAME).order("created_at",{ascending:true});
const byLead={}; sibs.forEach(s=>{(byLead[s.lead_id]||=[]).push(s);});
const dupes = Object.entries(byLead).filter(([,v])=>v.length>1);

// For each duplicated lead: keep the OLDEST row, delete the rest (the new active re-adds)
const rowsToDelete = [];
for (const [, list] of dupes) {
  // list ascending by created_at → [0] oldest is kept
  list.slice(1).forEach(r => rowsToDelete.push(r));
}
console.log(`Duplicated leads: ${dupes.length} | rows to delete (new re-adds): ${rowsToDelete.length}`);
rowsToDelete.forEach(r=>console.log(`  delete row ${r.id.slice(0,8)} status=${r.status} created=${r.created_at}`));

const delIds = rowsToDelete.map(r=>r.id);
// Backup the rows AND their messages
const { data: msgs } = await svc.from("campaign_messages").select("*").in("campaign_id", delIds);
writeFileSync(join(__dirname,"remove-devera-relost-readds-2026-06-01.backup.json"), JSON.stringify({rows:rowsToDelete, messages:msgs}, null, 2));
console.log(`Backup written (${rowsToDelete.length} rows + ${msgs?.length||0} messages).`);

if (!APPLY){ console.log("\nDRY RUN. Re-run with --apply."); process.exit(0); }
const { error: me } = await svc.from("campaign_messages").delete().in("campaign_id", delIds);
if (me){ console.error("msg delete err", me); process.exit(1); }
const { error: re } = await svc.from("campaigns").delete().in("id", delIds);
if (re){ console.error("row delete err", re); process.exit(1); }
console.log(`Deleted ${delIds.length} rows + their messages.`);

// verify
const { data: after } = await svc.from("campaigns").select("lead_id").eq("name", NAME);
const distinct = new Set(after.map(r=>r.lead_id)).size;
console.log(`AFTER: ${after.length} rows, ${distinct} distinct, dupes=${after.length-distinct}`);
