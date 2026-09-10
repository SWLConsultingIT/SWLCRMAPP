#!/usr/bin/env node
// Detail of every failed campaign_message for Pathway, grouped by
// error class so Fran can act on whole buckets at once.

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

const BIO = "10969697-f900-47f5-ba64-2287fa72b44d";

// Decrypt helpers (mirror lib/leads-crypto.ts)
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
  const plaintext = Buffer.concat([decipher.update(ciphered), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
const KEY = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");

// Pull every failed message
const all = [];
let from = 0;
while (true) {
  const { data } = await svc.from("campaign_messages")
    .select("id, lead_id, campaign_id, step_number, channel, status, created_at, error_details, leads!inner(company_bio_id, source, encrypted_payload, primary_first_name, primary_last_name, primary_linkedin_url, company_name), campaigns(name)")
    .eq("status", "failed")
    .eq("leads.company_bio_id", BIO)
    .order("created_at", { ascending: false })
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Total failed messages in Pathway: ${all.length}\n`);

// Hydrate encrypted leads in place
let hydrated = 0, hydrateFailed = 0;
for (const m of all) {
  const l = m.leads;
  if (l?.source !== "client" || !l.encrypted_payload) continue;
  try {
    const blob = bufferFromBytea(l.encrypted_payload);
    const payload = decryptBlob(blob, KEY);
    if (payload) { Object.assign(l, payload); hydrated++; }
  } catch { hydrateFailed++; }
}
if (hydrated > 0) console.log(`(decrypted ${hydrated} client-source leads, ${hydrateFailed} failed)\n`);

function classify(err) {
  const e = (err ?? "").toLowerCase();
  if (e.includes("profile is not locked") || e.includes("recipient id is valid")) return "Recipient profile LOCKED / private / deleted";
  if (e.includes("name mismatch")) return "Name mismatch (slug → wrong person)";
  if (e.includes("temporary provider limit") || e.includes("429")) return "Rate-limited";
  if (e.includes("already sent recently") || e.includes("already invited")) return "Already invited (LinkedIn 3-week block)";
  if (e.includes("restricted")) return "Seller account RESTRICTED";
  if (e.includes("no linkedin slug")) return "Lead has no LinkedIn URL";
  if (e.includes("unipile_account_id")) return "Seller has no Unipile account";
  if (e.includes("unresolved placeholder")) return "Unresolved {{placeholder}}";
  if (e.includes("lead or campaign missing")) return "Lead/campaign deleted";
  return "Other: " + (err ?? "").slice(0, 60);
}

const byError = new Map();
for (const m of all) {
  const k = classify(m.error_details);
  if (!byError.has(k)) byError.set(k, []);
  byError.get(k).push(m);
}

console.log("Summary by cause:");
for (const [cls, rows] of [...byError.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(rows.length).padStart(3)}×  ${cls}`);
}

// Breakdown by seller
const bySeller = new Map();
for (const m of all) {
  // pull seller from campaign? Skip — we already see seller in dashboard.
  const k = m.campaigns?.name ?? "(no flow)";
  bySeller.set(k, (bySeller.get(k) ?? 0) + 1);
}
console.log("\nBy flow:");
for (const [k, n] of [...bySeller.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${String(n).padStart(3)}×  ${k}`);
}

// Time bucket
const byDate = new Map();
for (const m of all) {
  const d = String(m.created_at).slice(0, 10);
  byDate.set(d, (byDate.get(d) ?? 0) + 1);
}
console.log("\nBy date:");
for (const [d, n] of [...byDate.entries()].sort()) console.log(`  ${d}  ${n}`);

// Per-group sample detail
for (const [cls, rows] of byError) {
  console.log(`\n──  ${cls}  (${rows.length})  ──`);
  for (const r of rows.slice(0, 15)) {
    const when = r.created_at?.slice(0, 16).replace("T", " ");
    const name = `${r.leads.primary_first_name ?? ""} ${r.leads.primary_last_name ?? ""}`.trim() || "(no name)";
    const li = r.leads.primary_linkedin_url ?? "(no URL)";
    console.log(`  ${when}  ${name.padEnd(26).slice(0,26)}  ${(r.leads.company_name ?? "").padEnd(34).slice(0,34)}  ${li.slice(0,70)}`);
  }
  if (rows.length > 15) console.log(`  … +${rows.length - 15} more`);
}
