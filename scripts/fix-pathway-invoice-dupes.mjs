// Fix-up: the previous import deduped within each CSV but not across them,
// so the 150 Invoice leads ended up being the same people already inserted
// under the Asset ICP. This script:
//   1. Deletes every lead currently under the new Invoice unified ICP.
//   2. Rebuilds the dedupe set: existing Pathway leads + the new Asset leads
//      we are KEEPING (so Invoice can't pick anyone Asset already has).
//   3. Re-picks 150 Invoice candidates from the Invoice CSV that don't
//      intersect either set.
//   4. Encrypts + inserts them under the same Invoice ICP id as before.
//
// Idempotent-ish: re-running deletes the current Invoice ICP rows again and
// re-picks 150 fresh.

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
const env = Object.fromEntries(envText.split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PATHWAY_BIO_ID    = "10969697-f900-47f5-ba64-2287fa72b44d";
const NEW_ASSET_ICP     = "c99841b8-5413-414e-a2b0-f89da2f37e68";
const NEW_INVOICE_ICP   = "85cf66f2-fac6-49e3-8508-ad2d094abeab";
const ICP_INVOICE_NAME  = "Invoice Finance — Unified (UK SME · Director / Owner)";
const TARGET = 150;
const BATCH_SIZE = 50;

const CSV_INVOICE = join(REPO, "sheet", "Pathway", "asset e invoice", "005-invoice-001-PACF.xlsx - ZoomInfo Leads Enriched.csv");

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
  if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  throw new Error("Unsupported bytea shape");
}
function splitForEncryption(row) {
  const operational = {}, encrypted = {};
  for (const [k, v] of Object.entries(row)) {
    if (ENCRYPTED_LEAD_COLUMNS.has(k)) {
      if (v !== undefined && v !== null && v !== "") encrypted[k] = v;
    } else operational[k] = v;
  }
  return { operational, encrypted };
}
const normalizeLI = (u) => !u ? null : String(u).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/$/, "").trim() || null;
const normalizeEmail = (e) => !e ? null : String(e).trim().toLowerCase() || null;
function clip(s, max = 1200) { if (s == null) return null; const str = String(s); return str.length > max ? str.slice(0, max) + "…" : str; }

