// One-shot: create the "Viandas" ICP for the De Vera Grill tenant and import
// the Apollo-sourced lead list into it. Mirrors the encryption pipeline used by
// /api/leads/import/commit so the leads behave like real client uploads
// (encrypted_payload at rest, operational columns in plain).
//
// Usage: node scripts/import-devera-viandas-leads.mjs
//
// Inputs:
//   - business-context/devera-grill/leads-viandas-source.csv
//   - .env.local → NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, LEADS_ENCRYPTION_KEY
//
// Idempotency:
//   - If "Viandas" ICP already exists for this bio, reuses it.
//   - Per-lead dedupe by (lower(first+last+company_domain)) within this CSV.
//   - DOES NOT dedupe against pre-existing leads in the table; re-running will
//     duplicate. Run once.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const REPO = dirname(dirname(ROOT));

const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
const LEADS_KEY_B64 = env.LEADS_ENCRYPTION_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY"); process.exit(1);
}
if (!LEADS_KEY_B64) {
  console.error("Missing LEADS_ENCRYPTION_KEY"); process.exit(1);
}

const TENANT_BIO_ID = "aef0e3b3-0754-4227-8718-8063f4c13771"; // De Vera Grill (created earlier)
const CSV_PATH = join(REPO, "business-context", "devera-grill", "leads-viandas-source.csv");
const BATCH_SIZE = 50;

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Mirrors lib/leads-crypto.ts ENCRYPTED_LEAD_COLUMNS — keep in sync.
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

function splitLeadForEncryption(row) {
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

function encryptPayload(payload, key) {
  const VERSION = 1, IV_LEN = 12;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphered = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphered]), version: VERSION };
}

// Parses "City, Province, Country" — Apollo's typical Location format.
function parseLocation(loc) {
  if (!loc) return { city: null, state: null, country: null };
  const parts = loc.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, state: null, country: null };
  const country = parts[parts.length - 1] || null;
  const state = parts.length >= 2 ? parts[parts.length - 2] : null;
  const city = parts.length >= 3 ? parts.slice(0, parts.length - 2).join(", ") : (parts.length === 2 ? parts[0] : null);
  return { city, state, country };
}

function dedupeKey(r) {
  const f = (r.primary_first_name || "").toLowerCase().trim();
  const l = (r.primary_last_name || "").toLowerCase().trim();
  const c = (r.company_website || r.company_name || "").toLowerCase().trim();
  return `${f}|${l}|${c}`;
}

