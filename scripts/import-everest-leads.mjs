// One-shot: create the "Industrial Energy — Italian Food Manufacturing" ICP for
// Gruppo Everest and import 15 Apollo-sourced food-production leads with rooftop
// intelligence enrichment (photo + has_solar_panels flag + sizing estimates).
//
// Usage: node scripts/import-everest-leads.mjs
//
// Inputs:
//   - business-context/everest/leads-source.csv   (semicolon-separated)
//   - .env.local → NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, LEADS_ENCRYPTION_KEY
//
// Idempotency:
//   - Reuses ICP if it already exists for this tenant.
//   - Per-lead dedupe by (first+last+domain) within this run.
//   - Does NOT dedupe against pre-existing leads — run once.

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
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!LEADS_KEY_B64) { console.error("Missing LEADS_ENCRYPTION_KEY"); process.exit(1); }

// Gruppo Everest tenant (resolved from company_bios.company_name="Gruppo Everest")
// We resolve at runtime instead of hardcoding so the script remains portable.
const TENANT_NAME = "Gruppo Everest";
const CSV_PATH = join(REPO, "business-context", "everest", "leads-source.csv");
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

function dedupeKey(r) {
  const f = (r.primary_first_name || "").toLowerCase().trim();
  const l = (r.primary_last_name || "").toLowerCase().trim();
  const c = (r.company_website || r.company_name || "").toLowerCase().trim();
  return `${f}|${l}|${c}`;
}

// Rooftop-size + consumption estimates scale loosely with company headcount.
// These are FAKE demo numbers — they look believable but are not real audits.
function rooftopEstimate(employees, hasSolar) {
  const emp = Math.max(20, employees || 80);
  const areaM2 = Math.round(emp * 22 + 600);
  const annualKwh = Math.round(emp * 18_000 + 250_000);
  const billEurYear = Math.round(annualKwh * 0.21);
  const proposedKwp = Math.round(emp * 2.5 + 80);
  const savingsPctYear1 = hasSolar ? 8 : 32;
  const co2OffsetTonsYear = Math.round(proposedKwp * 0.45);
  const paybackMonths = hasSolar ? null : Math.round(60 + (employees > 200 ? -6 : 0));
  return { areaM2, annualKwh, billEurYear, proposedKwp, savingsPctYear1, co2OffsetTonsYear, paybackMonths };
}

function aiAngle(firstName, company, hasSolar, estimate) {
  if (hasSolar) {
    return `${company} already has a partial rooftop array — likely a 2018-2020 install nearing the 20% efficiency-drop window. ` +
      `Angle: storage upgrade + revamping for an extra ~${estimate.savingsPctYear1}% savings, plus PPAs to monetize the empty back-section of the roof.`;
  }
  return `${company}'s ${estimate.areaM2.toLocaleString()} m² rooftop is currently bare. With Italy's CER credits and Transizione 5.0 tax bonus, ` +
    `a ${estimate.proposedKwp} kWp install pays back in ~${estimate.paybackMonths} months and cuts ~€${Math.round(estimate.billEurYear * 0.32).toLocaleString()}/yr off the energy bill.`;
}