function buildEnrichment(row, product, idx, icpName) {
  const out = {
    source: "zoominfo",
    imported_at: new Date().toISOString(),
    icp: icpName,
    import_seq: `unified-${product}-${idx}`,
    product,
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
  for (const [k, v] of Object.entries(row)) {
    if ((k.startsWith("rfa_") || k.startsWith("ch_")) && v !== null && v !== undefined && v !== "") out[k] = clip(v, 800);
  }
  for (const [k, v] of Object.entries(out)) if (v === null || v === undefined || v === "") delete out[k];
  return out;
}

function rowToLead(row, product, idx, icpId, icpName) {
  const li = (row.linkedin_url || "").trim();
  const cleanCountry = (row.country || "").trim().replace(/\s*\(EU\)\s*$/, "") || null;
  return {
    company_bio_id: PATHWAY_BIO_ID,
    icp_profile_id: icpId,
    status: "new",
    allow_linkedin: !!li,
    allow_email: !!row.email,
    source_tool: "zoominfo",
    source_universe: "client",
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

async function main() {
  const tenantKey = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");

  // 1) Delete every lead currently under the new Invoice unified ICP.
  console.log(`→ Deleting current Invoice ICP leads ...`);
  const { data: toDelete } = await svc.from("leads").select("id").eq("company_bio_id", PATHWAY_BIO_ID).eq("icp_profile_id", NEW_INVOICE_ICP);
  const ids = (toDelete ?? []).map(r => r.id);
  console.log(`  ${ids.length} rows to delete`);
  if (ids.length) {
    // Wipe child references first so the lead delete doesn't fail on FKs.
    await svc.from("campaign_messages").delete().in("lead_id", ids);
    await svc.from("lead_replies").delete().in("lead_id", ids);
    await svc.from("campaigns").delete().in("lead_id", ids);
    const { error: delErr } = await svc.from("leads").delete().in("id", ids);
    if (delErr) { console.error(`delete failed: ${delErr.message}`); process.exit(1); }
    console.log(`  ✓ deleted`);
  }

  // 2) Rebuild dedupe set: existing Pathway leads (including the NEW Asset
  //    ones we are keeping), all decrypted, indexed by LinkedIn URL + email.
  console.log(`→ Building dedupe set from all remaining Pathway leads ...`);
  const { data: remaining } = await svc.from("leads")
    .select("id, source, encrypted_payload, primary_work_email, primary_linkedin_url, icp_profile_id")
    .eq("company_bio_id", PATHWAY_BIO_ID);
  const existingLI = new Set();
  const existingEmail = new Set();
  for (const l of remaining ?? []) {
    let li = l.primary_linkedin_url || null;
    let em = l.primary_work_email || null;
    if (l.source === "client" && l.encrypted_payload) {
      try {
        const d = decryptPayload(byteaFromSupabase(l.encrypted_payload), tenantKey);
        li = li || d.primary_linkedin_url || null;
        em = em || d.primary_work_email || null;
      } catch { /* skip */ }
    }
    const nLi = normalizeLI(li); if (nLi) existingLI.add(nLi);
    const nEm = normalizeEmail(em); if (nEm) existingEmail.add(nEm);
  }
  const assetCount = (remaining ?? []).filter(l => l.icp_profile_id === NEW_ASSET_ICP).length;
  console.log(`  ${remaining.length} leads (${assetCount} new Asset) → ${existingLI.size} LI + ${existingEmail.size} emails`);

  // 3) Parse Invoice CSV + pick 150 that aren't in either set.
  console.log(`→ Parsing Invoice CSV ...`);
  const csvText = readFileSync(CSV_INVOICE, "utf8");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  console.log(`  ${parsed.data.length} rows`);

  const sorted = [...parsed.data].sort((a, b) => {
    const hotA = (a.ICP || "").toUpperCase() === "HOT" ? 0 : 1;
    const hotB = (b.ICP || "").toUpperCase() === "HOT" ? 0 : 1;
    if (hotA !== hotB) return hotA - hotB;
    const liA = a.linkedin_url ? 0 : 1;
    const liB = b.linkedin_url ? 0 : 1;
    return liA - liB;
  });

  const selected = [];
  const seen = new Set();
  for (const r of sorted) {
    if (selected.length >= TARGET) break;
    const fname = (r.first_name || "").trim();
    const lname = (r.last_name || "").trim();
    if (!fname && !lname) continue;
    const li = normalizeLI(r.linkedin_url);
    const em = normalizeEmail(r.email);
    if (li && existingLI.has(li)) continue;
    if (em && existingEmail.has(em)) continue;
    const key = li || em || `${fname}|${lname}|${(r.company_number || r.company || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(r);
  }
  console.log(`  Picked ${selected.length} Invoice candidates`);
  if (selected.length < TARGET) {
    console.warn(`  ⚠ Wanted ${TARGET} but only ${selected.length} qualify after dedupe. Inserting what we got.`);
  }

  // 4) Encrypt + insert.
  console.log(`→ Encrypting + inserting in batches of ${BATCH_SIZE} ...`);
  const leadRows = selected.map((r, i) => rowToLead(r, "Invoice", i, NEW_INVOICE_ICP, ICP_INVOICE_NAME));
  let inserted = 0;
  for (let i = 0; i < leadRows.length; i += BATCH_SIZE) {
    const slice = leadRows.slice(i, i + BATCH_SIZE);
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
    console.log(`  ${inserted}/${leadRows.length}`);
  }
  console.log(`\n✓ Done. Inserted ${inserted} fresh Invoice leads (no overlap with Asset).`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
