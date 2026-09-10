// Recovers every Aircall call that exists in Aircall but is missing
// from our `calls` table. Runs the full pipeline per call: insert the
// row, match it to a lead by phone digits (with the Spain country-code
// strip the n8n workflow is missing), and archive the recording.
//
// Why this is needed: the n8n workflow that consumes Aircall webhooks
// has been silently dropping events (root causes audited 2026-06-02).
// Until that's fixed, every call Aircall reports is potentially a
// no-op for us. This script reconciles the gap.

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
const auth = "Basic " + Buffer.from(env.AIRCALL_API_ID + ":" + env.AIRCALL_API_TOKEN).toString("base64");

// Window: last 30 days. Aircall's call retention defaults are long
// enough that older orphans would already be unrecoverable on their
// end too. The script is idempotent — re-running just skips calls
// already mapped (aircall_call_id exists in DB).
const DAYS = 30;
const now = Math.floor(Date.now() / 1000);
const fromTs = now - DAYS * 86400;

console.log(`Pulling Aircall calls from the last ${DAYS} days…`);

// Paginated fetch: Aircall caps per-page at 50.
const aircallCalls = [];
let page = 1;
while (true) {
  const url = `https://api.aircall.io/v1/calls?from=${fromTs}&to=${now}&per_page=50&page=${page}&order=desc`;
  const r = await fetch(url, { headers: { Authorization: auth } });
  if (!r.ok) { console.error("Aircall API error", r.status); break; }
  const body = await r.json();
  const list = body.calls ?? [];
  aircallCalls.push(...list);
  if (list.length < 50) break;
  page += 1;
  if (page > 60) break; // safety: 3000 calls cap
}
console.log(`Aircall returned ${aircallCalls.length} calls.`);

// Pull existing aircall_call_id set from DB so we know which to skip.
const existingIds = new Set();
{
  let off = 0;
  while (true) {
    const { data } = await svc.from("calls").select("aircall_call_id").not("aircall_call_id", "is", null).range(off, off + 999);
    if (!data || data.length === 0) break;
    for (const r of data) existingIds.add(String(r.aircall_call_id));
    if (data.length < 1000) break;
    off += 1000;
  }
}
console.log(`Already in DB: ${existingIds.size} calls.`);
const missing = aircallCalls.filter(c => !existingIds.has(String(c.id)));
console.log(`Missing in DB: ${missing.length} calls.`);
if (missing.length === 0) { console.log("Nothing to recover."); process.exit(0); }

// Pull every lead with a phone so we can match by digits in-memory.
console.log("Loading leads for phone matching…");
let allLeads = [];
{
  let off = 0;
  while (true) {
    const { data } = await svc.from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_phone, primary_secondary_phone, whatsapp_number, company_bio_id")
      .or("primary_phone.not.is.null,primary_secondary_phone.not.is.null,whatsapp_number.not.is.null")
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    if (data.length < 1000) break;
    off += 1000;
  }
}
console.log(`Loaded ${allLeads.length} leads with at least one phone field.`);

// Build a multi-key map: every digit-tail we know about → lead.
// Use 9, 10, AND the full digit string — covers Spain (sometimes stored
// without country code), Argentina, UK, US, etc. Match priority: longer
// tail first so a 10-digit collision doesn't beat a full-number hit.
const byFullDigits = new Map();
const byLast10 = new Map();
const byLast9 = new Map();
for (const l of allLeads) {
  for (const p of [l.primary_phone, l.primary_secondary_phone, l.whatsapp_number]) {
    if (!p) continue;
    const d = String(p).replace(/\D/g, "");
    if (d.length === 0) continue;
    if (!byFullDigits.has(d)) byFullDigits.set(d, l);
    if (d.length >= 10 && !byLast10.has(d.slice(-10))) byLast10.set(d.slice(-10), l);
    if (d.length >= 9 && !byLast9.has(d.slice(-9))) byLast9.set(d.slice(-9), l);
    // Spain: lead may be stored without country code. Push the 9-digit
    // Spanish-style number under the same key the call's stripped form
    // will produce so the match works either way.
    if (d.length === 11 && d.startsWith("34")) {
      const stripped = d.slice(2);
      if (!byLast9.has(stripped)) byLast9.set(stripped, l);
    }
  }
}

