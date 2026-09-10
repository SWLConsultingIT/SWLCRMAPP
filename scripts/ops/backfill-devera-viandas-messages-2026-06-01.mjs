// Backfill campaign_messages for the 216 De Vera "Viandas" leads that the
// broken add-leads enrolled with ZERO messages (dead in the flow).
// Copies the flow's per-step template (content/channel/subject) from a sibling
// that has messages, and seeds: step 0 (CR) + non-linkedin step 1 = queued,
// linkedin steps 1+ = draft — exactly like wizard enrollment. Stamps
// metadata.fixed_by for audit. Backs up the affected campaign rows first.
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
const STAMP = "2026-06-01";
const APPLY = process.argv.includes("--apply");

// 1. All campaign rows in the flow
const { data: sibs } = await svc.from("campaigns").select("id, lead_id, status, current_step, channel").eq("name", NAME);
const sibIds = sibs.map(s => s.id);

// 2. Existing messages → which campaign rows HAVE messages, and the template
let allMsgs = [];
for (let i = 0; i < sibIds.length; i += 100) {
  const { data } = await svc.from("campaign_messages").select("campaign_id, step_number, channel, content, metadata").in("campaign_id", sibIds.slice(i, i + 100));
  allMsgs = allMsgs.concat(data || []);
}
const haveMsgs = new Set(allMsgs.map(m => m.campaign_id));
const templateByStep = new Map();
for (const m of allMsgs.sort((a,b)=>a.step_number-b.step_number)) {
  if (m.step_number == null || templateByStep.has(m.step_number)) continue;
  templateByStep.set(m.step_number, { step_number: m.step_number, channel: m.channel, content: m.content, subject: m.metadata?.subject ?? null });
}
const templates = [...templateByStep.values()].sort((a,b)=>a.step_number-b.step_number);
console.log("Template steps:", templates.map(t=>`${t.step_number}:${t.channel}`).join(", "));

// 3. Rows that need backfill: active, no messages
const targets = sibs.filter(s => s.status === "active" && !haveMsgs.has(s.id));
console.log(`Flow rows: ${sibs.length} | with messages: ${haveMsgs.size} | ACTIVE without messages (to backfill): ${targets.length}`);

if (templates.length === 0) { console.error("No template found — abort."); process.exit(1); }

// Backup affected rows
const backupPath = join(__dirname, `backfill-devera-viandas-messages-${STAMP}.backup.json`);
writeFileSync(backupPath, JSON.stringify(targets, null, 2));
console.log(`Backup of target campaign rows → ${backupPath}`);

const now = new Date().toISOString();
const inserts = targets.flatMap(c => templates.map(t => {
  const isFirstNonLinkedin = t.step_number === 1 && t.channel !== "linkedin";
  const startQueued = t.step_number === 0 || isFirstNonLinkedin;
  return {
    campaign_id: c.id, lead_id: c.lead_id, step_number: t.step_number,
    channel: t.channel, content: t.content,
    status: startQueued ? "queued" : "draft", created_at: now,
    metadata: { ...(t.subject ? { subject: t.subject } : {}), fixed_by: "addleads-backfill-2026-06-01" },
  };
}));
console.log(`Would insert ${inserts.length} messages (${templates.length} per lead × ${targets.length} leads).`);
const queuedCount = inserts.filter(m=>m.status==="queued").length;
console.log(`  → ${queuedCount} queued (will dispatch, throttled), ${inserts.length-queuedCount} draft.`);

if (!APPLY) { console.log("\nDRY RUN. Re-run with --apply."); process.exit(0); }

for (let i = 0; i < inserts.length; i += 200) {
  const { error } = await svc.from("campaign_messages").insert(inserts.slice(i, i + 200));
  if (error) { console.error("INSERT ERR", error); process.exit(1); }
}
const leadIds = targets.map(t => t.lead_id);
for (let i = 0; i < leadIds.length; i += 200) {
  await svc.from("leads").update({ current_channel: "linkedin" }).in("id", leadIds.slice(i, i + 200));
}
console.log(`Inserted ${inserts.length} messages for ${targets.length} leads. current_channel set.`);

// Verify
let after = [];
for (let i = 0; i < sibIds.length; i += 100) {
  const { data } = await svc.from("campaign_messages").select("campaign_id").in("campaign_id", sibIds.slice(i, i + 100));
  after = after.concat(data || []);
}
const haveNow = new Set(after.map(m => m.campaign_id));
const stillBroken = sibs.filter(s => s.status === "active" && !haveNow.has(s.id)).length;
console.log(`AFTER: active rows still without messages: ${stillBroken}`);
