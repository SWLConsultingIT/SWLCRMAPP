#!/usr/bin/env node
// Close out the Pathway failed-message backlog:
//
//   • 21 leads where Unipile returned "recipient profile locked" →
//     no retry is going to work; LinkedIn won't let us invite them.
//     Mark campaign closed_lost with stop_reason='recipient_locked'
//     and archive the lead so it stays out of future picks.
//
//   • 1 wrong-Sumit (name mismatch where the slug resolved to a
//     different real person) → same as above.
//
//   • 1 Bob Dillenschneider — slug 'bob-dillenschneider' is the
//     same person as primary_first_name='Robert', the matcher just
//     rejects the alias. SKIPPED here — Fran reviews manually,
//     either rename the lead or relax the matcher.
//
// Modes:
//   node close-pathway-locked.mjs          # dry-run
//   node close-pathway-locked.mjs --apply  # write

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { createDecipheriv } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

const BIO = "10969697-f900-47f5-ba64-2287fa72b44d";

// Decrypt helpers
const VERSION = 1, IV_LENGTH = 12, TAG_LENGTH = 16, HEADER_LENGTH = 29;
function bufferFromBytea(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === "string") {
    if (v.startsWith("\\x")) return Buffer.from(v.slice(2), "hex");
    return Buffer.from(v, "base64");
  }
  return null;
}
function decryptBlob(blob, key) {
  if (!blob || blob.length < HEADER_LENGTH || blob[0] !== VERSION) return null;
  const iv = blob.subarray(1, 1 + IV_LENGTH);
  const tag = blob.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const ciphered = blob.subarray(HEADER_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphered), decipher.final()]).toString("utf8"));
}
const KEY = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");

const { data: rows } = await svc.from("campaign_messages")
  .select("id, lead_id, campaign_id, error_details, leads!inner(company_bio_id, source, encrypted_payload, primary_first_name, primary_last_name, company_name)")
  .eq("status", "failed")
  .eq("leads.company_bio_id", BIO);

for (const m of rows ?? []) {
  const l = m.leads;
  if (l?.source === "client" && l.encrypted_payload) {
    try {
      const blob = bufferFromBytea(l.encrypted_payload);
      const payload = decryptBlob(blob, KEY);
      if (payload) Object.assign(l, payload);
    } catch {}
  }
}

function classify(err) {
  const e = (err ?? "").toLowerCase();
  if (e.includes("profile is not locked") || e.includes("recipient id is valid")) return "locked";
  if (e.includes("name mismatch")) return "mismatch";
  return "other";
}

const toClose = [];      // [{ campaignId, leadId, name, reason }]
const skipped = [];      // [{ id, name, why }]

for (const m of rows ?? []) {
  const l = m.leads;
  const name = `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "(no name)";
  const cls = classify(m.error_details);
  if (cls === "locked") {
    toClose.push({ campaignId: m.campaign_id, leadId: m.lead_id, name, co: l.company_name, reason: "recipient_locked" });
  } else if (cls === "mismatch") {
    // Specifically skip the Bob/Robert Dillenschneider case — same
    // person, just an alias the matcher doesn't know. Close everyone
    // else (e.g. Sumit Chanda where the slug pointed to a different
    // real Sumit Chanda).
    const li = (l.primary_linkedin_url ?? "").toLowerCase();
    const isBobAlias = /bob-dillensch/.test(li) && /robert/i.test(l.primary_first_name ?? "");
    if (isBobAlias) {
      skipped.push({ id: m.id, name, why: "Robert/Bob alias — manual review needed (rename lead OR relax matcher)" });
    } else {
      toClose.push({ campaignId: m.campaign_id, leadId: m.lead_id, name, co: l.company_name, reason: "name_mismatch_wrong_person" });
    }
  } else {
    skipped.push({ id: m.id, name, why: "uncategorised error: " + (m.error_details ?? "").slice(0, 60) });
  }
}

console.log(`Closing ${toClose.length} (locked + wrong-person mismatch):`);
for (const c of toClose) console.log(`  ${c.leadId.slice(0,8)}  ${c.name.padEnd(28).slice(0,28)}  ${(c.co ?? "").padEnd(36).slice(0,36)}  reason=${c.reason}`);
console.log(`\nSkipping ${skipped.length}:`);
for (const s of skipped) console.log(`  ${s.id.slice(0,8)}  ${s.name.padEnd(28).slice(0,28)}  ${s.why}`);

if (!apply) {
  console.log("\nDry-run. Re-run with --apply to write.");
  process.exit(0);
}

console.log("\nApplying…");
const now = new Date().toISOString();
let campOk = 0, leadOk = 0, errs = 0;

for (const c of toClose) {
  const campRes = await svc.from("campaigns")
    .update({ status: "closed_lost", stop_reason: c.reason, completed_at: now })
    .eq("id", c.campaignId)
    .in("status", ["active", "paused", "failed"]); // don't touch already-terminal
  if (campRes.error) { console.warn(`  campaign ${c.campaignId.slice(0,8)}: ${campRes.error.message}`); errs++; }
  else campOk++;

  const leadRes = await svc.from("leads")
    .update({ status: "closed_lost", archived: true, response_outcome: c.reason })
    .eq("id", c.leadId);
  if (leadRes.error) { console.warn(`  lead ${c.leadId.slice(0,8)}: ${leadRes.error.message}`); errs++; }
  else leadOk++;
}

console.log(`\nDone. ${campOk} campaigns closed_lost · ${leadOk} leads archived · ${errs} errors.`);