async function main() {
  const tenantKey = Buffer.from(LEADS_KEY_B64, "base64");
  if (tenantKey.length !== 32) { console.error(`LEADS_ENCRYPTION_KEY must be 32 bytes (got ${tenantKey.length})`); process.exit(1); }

  // 1) Resolve tenant
  console.log(`→ Resolving tenant "${TENANT_NAME}" ...`);
  const { data: bio, error: bioErr } = await svc
    .from("company_bios")
    .select("id, encryption_mode")
    .eq("company_name", TENANT_NAME)
    .is("archived_at", null)
    .single();
  if (bioErr || !bio) { console.error(`Bio not found: ${bioErr?.message}`); process.exit(1); }
  const TENANT_BIO_ID = bio.id;
  console.log(`  bio_id = ${TENANT_BIO_ID}`);
  if (bio.encryption_mode !== "standard") {
    console.log(`  encryption_mode=${bio.encryption_mode ?? "NULL"} → setting to 'standard'`);
    const { error } = await svc.from("company_bios").update({ encryption_mode: "standard" }).eq("id", TENANT_BIO_ID);
    if (error) { console.error(`Update failed: ${error.message}`); process.exit(1); }
  }

  // 2) Create/reuse ICP
  const ICP_NAME = "Industrial Energy — Italian Food Manufacturing";
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
        "Food Production",
        "Food & Beverages",
        "Dairy & Cold Chain",
        "Bakery & Confectionery",
        "Meat & Cured Goods",
      ],
      target_roles: [
        "Plant Manager",
        "Production Manager",
        "Operations Manager",
        "Supply Chain Manager",
        "Procurement Director",
        "Maintenance Manager",
        "Facility Manager",
        "Project Manager — Industrial",
        "CFO",
        "Owner / Direttore Generale",
      ],
      company_size: "40-500",
      geography: [
        "Italy — Veneto (Padua, Verona, Vicenza, Treviso, Conegliano)",
        "Italy — Lombardy (Milan, Brescia, Sondrio, Desenzano del Garda, Cesano Maderno)",
        "Italy — Emilia-Romagna",
        "Italy — Piedmont",
      ],
      pain_points:
        "Rising industrial electricity costs (Italy ~€0.21/kWh in 2026) eat 6–12% of EBITDA on food-production sites. " +
        "Cold-chain, ovens, packaging lines and refrigeration push baseload consumption above 1 GWh/year even at mid-size plants. " +
        "Many facilities have 3,000–10,000 m² of un-utilized industrial rooftop that could host photovoltaic but lack the " +
        "in-house engineering capacity to evaluate, permit, install and operate it. Some already have a partial 2018–2020 " +
        "array that is approaching the typical 20% efficiency drop and needs storage retrofit + repowering.",
      solutions_offered:
        "Turnkey rooftop photovoltaic for Italian food-production plants: feasibility study → CER (energy-community) and " +
        "Transizione 5.0 incentive analysis → permitting → installation → monitoring → O&M. Energy-storage retrofit and " +
        "repowering for existing 2018–2020 arrays. Single-counterpart engagement with Gruppo Everest's federation of " +
        "specialist installers — clients keep one technical contact and access 200+ engineers and 7,000+ installation references.",
      notes:
        "Apollo filters: Italy · industries=food production OR food & beverages · employee count 40–500 · " +
        "seniority Manager/Director/C-Suite · roles around plant ops, maintenance, supply chain, procurement, project management. " +
        "Enrichment we add per lead: rooftop photo, has_solar_panels flag, estimated rooftop area (m²), annual electricity " +
        "consumption estimate, proposed kWp, payback months, CO₂ offset and an AI-generated outreach angle. " +
        "Lead list imported 2026-05-26.",
      status: "approved",
      execution_status: "completed",
    };
    const { data, error } = await svc.from("icp_profiles").insert(icpRow).select("id").single();
    if (error || !data) { console.error(`ICP insert failed: ${error?.message}`); process.exit(1); }
    icpId = data.id;
    console.log(`  Created ICP id=${icpId}`);
  }

  // 3) Read + parse CSV (semicolon-separated)
  console.log(`→ Reading CSV ${CSV_PATH} ...`);
  const csvText = readFileSync(CSV_PATH, "utf8");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, delimiter: ";" });
  if (parsed.errors && parsed.errors.length > 0) {
    console.warn(`  Parse warnings: ${parsed.errors.length}`);
    for (const e of parsed.errors.slice(0, 3)) console.warn(`    ${e.type}: ${e.message} (row ${e.row})`);
  }
  console.log(`  Parsed ${parsed.data.length} rows`);

  // 4) Map CSV rows → lead objects, alternating rooftop assignment
  const seen = new Set();
  const leadRows = [];
  let skipped = 0;
  let idx = 0;
  for (const row of parsed.data) {
    const first = (row.first_name || "").trim();
    const last = (row.last_name || "").trim();
    const linkedin = (row.linkedin_url || "").trim();
    if (!first && !last && !linkedin) { skipped++; continue; }

    const company = (row.organization_name || "").trim();
    const website = (row.organization_website_url || "").trim();
    const title = (row.title || "").trim();
    const industry = (row.industry || "").trim();
    const seniority = (row.seniority || "").trim();
    const employees = parseInt(row.estimated_num_employees || "0", 10) || null;
    const workEmail = (row.email || "").trim();
    const photoUrl = (row.photo_url || "").trim();
    const city = (row.city || "").trim();
    const state = (row.state || "").trim();
    const country = (row.country || "").trim();

    // Alternate: index 0,2,4,… → has solar (8 leads). 1,3,5,… → no solar (7 leads).
    const hasSolar = idx % 2 === 0;
    const estimate = rooftopEstimate(employees, hasSolar);

    const enrichment = {
      source: "apollo",
      imported_at: new Date().toISOString(),
      icp: ICP_NAME,
      // Stable ordinal so downstream scripts (e.g. create-everest-fake-campaigns.mjs)
      // can match this lead back to its CSV row regardless of created_at collisions
      // within the same INSERT batch.
      import_seq: idx,
      // Rooftop intelligence — used by PersonalizedInfoPanel
      rooftop_photo_url: hasSolar ? "/everest-rooftops/with-solar.png" : "/everest-rooftops/no-solar.png",
      has_solar_panels: hasSolar ? "yes" : "no",
      rooftop_area_m2: estimate.areaM2,
      annual_electricity_kwh: estimate.annualKwh,
      estimated_bill_eur_year: estimate.billEurYear,
      proposed_system_kwp: estimate.proposedKwp,
      estimated_savings_pct_year1: estimate.savingsPctYear1,
      co2_offset_tons_year: estimate.co2OffsetTonsYear,
      payback_months: estimate.paybackMonths,
      // Incentives flags relevant to Italy 2026
      cer_eligible: true,
      transizione_5_0_eligible: !hasSolar,
      // AI angle for the seller
      ai_outreach_angle: aiAngle(first, company, hasSolar, estimate),
    };

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
      primary_linkedin_url: linkedin || null,
      primary_work_email: workEmail || null,
      primary_photo_url: photoUrl || null,
      primary_seniority: seniority || null,
      company_name: company || null,
      company_website: website || null,
      company_city: city || null,
      company_state: state || null,
      company_country: country || null,
      company_industry: industry || null,
      employees: employees ? String(employees) : null,
      enrichment,
    };

    const key = dedupeKey(lead);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    leadRows.push(lead);
    idx++;
  }
  const withSolar = leadRows.filter(l => l.enrichment.has_solar_panels === "yes").length;
  const noSolar = leadRows.length - withSolar;
  console.log(`  Mapped ${leadRows.length} unique leads (skipped ${skipped})`);
  console.log(`  Rooftop split: ${withSolar} with solar / ${noSolar} without`);

  // 5) Encrypt + insert in batches
  console.log(`→ Encrypting + inserting in batches of ${BATCH_SIZE} ...`);
  let inserted = 0;
  for (let i = 0; i < leadRows.length; i += BATCH_SIZE) {
    const slice = leadRows.slice(i, i + BATCH_SIZE);
    const insertBatch = slice.map(lead => {
      const { operational, encrypted } = splitLeadForEncryption(lead);
      const { ciphertext, version } = encryptPayload(encrypted, tenantKey);
      // supabase-js stringifies Buffer as {"type":"Buffer","data":[…]}. Force
      // the bytea wire format so Postgres lands it as raw bytes.
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
  console.log(`  Tenant bio_id    = ${TENANT_BIO_ID}`);
  console.log(`  ICP id           = ${icpId}`);
  console.log(`  Leads inserted   = ${inserted}`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
