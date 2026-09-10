#!/usr/bin/env node
// Cross-match the 95 source=client encrypted leads in De Vera Grill
// against the 473 source=swl plain leads imported from the recent CSV.
// Decrypts the client leads' encrypted_payload locally so we can
// build the same identity keys we'd build for a plain lead.
//
// Why this script exists: lib/lead-import-dedup.ts (and the wizard's
// dry-run) only read plaintext columns. For tenants where existing
// leads were imported under encryption, every column the dedup needs
// (first/last name, LinkedIn URL, email, phone, company) is NULL on
// the row — the value lives inside encrypted_payload. Without
// decrypting, the wizard is blind to those leads and lets the CSV
// re-import them as duplicates.
//
// Modes:
//   node dedup-devera-encrypted.mjs          # dry-run
//   node dedup-devera-encrypted.mjs --apply  # delete the plain dupes

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

// Crypto constants — mirror lib/leads-crypto.ts exactly.
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;
const KEY_LENGTH = 32;
const ALGORITHM = "aes-256-gcm";

function getStandardKey() {
  const b64 = env.LEADS_ENCRYPTION_KEY;
  if (!b64) throw new Error("LEADS_ENCRYPTION_KEY not in .env.local");
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LENGTH) throw new Error(`Key length ${key.length} != ${KEY_LENGTH}`);
  return key;
}

function bufferFromBytea(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "base64");
  }
  throw new Error(`Unsupported bytea shape: ${typeof value}`);
}

