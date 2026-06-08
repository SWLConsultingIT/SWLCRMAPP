// Confirm that:
//   - Every NEW Asset-ICP lead's ZoomInfo external_id came from 006-asset-001
//   - Every NEW Invoice-ICP lead's ZoomInfo external_id came from 005-invoice-001
//   - And no Asset row came from 005, no Invoice row came from 006

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecipheriv } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const REPO = dirname(dirname(ROOT));

const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(envText.split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PATHWAY_BIO_ID  = "10969697-f900-47f5-ba64-2287fa72b44d";
const NEW_ASSET_ICP   = "c99841b8-5413-414e-a2b0-f89da2f37e68";
const NEW_INVOICE_ICP = "85cf66f2-fac6-49e3-8508-ad2d094abeab";

const CSV_INVOICE = join(REPO, "sheet", "Pathway", "asset e invoice", "005-invoice-001-PACF.xlsx - ZoomInfo Leads Enriched.csv");
const CSV_ASSET   = join(REPO, "sheet", "Pathway", "asset e invoice", "006-asset-001-PACF.xlsx - ZoomInfo Leads Enriched.csv");

const VERSION = 1, IV_LEN = 12, TAG_LEN = 16, HEADER_LEN = 1 + IV_LEN + TAG_LEN;
function byteaFromSupabase(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return value.startsWith("\\x") ? Buffer.from(value.slice(2), "hex") : Buffer.from(value, "base64");
  if (value?.type === "Buffer") return Buffer.from(value.data);
  throw new Error("bad bytea");
}
function decrypt(blob, key) {
  if (blob[0] !== VERSION) throw new Error("ver");
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, HEADER_LEN);
  const ct = blob.subarray(HEADER_LEN);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}
const normLI = (u) => !u ? null : String(u).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/$/, "").trim() || null;

const key = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");

// 1. Build sets of ZoomInfo IDs + LinkedIn URLs per source CSV
function indexCsv(path) {
  const txt = readFileSync(path, "utf8");
  const parsed = Papa.parse(txt, { header: true, skipEmptyLines: true });
  const ids = new Set();
  const lis = new Set();
  for (const r of parsed.data) {
    if (r.external_id) ids.add(String(r.external_id).trim());
    const li = normLI(r.linkedin_url);
    if (li) lis.add(li);
  }
  return { ids, lis, total: parsed.data.length };
}

const invoiceCsv = indexCsv(CSV_INVOICE);
const assetCsv   = indexCsv(CSV_ASSET);
console.log(`Source CSVs:`);
console.log(`  005 invoice → ${invoiceCsv.total} rows · ${invoiceCsv.ids.size} ZoomInfo IDs · ${invoiceCsv.lis.size} LinkedIn URLs`);
console.log(`  006 asset   → ${assetCsv.total} rows · ${assetCsv.ids.size} ZoomInfo IDs · ${assetCsv.lis.size} LinkedIn URLs`);

// 2. Fetch every NEW lead under the two unified ICPs, decrypt, check source.
const { data: newLeads } = await svc.from("leads")
  .select("id, icp_profile_id, encrypted_payload")
  .eq("company_bio_id", PATHWAY_BIO_ID)
  .in("icp_profile_id", [NEW_ASSET_ICP, NEW_INVOICE_ICP]);

const tally = {
  Asset:   { fromInvoiceCsv: 0, fromAssetCsv: 0, fromBoth: 0, fromNeither: 0 },
  Invoice: { fromInvoiceCsv: 0, fromAssetCsv: 0, fromBoth: 0, fromNeither: 0 },
};
const counts = { Asset: 0, Invoice: 0 };
const violations = [];

for (const l of newLeads ?? []) {
  let p;
  try { p = decrypt(byteaFromSupabase(l.encrypted_payload), key); }
  catch { continue; }
  const product = l.icp_profile_id === NEW_ASSET_ICP ? "Asset" : "Invoice";
  counts[product]++;
  const zid = String(p.enrichment?.["ZoomInfo ID"] ?? "").trim() || null;
  const li = normLI(p.primary_linkedin_url);
  const inInv = !!(zid && invoiceCsv.ids.has(zid)) || !!(li && invoiceCsv.lis.has(li));
  const inAst = !!(zid && assetCsv.ids.has(zid))   || !!(li && assetCsv.lis.has(li));
  if (inInv && inAst) tally[product].fromBoth++;
  else if (inInv)     tally[product].fromInvoiceCsv++;
  else if (inAst)     tally[product].fromAssetCsv++;
  else                tally[product].fromNeither++;

  // The rule: Asset leads should be in 006 (asset CSV). Invoice leads should be in 005 (invoice CSV).
  if (product === "Asset" && !inAst) violations.push({ product, id: l.id, li, zid, where: "not in 006" });
  if (product === "Invoice" && !inInv) violations.push({ product, id: l.id, li, zid, where: "not in 005" });
}

console.log(`\nNew leads by ICP:`);
for (const product of ["Asset", "Invoice"]) {
  const t = tally[product];
  console.log(`  ${product} (${counts[product]} leads):`);
  console.log(`    from 005 invoice only : ${t.fromInvoiceCsv}`);
  console.log(`    from 006 asset only   : ${t.fromAssetCsv}`);
  console.log(`    in BOTH csvs          : ${t.fromBoth}`);
  console.log(`    in neither            : ${t.fromNeither}`);
}

console.log(`\n${violations.length === 0 ? "✓ Every Asset lead came from 006; every Invoice lead came from 005." : `✘ ${violations.length} violations:`}`);
for (const v of violations.slice(0, 10)) console.log(`  ${v.product} ${v.id} ${v.where} · li=${v.li} · zid=${v.zid}`);
