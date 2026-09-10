// One-shot: create 2 new "unified" ICPs for Pathway (Asset Finance + Invoice
// Finance) and import 150 leads into each from the ZoomInfo enrichment CSVs.
//
// Usage: node scripts/import-pathway-asset-invoice.mjs
//
// Sources:
//   - sheet/Pathway/asset e invoice/005-invoice-001-PACF.xlsx - ZoomInfo Leads Enriched.csv
//   - sheet/Pathway/asset e invoice/006-asset-001-PACF.xlsx - ZoomInfo Leads Enriched.csv
//
// Dedupe:
//   - Pulls every existing Pathway lead, decrypts encrypted_payload, builds a
//     Set of normalized LinkedIn URLs (preferred) + work-email fallback.
//   - Rows in the CSV that match any existing identifier are skipped.
//   - Within a single CSV, dedupes by LinkedIn URL too.
//
// Selection:
//   - HOT leads first (CSV column "ICP" === "HOT"), then everything else, up
//     to 150 per finance product. We prefer rows with a LinkedIn URL since
//     downstream campaigns need it.
//
// Idempotency:
//   - Reuses existing ICPs of the new names if already there.
//   - DOES NOT dedupe against the leads it just inserted in this run. Run
//     once. If it errors mid-way, the cleanup is per-bio + per-import_seq tag.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const REPO = dirname(dirname(ROOT));

const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
const LEADS_KEY_B64 = env.LEADS_ENCRYPTION_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!LEADS_KEY_B64) { console.error("Missing LEADS_ENCRYPTION_KEY"); process.exit(1); }

const PATHWAY_BIO_ID = "10969697-f900-47f5-ba64-2287fa72b44d";
const TARGET_PER_PRODUCT = 150;
const BATCH_SIZE = 50;

const CSV_INVOICE = join(REPO, "sheet", "Pathway", "asset e invoice", "005-invoice-001-PACF.xlsx - ZoomInfo Leads Enriched.csv");
const CSV_ASSET   = join(REPO, "sheet", "Pathway", "asset e invoice", "006-asset-001-PACF.xlsx - ZoomInfo Leads Enriched.csv");

const ICP_ASSET_NAME   = "Asset Finance — Unified (UK SME · Director / Owner)";
const ICP_INVOICE_NAME = "Invoice Finance — Unified (UK SME · Director / Owner)";

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Mirrors lib/leads-crypto.ts ENCRYPTED_LEAD_COLUMNS
const ENCRYPTED_LEAD_COLUMNS = new Set([
  "primary_first_name", "primary_last_name", "primary_personal_email", "primary_work_email",
  "primary_phone", "primary_secondary_phone", "primary_linkedin_url", "primary_instagram",
  "primary_facebook", "primary_photo_url", "primary_headline", "primary_title_role",
  "primary_career", "primary_seniority", "primary_email_status", "whatsapp_number", "telegram",
  "linkedin_internal_id", "linkedin_assigned_account",
  "company_name", "company_website", "company_address_1", "company_address_2", "company_cp",
  "company_city", "company_state", "company_country", "company_phone", "company_email",
  "company_linkedin", "company_instagram", "company_google_mybusiness",
  "twitter_url", "facebook_url",
  "company_industry", "company_sub_industry", "keywords", "employees", "annual_revenue",
  "organization_tagline", "organization_description", "organization_short_desc",
  "organization_seo_desc", "organization_logo_url", "organization_technologies",
  "similar_organization", "google_reviews_rating", "company_posts_content", "industry_trends",
  "company_linkedin_post", "company_blog", "instagram_last_posts", "twitter_last_posts",
  "company_mission", "recent_website_news", "website_summary", "recent_linkedin_post",
  "recent_ig_post", "seller_notes", "opportunity_notes", "ai_summary", "enrichment",
  "ai_loss_analysis",
]);

// ── Crypto helpers ─────────────────────────────────────────────────────────
const VERSION = 1, IV_LEN = 12, TAG_LEN = 16, HEADER_LEN = 1 + IV_LEN + TAG_LEN;

