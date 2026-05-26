// One-shot: add a single "fresh" lead to the Gruppo Everest tenant — same
// ICP as the rest, full rooftop enrichment, but status='new' and NO campaign
// or campaign_messages. Used so we can land on the lead detail for a lead
// that has not been contacted yet (different UX from contacted/won/lost).
//
// Usage: node scripts/add-everest-fresh-lead.mjs
//
// Idempotent: if a lead with the same first+last+domain already exists for
// this tenant, exits without inserting a duplicate.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
const LEADS_KEY_B64 = env.LEADS_ENCRYPTION_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !LEADS_KEY_B64) { console.error("Missing env"); process.exit(1); }

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const TENANT_NAME = "Gruppo Everest";
const ICP_NAME = "Industrial Energy — Italian Food Manufacturing";

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

function encryptPayload(payload, key) {
  const VERSION = 1, IV_LEN = 12;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]), version: VERSION };
}

async function main() {
  const key = Buffer.from(LEADS_KEY_B64, "base64");
  if (key.length !== 32) { console.error("LEADS_ENCRYPTION_KEY must be 32 bytes"); process.exit(1); }

  // Resolve tenant + ICP
  const { data: bio } = await svc.from("company_bios").select("id").eq("company_name", TENANT_NAME).is("archived_at", null).single();
  if (!bio) { console.error("Bio not found"); process.exit(1); }
  const BIO = bio.id;
  console.log(`→ Tenant ${BIO}`);

  const { data: icp } = await svc.from("icp_profiles").select("id").eq("company_bio_id", BIO).eq("profile_name", ICP_NAME).single();
  if (!icp) { console.error(`ICP "${ICP_NAME}" not found`); process.exit(1); }
  const ICP = icp.id;
  console.log(`→ ICP ${ICP}`);

  // Fake lead — Pastificio Felicetti, Trentino. Real Italian pasta producer
  // founded 1908 in Predazzo. Premium / organic positioning. Fits the ICP
  // (food production, manager/director seniority, Italy, mid-size).
  // status='new' + no campaign → lands in /leads All Leads as a fresh
  // un-contacted lead.
  const COMPANY = "Pastificio Felicetti S.p.A.";
  const FIRST = "Laura";
  const LAST = "Felicetti";

  // Idempotency: skip if we already inserted this lead (match by tenant +
  // import_seq=15 marker we set below).
  const { data: existing } = await svc.from("leads")
    .select("id")
    .eq("company_bio_id", BIO)
    .eq("enrichment->>import_seq", "fresh-1")
    .maybeSingle();
  if (existing) {
    console.log(`  Lead already exists (id=${existing.id}) — exiting without changes.`);
    process.exit(0);
  }

  // Rooftop enrichment — keep "without solar" since the lead is fresh and the
  // pitch angle is more concrete ("install + Transizione 5.0 credit") than
  // the storage retrofit angle for has_solar=yes.
  const employees = 130;
  const rooftopAreaM2 = Math.round(employees * 22 + 600);
  const annualKwh = Math.round(employees * 18_000 + 250_000);
  const billEurYear = Math.round(annualKwh * 0.21);
  const proposedKwp = Math.round(employees * 2.5 + 80);
  const co2OffsetTonsYear = Math.round(proposedKwp * 0.45);
  const paybackMonths = 58;

  const enrichment = {
    source: "apollo",
    imported_at: new Date().toISOString(),
    icp: ICP_NAME,
    import_seq: "fresh-1",
    rooftop_photo_url: "/everest-rooftops/no-solar.png",
    has_solar_panels: "no",
    rooftop_area_m2: rooftopAreaM2,
    annual_electricity_kwh: annualKwh,
    estimated_bill_eur_year: billEurYear,
    proposed_system_kwp: proposedKwp,
    estimated_savings_pct_year1: 32,
    co2_offset_tons_year: co2OffsetTonsYear,
    payback_months: paybackMonths,
    cer_eligible: true,
    transizione_5_0_eligible: true,
    ai_outreach_angle:
      `Pastificio Felicetti's ${rooftopAreaM2.toLocaleString()} m² industrial rooftop in Predazzo (Trentino) is currently bare. ` +
      `With the Transizione 5.0 tax credit + CER community pooling, a ${proposedKwp} kWp install pays back in ~${paybackMonths} months ` +
      `and offsets ~${Math.round(billEurYear * 0.32).toLocaleString()} EUR/yr — the high-elevation site (~1000m asl) also gives ~12% above-average yield in summer.`,
  };

  const leadRow = {
    // operational
    company_bio_id: BIO,
    icp_profile_id: ICP,
    status: "new",
    allow_linkedin: true,
    allow_email: true,
    source_tool: "apollo",
    source_universe: "client",
    // encrypted — primary person
    primary_first_name: FIRST,
    primary_last_name: LAST,
    primary_title_role: "Operations Director",
    primary_seniority: "director",
    primary_headline: "Operations Director at Pastificio Felicetti — heritage Italian pasta producer in the Dolomites",
    primary_work_email: "laura.felicetti@felicetti.it",
    primary_linkedin_url: "http://www.linkedin.com/in/laura-felicetti-felicetti",
    primary_phone: "+39 0462 501206",
    // encrypted — company-level (matches the enrich-everest-companies.mjs shape)
    company_name: COMPANY,
    company_website: "https://www.felicetti.it",
    company_address_1: "Via Felicetti, 9",
    company_cp: "38037",
    company_city: "Predazzo",
    company_state: "Trentino-Alto Adige",
    company_country: "Italy",
    company_industry: "Food Production",
    company_sub_industry: "Premium / Organic Pasta",
    employees: String(employees),
    annual_revenue: "65000000",
    organization_tagline: "La pasta dei pastai — pasta crafted by pasta makers since 1908",
    organization_description:
      "Pastificio Felicetti is a fourth-generation Italian pasta producer based in Predazzo, in the heart of " +
      "the Dolomites (Trentino-Alto Adige). Founded in 1908, the company specializes in premium and organic " +
      "pasta produced with mountain-spring water and a slow bronze-die extrusion process. Distributes across " +
      "Europe and the US under the Felicetti and Monograno brands.",
    organization_short_desc: "Heritage Italian pasta producer (est. 1908) — Felicetti, Monograno brands. Mountain-spring water, bronze-die extrusion.",
    company_mission: "Make pasta the way it should be made — slowly, with mountain water and the highest-grade durum wheat.",
    keywords: "pasta, organic, monograno, bronze die, durum wheat, trentino, dolomiti, premium, b corp",
    organization_technologies: ["SAP Business One", "Cybertec CyberPlan"],
    similar_organization: "Pastificio Rana, Pastificio De Cecco, Pastificio Garofalo",
    industry_trends:
      "Premium and organic pasta segment growing 9-11% CAGR across DACH and US. Heritage Italian brands command " +
      "30-40% price premium. Energy is the #1 OPEX line on pasta drying tunnels — rooftop PV typically covers " +
      "35-50% of consumption for similar Northern Italian sites.",
    google_reviews_rating: "4.6",
    company_linkedin: "https://www.linkedin.com/company/pastificio-felicetti/",
    enrichment,
  };

  const { operational, encrypted } = splitForEncryption(leadRow);
  const { ciphertext, version } = encryptPayload(encrypted, key);
  const bytea = "\\x" + ciphertext.toString("hex");
  const { error, data } = await svc.from("leads").insert({
    ...operational,
    source: "client",
    encrypted_payload: bytea,
    encryption_version: version,
    sync_status: "pending",
  }).select("id").single();
  if (error) { console.error(`insert failed: ${error.message}`); process.exit(1); }
  console.log(`\n✓ Done. Fresh lead created.`);
  console.log(`  Lead id   = ${data.id}`);
  console.log(`  Name      = ${FIRST} ${LAST}`);
  console.log(`  Company   = ${COMPANY}`);
  console.log(`  Status    = new (no campaign assigned)`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