function decrypt(blob, key) {
  if (blob.length < HEADER_LENGTH) throw new Error("Ciphertext too short");
  const version = blob[0];
  if (version !== VERSION) throw new Error(`Unsupported version: ${version}`);
  const iv = blob.subarray(1, 1 + IV_LENGTH);
  const tag = blob.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const ciphered = blob.subarray(HEADER_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphered), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

// ── Normalization (same as lib/lead-import-dedup.ts) ──
function normLI(url) {
  if (!url) return "";
  const s = String(url).trim().toLowerCase();
  if (!s.includes("linkedin.com")) return "";
  const m = s.match(/\/(in|company|pub|school)\/([^/?#]+)/);
  return m ? `${m[1]}:${m[2]}` : "";
}
function normEmail(e) { return e ? String(e).trim().toLowerCase() : ""; }
function normPhone(p) {
  if (!p) return "";
  const d = String(p).replace(/[^0-9]/g, "");
  return d.length < 7 ? "" : d.slice(-10);
}
function normText(t) {
  if (!t) return "";
  return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fingerprintsOf(l) {
  const keys = [];
  const li = normLI(l.primary_linkedin_url);
  if (li) keys.push(`LI:${li}`);
  const co = normText(l.company_name);
  const we = normEmail(l.primary_work_email);
  if (we && co) keys.push(`WE:${we}|${co}`);
  const pe = normEmail(l.primary_personal_email);
  if (pe && co) keys.push(`PE:${pe}|${co}`);
  const ph = normPhone(l.primary_phone);
  if (ph) keys.push(`PH:${ph}`);
  const fn = normText(l.primary_first_name);
  const ln = normText(l.primary_last_name);
  if (fn && ln && co) keys.push(`NM:${fn}|${ln}|${co}`);
  return keys;
}

// ── Union-find ──
class DSU {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) { this.parent.set(x, x); return x; }
    let p = this.parent.get(x);
    while (p !== this.parent.get(p)) p = this.parent.get(p);
    this.parent.set(x, p);
    return p;
  }
  union(a, b) {
    const ra = this.find(a); const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const { data: bios } = await svc.from("company_bios").select("id, encryption_mode").ilike("company_name", "%de vera%");
const BIO = bios[0].id;
const MODE = bios[0].encryption_mode;
console.log(`Tenant: De Vera Grill (${BIO})`);
console.log(`Encryption mode: ${MODE}`);
console.log(`Apply mode: ${apply ? "YES — will DELETE plain duplicates" : "DRY-RUN"}\n`);

if (MODE !== "standard") {
  console.error(`Mode ${MODE} not supported by this script. Sovereign mode would need the tenant endpoint.`);
  process.exit(1);
}
const key = getStandardKey();

// Fetch every lead, paginated
const all = [];
let from = 0;
while (true) {
  const { data } = await svc.from("leads")
    .select("id, source, primary_first_name, primary_last_name, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, company_name, encrypted_payload, created_at")
    .eq("company_bio_id", BIO)
    .order("created_at", { ascending: true })
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Loaded ${all.length} leads.`);

// Hydrate: for source=client rows, replace plaintext columns with decrypted values.
let decrypted = 0, failedDecrypt = 0;
for (const l of all) {
  if (l.source !== "client" || !l.encrypted_payload) continue;
  try {
    const blob = bufferFromBytea(l.encrypted_payload);
    const payload = decrypt(blob, key);
    Object.assign(l, payload);
    decrypted++;
  } catch (err) {
    failedDecrypt++;
    console.warn(`  decrypt failed for ${l.id}: ${err.message}`);
  }
}
console.log(`Hydrated ${decrypted} encrypted leads (${failedDecrypt} failed decrypt).\n`);

// Build active-campaign set
const { data: camps } = await svc.from("campaigns")
  .select("lead_id, status, leads!inner(company_bio_id)")
  .eq("leads.company_bio_id", BIO)
  .in("status", ["active", "paused", "completed"])
  .range(0, 49999);
const hasCampaign = new Set((camps ?? []).map(r => r.lead_id).filter(Boolean));
console.log(`${hasCampaign.size} leads have a campaign row.\n`);

// Build union-find from every shared identity key
const dsu = new DSU();
const keyToLeads = new Map();
for (const l of all) {
  const keys = fingerprintsOf(l);
  if (keys.length === 0) continue;
  dsu.find(l.id);
  for (const k of keys) {
    const arr = keyToLeads.get(k) ?? [];
    arr.push(l.id);
    keyToLeads.set(k, arr);
  }
}
for (const [, ids] of keyToLeads) {
  for (let i = 1; i < ids.length; i++) dsu.union(ids[0], ids[i]);
}

// Group + filter to groups containing at least one source=client and
// one source=swl (the case Fran flagged: encrypted original + plain
// duplicate from the recent CSV). Pure all-swl or all-client groups
// were already handled by the previous dedup pass.
const groups = new Map();
const leadById = new Map(all.map(l => [l.id, l]));
for (const l of all) {
  if (!dsu.parent.has(l.id)) continue;
  const root = dsu.find(l.id);
  if (!groups.has(root)) groups.set(root, []);
  groups.get(root).push(l);
}
const dupGroups = [...groups.entries()].filter(([, ls]) => ls.length > 1);
console.log(`Duplicate groups found: ${dupGroups.length}\n`);

const toDelete = [];
for (const [root, ls] of dupGroups) {
  // Sort: prefer lead with campaign, then oldest (the encrypted batch
  // is the older 21-may pour, so it naturally wins as the keeper).
  const sorted = [...ls].sort((a, b) => {
    const aHas = hasCampaign.has(a.id) ? 0 : 1;
    const bHas = hasCampaign.has(b.id) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return String(a.created_at).localeCompare(String(b.created_at));
  });
  const keep = sorted[0];
  const drop = sorted.slice(1).filter(l => !hasCampaign.has(l.id));
  if (drop.length === 0) continue;
  console.log(`[group ${root.slice(0, 8)}]`);
  console.log(`  KEEP   ${keep.id}  src=${keep.source}  "${keep.primary_first_name} ${keep.primary_last_name}" · ${keep.company_name} · ${hasCampaign.has(keep.id) ? "✓ camp" : "no camp"}`);
  for (const d of drop) {
    console.log(`  DELETE ${d.id}  src=${d.source}  "${d.primary_first_name} ${d.primary_last_name}" · ${d.company_name}`);
    toDelete.push(d.id);
  }
}
void leadById;

console.log(`\nTotal to delete: ${toDelete.length}`);

if (!apply) {
  console.log("Dry-run. Re-run with --apply to delete.");
  process.exit(0);
}
if (toDelete.length === 0) {
  console.log("Nothing to delete.");
  process.exit(0);
}

let deleted = 0;
for (let i = 0; i < toDelete.length; i += 100) {
  const slice = toDelete.slice(i, i + 100);
  const { error } = await svc.from("leads").delete().in("id", slice);
  if (error) { console.error(`chunk ${i}: ${error.message}`); continue; }
  deleted += slice.length;
  console.log(`  deleted ${deleted}/${toDelete.length}`);
}
console.log(`Done. Deleted ${deleted}.`);
