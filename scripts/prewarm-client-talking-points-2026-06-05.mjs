// Pre-warm Pre-Call Briefs for the client-source leads that the local
// backfill couldn't do (their PII is encrypted; only the deployed route holds
// the tenant key to decrypt). Calls the DEPLOYED POST endpoint, which now
// decrypts + never-refuses. Re-runnable: re-queries the still-missing set each
// time, so it converges. Waits for the new deploy to be live first.
//
// Run: node scripts/prewarm-client-talking-points-2026-06-05.mjs

import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_KEY;
const APP = "https://swlcrmapp.vercel.app";
const TENANTS = ["7c02e222-be59-416d-9434-acf4685f8590", "10969697-f900-47f5-ba64-2287fa72b44d"];
const CONCURRENCY = 5;

async function remaining() {
  // client-source, in active/paused campaign, no brief, SWL+Pathway
  const camps = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB_URL}/rest/v1/campaigns?select=lead_id,status&status=in.(active,paused)`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: `${from}-${from + 999}` } });
    const rows = await r.json(); camps.push(...rows); if (rows.length < 1000) break;
  }
  const active = new Set(camps.map(c => c.lead_id).filter(Boolean));
  const out = [];
  const filter = `source=eq.client&call_talking_points=is.null&company_bio_id=in.(${TENANTS.map(t => `"${t}"`).join(",")})`;
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB_URL}/rest/v1/leads?select=id&${filter}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: `${from}-${from + 999}` } });
    const rows = await r.json(); out.push(...rows.filter(l => active.has(l.id))); if (rows.length < 1000) break;
  }
  return out.map(l => l.id);
}

async function post(id) {
  const r = await fetch(`${APP}/api/leads/${id}/talking-points`, { method: "POST" });
  const d = await r.json().catch(() => ({}));
  return r.ok && Array.isArray(d.points) && d.points.length > 0;
}

async function main() {
  let ids = await remaining();
  console.log(`Remaining client-source leads without brief: ${ids.length}`);
  if (ids.length === 0) return;

  // Wait until the new deploy (decrypt + never-refuse) is live: probe one id.
  process.stdout.write("Waiting for deploy");
  for (let i = 0; i < 30; i++) {
    if (await post(ids[0])) { console.log(" — live ✓"); break; }
    process.stdout.write(".");
    await new Promise(res => setTimeout(res, 15000));
  }

  ids = await remaining(); // re-query (the probe may have done one)
  let ok = 0, fail = 0, done = 0;
  const queue = [...ids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try { (await post(id)) ? ok++ : fail++; } catch { fail++; }
      if (++done % 20 === 0) console.log(`  ${done}/${ids.length} (ok ${ok}, fail ${fail})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`DONE — ok ${ok}, fail ${fail}, total ${ids.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