function matchLead(rawDigits) {
  const d = String(rawDigits).replace(/\D/g, "");
  if (!d) return null;
  if (byFullDigits.has(d)) return byFullDigits.get(d);
  if (d.length >= 10 && byLast10.has(d.slice(-10))) return byLast10.get(d.slice(-10));
  // Spain country-code strip: incoming number like 34943108219 — try the
  // 9-digit national form first since Spanish PSTN numbers are 9 long.
  if (d.startsWith("34") && d.length === 11) {
    const sp = d.slice(2);
    if (byLast9.has(sp)) return byLast9.get(sp);
  }
  if (d.length >= 9 && byLast9.has(d.slice(-9))) return byLast9.get(d.slice(-9));
  return null;
}

const results = { inserted: 0, archived: 0, no_audio: 0, no_lead: 0, upload_fail: 0, download_fail: 0 };

for (const c of missing) {
  const startedAt = c.started_at ? new Date(c.started_at * 1000).toISOString() : null;
  const endedAt = c.ended_at ? new Date(c.ended_at * 1000).toISOString() : null;
  const lead = c.raw_digits ? matchLead(c.raw_digits) : null;
  if (!lead) results.no_lead += 1;
  const status = c.voicemail ? "voicemail" : (c.duration && c.duration > 0 && c.answered_at) ? "answered" : c.answered_at ? "answered" : "missed";
  const payload = {
    aircall_call_id: c.id,
    lead_id: lead?.id ?? null,
    direction: c.direction,
    status,
    phone_number: c.raw_digits,
    duration: c.duration ?? null,
    started_at: startedAt,
    ended_at: endedAt,
    recording_url: c.recording ?? c.asset ?? c.voicemail ?? null,
  };
  const { data: ins, error } = await svc.from("calls").insert(payload).select("id").single();
  if (error) {
    console.log(`  [insert err] aircall=${c.id}: ${error.message}`);
    continue;
  }
  results.inserted += 1;
  const callRowId = ins.id;

  // Archive recording if Aircall returned a URL.
  const recUrl = c.recording ?? c.asset ?? c.voicemail ?? null;
  if (!recUrl) { results.no_audio += 1; continue; }
  const dl = await fetch(recUrl);
  if (!dl.ok) {
    results.download_fail += 1;
    console.log(`  [dl ${dl.status}] aircall=${c.id}`);
    continue;
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  const ct = dl.headers.get("content-type") ?? "audio/mpeg";
  if (!ct.startsWith("audio/") && !ct.startsWith("application/octet-stream")) {
    results.upload_fail += 1;
    console.log(`  [bad ct] aircall=${c.id}: content-type=${ct}`);
    continue;
  }
  const tenant = lead?.company_bio_id ?? "unscoped";
  const path = `${tenant}/${callRowId}.mp3`;
  const { error: upErr } = await svc.storage.from("call-recordings").upload(path, buf, { contentType: ct, upsert: true });
  if (upErr) {
    results.upload_fail += 1;
    console.log(`  [up err] aircall=${c.id}: ${upErr.message}`);
    continue;
  }
  await svc.from("calls").update({ recording_storage_path: path }).eq("id", callRowId);
  results.archived += 1;
  const leadLabel = lead ? `${lead.primary_first_name} ${lead.primary_last_name} @ ${lead.company_name}` : "(unmatched)";
  console.log(`  ✓ aircall=${c.id} → ${path} (${(buf.length/1024).toFixed(0)} KB) · ${leadLabel}`);
}

console.log("\nDone.", results);
