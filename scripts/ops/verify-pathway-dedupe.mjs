// Post-hoc check: fetch every Pathway lead, decrypt, look for any duplicate
// LinkedIn URL or work-email between (a) the newly imported unified-ICP leads
// and (b) the pre-existing leads, AND within the new batch itself.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecipheriv } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(envText.split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PATHWAY_BIO_ID = "10969697-f900-47f5-ba64-2287fa72b44d";
const NEW_ASSET_ICP   = "c99841b8-5413-414e-a2b0-f89da2f37e68";
const NEW_INVOICE_ICP = "85cf66f2-fac6-49e3-8508-ad2d094abeab";

const VERSION = 1, IV_LEN = 12, TAG_LEN = 16, HEADER_LEN = 1 + IV_LEN + TAG_LEN;
function byteaFromSupabase(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "base64");
  }
  if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  throw new Error("Unsupported bytea shape");
}
function decryptPayload(blob, key) {
  if (blob[0] !== VERSION) throw new Error(`Unsupported version ${blob[0]}`);
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, HEADER_LEN);
  const ct = blob.subarray(HEADER_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
}
const normalizeLI = (u) => !u ? null : String(u).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/$/, "").trim() || null;
const normalizeEmail = (e) => !e ? null : String(e).trim().toLowerCase() || null;

async function main() {
  const tenantKey = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");

  // Fetch ALL Pathway leads
  const { data: leads, error } = await svc.from("leads")
    .select("id, icp_profile_id, source, encrypted_payload, primary_work_email, primary_linkedin_url, created_at")
    .eq("company_bio_id", PATHWAY_BIO_ID)
    .order("created_at", { ascending: true });
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`→ ${leads.length} total Pathway leads\n`);

  // Decrypt + classify
  const newAsset = [];
  const newInvoice = [];
  const old = [];
  for (const l of leads) {
    let li = l.primary_linkedin_url || null;
    let em = l.primary_work_email || null;
    if (l.source === "client" && l.encrypted_payload) {
      try {
        const d = decryptPayload(byteaFromSupabase(l.encrypted_payload), tenantKey);
        li = li || d.primary_linkedin_url || null;
        em = em || d.primary_work_email || null;
      } catch { /* skip */ }
    }
    const rec = { id: l.id, li: normalizeLI(li), em: normalizeEmail(em) };
    if (l.icp_profile_id === NEW_ASSET_ICP) newAsset.push(rec);
    else if (l.icp_profile_id === NEW_INVOICE_ICP) newInvoice.push(rec);
    else old.push(rec);
  }
  const newAll = [...newAsset, ...newInvoice];
  console.log(`  Old (pre-import):   ${old.length}`);
  console.log(`  New Asset:          ${newAsset.length}`);
  console.log(`  New Invoice:        ${newInvoice.length}`);
  console.log(`  New total:          ${newAll.length}\n`);

  // Build dedupe sets from OLD leads
  const oldLI = new Set();
  const oldEM = new Set();
  for (const r of old) {
    if (r.li) oldLI.add(r.li);
    if (r.em) oldEM.add(r.em);
  }

  // Check NEW vs OLD overlaps
  const crossLI = newAll.filter(r => r.li && oldLI.has(r.li));
  const crossEM = newAll.filter(r => r.em && oldEM.has(r.em));
  console.log("══ New vs Old overlaps ══");
  console.log(`  LinkedIn duplicates (new vs old): ${crossLI.length}`);
  console.log(`  Email duplicates    (new vs old): ${crossEM.length}`);
  if (crossLI.length) crossLI.slice(0, 5).forEach(r => console.log(`    · ${r.id} li=${r.li}`));
  if (crossEM.length) crossEM.slice(0, 5).forEach(r => console.log(`    · ${r.id} em=${r.em}`));

  // Check WITHIN-batch dupes
  console.log("\n══ Within new batch (all 300) ══");
  const liCount = new Map();
  const emCount = new Map();
  for (const r of newAll) {
    if (r.li) liCount.set(r.li, (liCount.get(r.li) ?? 0) + 1);
    if (r.em) emCount.set(r.em, (emCount.get(r.em) ?? 0) + 1);
  }
  const liDupes = [...liCount.entries()].filter(([, c]) => c > 1);
  const emDupes = [...emCount.entries()].filter(([, c]) => c > 1);
  console.log(`  Repeated LinkedIn URLs: ${liDupes.length}`);
  console.log(`  Repeated work emails:   ${emDupes.length}`);
  if (liDupes.length) liDupes.slice(0, 5).forEach(([k, c]) => console.log(`    · ${k} ×${c}`));
  if (emDupes.length) emDupes.slice(0, 5).forEach(([k, c]) => console.log(`    · ${k} ×${c}`));

  // Cross-product (Asset vs Invoice within new)
  console.log("\n══ Cross-product (Asset vs Invoice within new) ══");
  const assetLI = new Set(newAsset.map(r => r.li).filter(Boolean));
  const crossProductLI = newInvoice.filter(r => r.li && assetLI.has(r.li));
  const assetEM = new Set(newAsset.map(r => r.em).filter(Boolean));
  const crossProductEM = newInvoice.filter(r => r.em && assetEM.has(r.em));
  console.log(`  Same person in both Asset + Invoice (LinkedIn): ${crossProductLI.length}`);
  console.log(`  Same person in both Asset + Invoice (email):    ${crossProductEM.length}`);
  if (crossProductLI.length) crossProductLI.slice(0, 5).forEach(r => console.log(`    · ${r.id} li=${r.li}`));
  if (crossProductEM.length) crossProductEM.slice(0, 5).forEach(r => console.log(`    · ${r.id} em=${r.em}`));

  const total = crossLI.length + crossEM.length + liDupes.length + emDupes.length + crossProductLI.length + crossProductEM.length;
  console.log(`\n${total === 0 ? "✓ Zero duplicates detected." : `✘ ${total} duplicate signals found — investigate above.`}`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