function decryptPayload(blob, key) {
  if (blob[0] !== VERSION) throw new Error(`Unsupported version ${blob[0]}`);
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, HEADER_LEN);
  const ct = blob.subarray(HEADER_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
}

function encryptPayload(payload, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]), version: VERSION };
}

function byteaFromSupabase(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "base64");
  }
  if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  throw new Error("Unsupported bytea shape");
}

function splitForEncryption(row) {
  const operational = {}, encrypted = {};
  for (const [k, v] of Object.entries(row)) {
    if (ENCRYPTED_LEAD_COLUMNS.has(k)) {
      if (v !== undefined && v !== null && v !== "") encrypted[k] = v;
    } else {
      operational[k] = v;
    }
  }
  return { operational, encrypted };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalizeLinkedIn(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("?")[0]
    .replace(/\/$/, "")
    .trim() || null;
}

function normalizeEmail(e) {
  if (!e || typeof e !== "string") return null;
  const t = e.trim().toLowerCase();
  return t || null;
}

// Truncate to keep enrichment payload reasonable. Some ZoomInfo fields are
// huge employment-history blobs that we don't display.
function clip(s, max = 1200) {
  if (s == null) return null;
  const str = String(s);
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function buildEnrichment(row, product, idx, icpName) {
  // Pull every column that has a value; rename a few + drop the heaviest.
  const out = {
    source: "zoominfo",
    imported_at: new Date().toISOString(),
    icp: icpName,
    import_seq: `unified-${product}-${idx}`,
    product, // "Asset" | "Invoice"
    icp_status: row.ICP || row.co_ICP || null,
    vertical: row.vertical || row.co_vertical || null,
    company_number: row.company_number || row.co_company_number || null,
    Reason: row.Reason || null,
    priority: row.priority || null,
    deal_size: row.deal_size || null,
    revenue_icp: row.revenue_icp || null,
    next_step: row.next_step || null,
    company_size: row.company_size || null,
    date_of_creation: row.date_of_creation || null,
    sic_codes: row.sic_codes || null,
    ai_enrichment: clip(row.ai_enrichment, 1800),
    headline: clip(row.headline, 400),
    bio: clip(row.bio, 600),
    "Employment History (summary)": clip(row.employment_history, 800),
    "Position Start": row.in_role_since || null,
    "Last Updated": row.last_updated || null,
    "Valid Date": row.valid_date || null,
    "Management Level": row.seniority_level || null,
    "Department / Function": row.department || null,
    "Direct Phone": row.direct_phone || null,
    "Mobile Phone": row.mobile_phone || null,
    Score: row.seniority_score || null,
    "ZoomInfo ID": row.external_id || null,
    EU: row.country === "United Kingdom (EU)" || row.country === "United Kingdom" ? "Yes" : null,
  };
  // Copy every rfa_* and ch_* column that has a value
  for (const [k, v] of Object.entries(row)) {
    if ((k.startsWith("rfa_") || k.startsWith("ch_")) && v !== null && v !== undefined && v !== "") {
      out[k] = clip(v, 800);
    }
  }
  // Strip nulls so the payload stays compact
  for (const [k, v] of Object.entries(out)) {
    if (v === null || v === undefined || v === "") delete out[k];
  }
  return out;
}

function rowToLead(row, product, idx, icpId, icpName) {
  const li = (row.linkedin_url || "").trim();
  const fullCountry = (row.country || "").trim();
  // ZoomInfo's "United Kingdom (EU)" → "United Kingdom" so the UI maps clean.
  const cleanCountry = fullCountry.replace(/\s*\(EU\)\s*$/, "") || null;

  return {
    // operational
    company_bio_id: PATHWAY_BIO_ID,
    icp_profile_id: icpId,
    status: "new",
    allow_linkedin: !!li,
    allow_email: !!row.email,
    source_tool: "zoominfo",
    source_universe: "client",
    // encrypted
    primary_first_name: row.first_name || null,
    primary_last_name: row.last_name || null,
    primary_title_role: row.job_title || null,
    primary_seniority: row.seniority_level || null,
    primary_headline: clip(row.headline, 300),
    primary_work_email: row.email || null,
    primary_personal_email: row.personal_email || null,
    primary_linkedin_url: li || null,
    primary_phone: row.direct_phone || row.mobile_phone || null,
    primary_secondary_phone: row.direct_phone && row.mobile_phone ? row.mobile_phone : null,
    primary_email_status: row.email_status || null,
    twitter_url: row.twitter_url || null,
    facebook_url: row.facebook_url || null,
    company_name: row.company_name || row.company || null,
    company_website: row.company_website
      ? (row.company_website.startsWith("http") ? row.company_website : `https://${row.company_website}`)
      : (row.company_domain ? `https://${row.company_domain}` : null),
    company_address_1: row.address_line_1 || null,
    company_cp: row.postcode || null,
    company_city: row.locality || row.city || null,
    company_state: row.region || row.state || null,
    company_country: cleanCountry,
    company_industry: row.co_vertical || row.vertical || null,
    employees: row.rfa_employees ? String(row.rfa_employees) : (row.company_size || null),
    annual_revenue: row.rfa_turnover_est ? String(row.rfa_turnover_est) : null,
    enrichment: buildEnrichment(row, product, idx, icpName),
  };
}

async function ensureIcp(bioId, name, payload) {
  const { data: existing } = await svc.from("icp_profiles")
    .select("id, profile_name")
    .eq("company_bio_id", bioId)
    .eq("profile_name", name)
    .maybeSingle();
  if (existing) {
    console.log(`  Reusing ICP "${name}" id=${existing.id}`);
    return existing.id;
  }
  const { data, error } = await svc.from("icp_profiles").insert({ company_bio_id: bioId, profile_name: name, ...payload }).select("id").single();
  if (error || !data) { console.error(`ICP insert failed: ${error?.message}`); process.exit(1); }
  console.log(`  Created ICP "${name}" id=${data.id}`);
  return data.id;
}

async function main() {
  const tenantKey = Buffer.from(LEADS_KEY_B64, "base64");
  if (tenantKey.length !== 32) { console.error("LEADS_ENCRYPTION_KEY must be 32 bytes"); process.exit(1); }

  // 1. Sanity check the tenant
  console.log(`→ Loading tenant ${PATHWAY_BIO_ID} ...`);
  const { data: bio } = await svc.from("company_bios").select("id, company_name, encryption_mode").eq("id", PATHWAY_BIO_ID).single();
  if (!bio) { console.error("Pathway bio not found"); process.exit(1); }
  console.log(`  ${bio.company_name} (encryption=${bio.encryption_mode})`);

  // 2. Create / reuse the 2 unified ICPs
  console.log(`→ Ensuring unified ICPs exist ...`);
  const assetIcpId = await ensureIcp(PATHWAY_BIO_ID, ICP_ASSET_NAME, {
    target_industries: [
      "Manufacturing", "Construction", "Civil Engineering", "Logistics & Transport",
      "Specialist Plant", "Food Production", "Wholesale & Distribution",
      "Print & Packaging", "Healthcare Equipment", "Renewable Energy Infrastructure",
    ],
    target_roles: [
      "Owner", "Managing Director", "CEO", "Founder",
      "Finance Director", "CFO", "Operations Director",
      "Company Director", "Director", "Partner",
    ],
    company_size: "10-250",
    geography: ["United Kingdom (England · Scotland · Wales · NI)"],
    pain_points:
      "UK SME owner-operators looking to fund hard assets (vehicles, plant, machinery, equipment) without " +
      "draining working capital. Bank facilities are slow, manufacturer finance is restrictive. Many sites " +
      "already carry existing HP/lease arrangements approaching maturity — refinance + top-up is a common " +
      "trigger event.",
    solutions_offered:
      "Asset Finance via Pathway Commercial Finance — hire purchase, lease, refinance and refinance-with-top-up " +
      "across our panel of 50+ asset finance lenders. Speed (decisions in days, drawdown in 1-2 weeks), flexible " +
      "covenants, vendor-neutral so the client picks the kit, not the lender's catalogue.",
    notes:
      "ZoomInfo + RFA + Companies House enriched feed. Unified ICP — supersedes the 5 prior product-specific Asset " +
      "ICPs. Lead universe filtered by UK incorporation, 10-250 emp, RFA rating GOLD/SILVER/BRONZE preferred, " +
      "with ICP=HOT prioritized first.",
    status: "approved",
    execution_status: "completed",
  });
  const invoiceIcpId = await ensureIcp(PATHWAY_BIO_ID, ICP_INVOICE_NAME, {
    target_industries: [
      "Wholesale & Distribution", "Manufacturing", "Recruitment & Staffing",
      "Logistics & Transport", "Print & Packaging", "Engineering Services",
      "Construction (sub-contracting)", "Food Wholesale", "Import / Export",
    ],
    target_roles: [
      "Owner", "Managing Director", "CEO", "Founder",
      "Finance Director", "CFO", "Financial Controller",
      "Company Director", "Director", "Partner",
    ],
    company_size: "10-250",
    geography: ["United Kingdom (England · Scotland · Wales · NI)"],
    pain_points:
      "UK SMEs with B2B sales ledgers carrying 30-90 day debtor days, working capital trapped in invoices. " +
      "Common triggers: existing IF facility expiring, growth outpacing cash, lender concentration limits, " +
      "or a debenture about to crystallize. Many have a charge registered with a non-IF lender (e.g. bank " +
      "overdraft) that we can refinance into a cleaner IF facility.",
    solutions_offered:
      "Invoice Finance via Pathway Commercial Finance — confidential invoice discounting, factoring, selective " +
      "invoice finance, and refinance of existing IF facilities. Panel of 30+ IF lenders. Greenfield + refinance, " +
      "with structured advances 80-90% LTV and same-week onboarding.",
    notes:
      "ZoomInfo + RFA + Companies House enriched feed. Unified ICP — supersedes the 6 prior product-specific " +
      "Invoice ICPs. Lead universe filtered by UK incorporation, 10-250 emp, B2B verticals, with ICP=HOT " +
      "prioritized first. Existing-charge signal (ch_if_signal) used to identify refinance candidates.",
    status: "approved",
    execution_status: "completed",
  });

  // 3. Build the dedupe set from existing Pathway leads
  console.log(`→ Fetching existing Pathway leads for dedupe ...`);
  const { data: existingLeads, error: existErr } = await svc.from("leads")
    .select("id, source, encrypted_payload, primary_work_email, primary_linkedin_url")
    .eq("company_bio_id", PATHWAY_BIO_ID);
  if (existErr) { console.error(`fetch existing failed: ${existErr.message}`); process.exit(1); }
  console.log(`  ${existingLeads?.length ?? 0} existing leads`);

  const existingLI = new Set();
  const existingEmail = new Set();
  let decryptFails = 0;
  for (const l of existingLeads ?? []) {
    let li = l.primary_linkedin_url || null;
    let em = l.primary_work_email || null;
    if (l.source === "client" && l.encrypted_payload) {
      try {
        const blob = byteaFromSupabase(l.encrypted_payload);
        const d = decryptPayload(blob, tenantKey);
        li = li || d.primary_linkedin_url || null;
        em = em || d.primary_work_email || null;
      } catch (e) {
        decryptFails++;
      }
    }
    const nLi = normalizeLinkedIn(li);
    if (nLi) existingLI.add(nLi);
    const nEm = normalizeEmail(em);
    if (nEm) existingEmail.add(nEm);
  }
  console.log(`  Dedupe set built: ${existingLI.size} LinkedIn URLs · ${existingEmail.size} emails · decrypt fails=${decryptFails}`);

  // 4. Parse + select rows
  function parseCsv(path) {
    const text = readFileSync(path, "utf8");
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors?.length) console.warn(`  ${path} parse warnings: ${parsed.errors.length}`);
    return parsed.data;
  }

  function pickRows(rows, product) {
    const seenInBatch = new Set();
    const selected = [];
    // Sort: HOT first, then everything else; within each tier prefer rows
    // with a linkedin_url (downstream channels need it).
    const sorted = [...rows].sort((a, b) => {
      const hotA = (a.ICP || "").toUpperCase() === "HOT" ? 0 : 1;
      const hotB = (b.ICP || "").toUpperCase() === "HOT" ? 0 : 1;
      if (hotA !== hotB) return hotA - hotB;
      const liA = a.linkedin_url ? 0 : 1;
      const liB = b.linkedin_url ? 0 : 1;
      return liA - liB;
    });
    for (const r of sorted) {
      if (selected.length >= TARGET_PER_PRODUCT) break;
      const fname = (r.first_name || "").trim();
      const lname = (r.last_name || "").trim();
      const li = normalizeLinkedIn(r.linkedin_url);
      const em = normalizeEmail(r.email);
      if (!fname && !lname) continue;
      // Dedupe: against existing tenant leads
      if (li && existingLI.has(li)) continue;
      if (em && existingEmail.has(em)) continue;
      // Dedupe: within this batch
      const key = li || em || `${fname}|${lname}|${(r.company_number || r.company || "").toLowerCase()}`;
      if (seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      selected.push(r);
    }
    return selected;
  }

  console.log(`→ Parsing CSVs ...`);
  const invoiceRows = parseCsv(CSV_INVOICE);
  const assetRows   = parseCsv(CSV_ASSET);
  console.log(`  Invoice CSV: ${invoiceRows.length} rows · Asset CSV: ${assetRows.length} rows`);

  const invoiceSelected = pickRows(invoiceRows, "Invoice");
  const assetSelected   = pickRows(assetRows,   "Asset");
  console.log(`  Selected: ${invoiceSelected.length} invoice · ${assetSelected.length} asset`);

  // 5. Build lead rows
  const leadRowsAll = [];
  invoiceSelected.forEach((r, i) => leadRowsAll.push(rowToLead(r, "Invoice", i, invoiceIcpId, ICP_INVOICE_NAME)));
  assetSelected.forEach((r, i) => leadRowsAll.push(rowToLead(r, "Asset", i, assetIcpId, ICP_ASSET_NAME)));
  console.log(`  Total lead rows to insert: ${leadRowsAll.length}`);

  // 6. Encrypt + insert in batches
  console.log(`→ Encrypting + inserting in batches of ${BATCH_SIZE} ...`);
  let inserted = 0;
  for (let i = 0; i < leadRowsAll.length; i += BATCH_SIZE) {
    const slice = leadRowsAll.slice(i, i + BATCH_SIZE);
    const insertBatch = slice.map(lead => {
      const { operational, encrypted } = splitForEncryption(lead);
      const { ciphertext, version } = encryptPayload(encrypted, tenantKey);
      const bytea = "\\x" + ciphertext.toString("hex");
      return {
        ...operational,
        source: "client",
        encrypted_payload: bytea,
        encryption_version: version,
        sync_status: "pending",
      };
    });
    const { error } = await svc.from("leads").insert(insertBatch);
    if (error) { console.error(`insert failed at batch ${Math.floor(i/BATCH_SIZE)}: ${error.message}`); process.exit(1); }
    inserted += insertBatch.length;
    console.log(`  ${inserted}/${leadRowsAll.length}`);
  }

  console.log(`\n✓ Done.`);
  console.log(`  Asset ICP id    = ${assetIcpId}`);
  console.log(`  Invoice ICP id  = ${invoiceIcpId}`);
  console.log(`  Leads inserted  = ${inserted} (${assetSelected.length} asset + ${invoiceSelected.length} invoice)`);
  console.log(`\nAdd these 2 ICP ids to sheet/Pathway/appscript_sync_all.gs in ICP_TO_PRODUCT:`);
  console.log(`  '${assetIcpId}': 'Asset',`);
  console.log(`  '${invoiceIcpId}': 'Invoice',`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
