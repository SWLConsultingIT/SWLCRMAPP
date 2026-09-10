// Hard proof that:
//   - The 150 Asset-ICP leads were picked from CSV 006 (asset) ONLY.
//   - The 150 Invoice-ICP leads were picked from CSV 005 (invoice) ONLY.
//
// We don't trust "this contact appears in both CSVs" (most do — same person
// can be HOT for both products). The proof checks the actual row payload we
// pulled at import time, stamped into enrichment.product + import_seq +
// the row's vertical/Reason which differ between the two source CSVs.

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
function byteaFromSupabase(v) { if (typeof v === "string") return v.startsWith("\\x") ? Buffer.from(v.slice(2),"hex") : Buffer.from(v,"base64"); if (Buffer.isBuffer(v)) return v; if (v?.type==="Buffer") return Buffer.from(v.data); throw new Error("bytea"); }
function decrypt(blob, key) { const d = createDecipheriv("aes-256-gcm", key, blob.subarray(1, 13)); d.setAuthTag(blob.subarray(13, 29)); return JSON.parse(Buffer.concat([d.update(blob.subarray(29)), d.final()]).toString("utf8")); }
const key = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");

const normLI = (u) => !u ? null : String(u).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/$/, "").trim() || null;

function indexCsv(path) {
  const parsed = Papa.parse(readFileSync(path, "utf8"), { header: true, skipEmptyLines: true });
  const byZId = new Map();
  for (const r of parsed.data) {
    if (r.external_id) byZId.set(String(r.external_id).trim(), r);
  }
  return byZId;
}

const csv005 = indexCsv(CSV_INVOICE);  // invoice
const csv006 = indexCsv(CSV_ASSET);    // asset

console.log(`Source CSVs indexed:`);
console.log(`  005 invoice: ${csv005.size} ZoomInfo IDs`);
console.log(`  006 asset:   ${csv006.size} ZoomInfo IDs\n`);

const { data: leads } = await svc.from("leads")
  .select("id, icp_profile_id, encrypted_payload")
  .eq("company_bio_id", PATHWAY_BIO_ID)
  .in("icp_profile_id", [NEW_ASSET_ICP, NEW_INVOICE_ICP]);

const counts = {
  Asset:   { matchedAssetCsv: 0, matchedInvoiceCsv: 0, productTag: 0, importSeqTag: 0, total: 0 },
  Invoice: { matchedAssetCsv: 0, matchedInvoiceCsv: 0, productTag: 0, importSeqTag: 0, total: 0 },
};
const verticalSamples = { Asset: new Map(), Invoice: new Map() };
const mismatches = [];

for (const l of leads ?? []) {
  let p;
  try { p = decrypt(byteaFromSupabase(l.encrypted_payload), key); } catch { continue; }
  const bucket = l.icp_profile_id === NEW_ASSET_ICP ? "Asset" : "Invoice";
  counts[bucket].total++;

  // (1) The product tag we stamped at import time
  if (p.enrichment?.product === bucket) counts[bucket].productTag++;
  // (2) The import_seq prefix we stamped at import time
  if (typeof p.enrichment?.import_seq === "string" && p.enrichment.import_seq.startsWith(`unified-${bucket}-`)) counts[bucket].importSeqTag++;

  // (3) Match the lead's persisted fields against the CSV row for the SAME
  //     ZoomInfo ID — does the row we imported come from 005 or 006?
  const zid = String(p.enrichment?.["ZoomInfo ID"] ?? "").trim();
  const rowFrom005 = zid ? csv005.get(zid) : null;
  const rowFrom006 = zid ? csv006.get(zid) : null;
  // Most identifying field: co_vertical. 005 says "Invoice Finance — …",
  // 006 says "Asset Finance — …". The enrichment.vertical we persisted
  // should equal whichever CSV row we picked.
  const v = p.enrichment?.vertical ?? null;
  if (v) {
    const c = verticalSamples[bucket].get(v) ?? 0;
    verticalSamples[bucket].set(v, c + 1);
  }
  if (rowFrom005 && (rowFrom005.co_vertical === v || rowFrom005.vertical === v)) counts[bucket].matchedInvoiceCsv++;
  if (rowFrom006 && (rowFrom006.co_vertical === v || rowFrom006.vertical === v)) counts[bucket].matchedAssetCsv++;

  if (bucket === "Asset" && rowFrom006 && rowFrom005 && (rowFrom005.co_vertical === v || rowFrom005.vertical === v) && (rowFrom006.co_vertical !== v && rowFrom006.vertical !== v)) {
    mismatches.push({ id: l.id, msg: "Asset lead's vertical matches 005 row, not 006" });
  }
}

for (const bucket of ["Asset", "Invoice"]) {
  const c = counts[bucket];
  console.log(`${bucket} ICP (${c.total} leads):`);
  console.log(`  enrichment.product === "${bucket}"        : ${c.productTag}/${c.total}`);
  console.log(`  enrichment.import_seq starts "unified-${bucket}-" : ${c.importSeqTag}/${c.total}`);
  console.log(`  vertical matches 006 (asset CSV) row     : ${c.matchedAssetCsv}/${c.total}`);
  console.log(`  vertical matches 005 (invoice CSV) row   : ${c.matchedInvoiceCsv}/${c.total}`);
  console.log(`  Top verticals stamped on this bucket:`);
  const sorted = [...verticalSamples[bucket].entries()].sort((a,b) => b[1] - a[1]).slice(0,5);
  for (const [v, n] of sorted) console.log(`    · ${v.padEnd(60)} ×${n}`);
  console.log();
}

console.log(`${mismatches.length === 0 ? "✓ No Asset lead's payload matched 005 better than 006 (and vice versa)." : `✘ ${mismatches.length} mismatches:`}`);
for (const m of mismatches.slice(0, 5)) console.log(`  ${m.id} · ${m.msg}`);