async function main() {
  const tenantKey = Buffer.from(LEADS_KEY_B64, "base64");
  if (tenantKey.length !== 32) { console.error(`LEADS_ENCRYPTION_KEY must be 32 bytes (got ${tenantKey.length})`); process.exit(1); }

  // 1) Ensure bio has encryption_mode='standard' (column may be NULL on freshly-created tenants).
  console.log(`→ Verifying encryption_mode for tenant ${TENANT_BIO_ID} ...`);
  const { data: bio, error: bioErr } = await svc
    .from("company_bios")
    .select("id, encryption_mode")
    .eq("id", TENANT_BIO_ID)
    .single();
  if (bioErr || !bio) { console.error(`Bio not found: ${bioErr?.message}`); process.exit(1); }
  if (bio.encryption_mode !== "standard") {
    console.log(`  encryption_mode=${bio.encryption_mode ?? "NULL"} → setting to 'standard'`);
    const { error } = await svc.from("company_bios").update({ encryption_mode: "standard" }).eq("id", TENANT_BIO_ID);
    if (error) { console.error(`Update failed: ${error.message}`); process.exit(1); }
  } else {
    console.log(`  encryption_mode=standard ✓`);
  }

  // 2) Create/reuse "Viandas" ICP.
  const ICP_NAME = "Viandas — Admin & RRHH (Zona Norte AR)";
  console.log(`→ Checking ICP "${ICP_NAME}" ...`);
  const { data: existingIcps, error: icpErr } = await svc
    .from("icp_profiles")
    .select("id, profile_name")
    .eq("company_bio_id", TENANT_BIO_ID)
    .eq("profile_name", ICP_NAME);
  if (icpErr) { console.error(`ICP select failed: ${icpErr.message}`); process.exit(1); }

  let icpId;
  if (existingIcps && existingIcps.length > 0) {
    icpId = existingIcps[0].id;
    console.log(`  Reusing ICP id=${icpId}`);
  } else {
    const icpRow = {
      company_bio_id: TENANT_BIO_ID,
      profile_name: ICP_NAME,
      target_industries: [
        "Industrial / Manufacturing", "Logistics & Distribution", "Transport",
        "Pharma / Biotech", "Hospitality", "Education", "Professional Services",
      ],
      target_roles: [
        "HR Manager", "People & Culture", "Office Manager",
        "Administration Manager", "Facility Manager", "Operations Manager",
        "Plant Manager", "Gerente Administrativo", "Responsable RRHH",
        "Director", "Owner",
      ],
      company_size: "11-300",
      geography: [
        "Argentina — Zona Norte (Tigre, Escobar, Garín, Ingeniero Maschwitz, Matheu, Benavidez, Pilar, Campana, Pacheco)",
      ],
      pain_points: "Catering corporativo poco confiable, viandas tibias/desabridas, demoras de entrega, falta de variedad en planta o oficina. Personal en parques industriales sin opciones de comida cercanas.",
      solutions_offered: "Servicio de viandas y catering corporativo recurrente para empresas en zona norte: industrias, oficinas, depósitos, parques logísticos. Menúes variados, entrega puntual, especialidad parrilla. Capacidad para eventos corporativos en planta y off-site.",
      notes: "Apollo filters: Argentina · Buenos Aires · zona norte (Garin/Escobar/Maschwitz/Matheu/Benavidez/Ruta 9). Headcount 11-300. Keywords: parque industrial, logística, depósito, distribución, planta, fábrica. Seniority Admin: Manager/Head/Director/Owner. Importado 2026-05-21.",
      status: "approved",
      execution_status: "completed",
    };
    const { data, error } = await svc.from("icp_profiles").insert(icpRow).select("id").single();
    if (error || !data) { console.error(`ICP insert failed: ${error?.message}`); process.exit(1); }
    icpId = data.id;
    console.log(`  Created ICP id=${icpId}`);
  }

  // 3) Read + parse CSV.
  console.log(`→ Reading CSV ${CSV_PATH} ...`);
  const csvText = readFileSync(CSV_PATH, "utf8");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length > 0) {
    console.warn(`  Parse warnings: ${parsed.errors.length}`);
    for (const e of parsed.errors.slice(0, 3)) console.warn(`    ${e.type}: ${e.message} (row ${e.row})`);
  }
  console.log(`  Parsed ${parsed.data.length} rows`);

  // 4) Map CSV rows → lead objects, dedupe.
  const seen = new Set();
  const leadRows = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const first = (row["First Name"] || "").trim();
    const last = (row["Last Name"] || "").trim();
    const linkedin = (row["LinkedIn Profile"] || "").trim();
    const fullName = (row["Full Name"] || "").trim();

    // Skip rows that didn't resolve a LinkedIn profile (Apollo gave "No Profile Found").
    if (fullName.includes("No Profile Found")) { skipped++; continue; }

    if (!first && !last && !linkedin) { skipped++; continue; }

    const company = (row["Company Name"] || "").trim();
    const domain = (row["Company Domain"] || "").trim().toLowerCase();
    const title = (row["Job Title"] || "").trim();
    const headline = (row["Headline"] || "").trim();
    const summary = (row["Summary"] || "").trim();
    const workEmail = (row["Work Email"] || "").trim();
    const connections = parseInt(row["Connections"] || "0", 10) || null;
    const location = parseLocation(row["Location"] || "");

    const enrichment = {
      source: "apollo",
      imported_at: new Date().toISOString(),
      icp: "Viandas — Zona Norte AR",
    };
    if (connections) enrichment.linkedin_connections = connections;
    if (summary) enrichment.linkedin_summary = summary;
    if (row["Summarize LinkedIn profile"]) enrichment.linkedin_unique_aspects = row["Summarize LinkedIn profile"];

    const lead = {
      // operational
      company_bio_id: TENANT_BIO_ID,
      icp_profile_id: icpId,
      status: "new",
      allow_linkedin: true,
      allow_email: true,
      source_tool: "apollo",
      source_universe: "client",
      // encrypted
      primary_first_name: first || null,
      primary_last_name: last || null,
      primary_title_role: title || null,
      primary_headline: headline || null,
      primary_linkedin_url: linkedin || null,
      primary_work_email: workEmail || null,
      company_name: company || null,
      company_website: domain ? `https://${domain}` : null,
      company_city: location.city,
      company_state: location.state,
      company_country: location.country,
      enrichment,
    };

    const key = dedupeKey(lead);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    leadRows.push(lead);
  }
  console.log(`  Mapped ${leadRows.length} unique leads (skipped ${skipped})`);

  // 5) Encrypt + insert in batches.
  console.log(`→ Encrypting + inserting in batches of ${BATCH_SIZE} ...`);
  let inserted = 0;
  for (let i = 0; i < leadRows.length; i += BATCH_SIZE) {
    const slice = leadRows.slice(i, i + BATCH_SIZE);
    const insertBatch = slice.map(lead => {
      const { operational, encrypted } = splitLeadForEncryption(lead);
      const { ciphertext, version } = encryptPayload(encrypted, tenantKey);
      // supabase-js JSON.stringify's Buffer into {"type":"Buffer","data":[...]},
      // which Postgres then stores verbatim — corrupting the bytea. Force the
      // wire format to Postgres's bytea hex literal so it lands as raw bytes.
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
    if (error) { console.error(`Insert failed at batch ${Math.floor(i/BATCH_SIZE)}: ${error.message}`); process.exit(1); }
    inserted += insertBatch.length;
    console.log(`  ${inserted}/${leadRows.length}`);
  }

  console.log(`\n✓ Done.`);
  console.log(`  ICP id           = ${icpId}`);
  console.log(`  Leads inserted   = ${inserted}`);
  console.log(`  Skipped (dupe/empty/no-profile) = ${skipped}`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
