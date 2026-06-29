// Add the 8 PNRR/CACER demo leads (real Italian SMEs — hotels, agri, machinery)
// to the Gruppo Everest tenant, same ICP + full rooftop enrichment so the
// lead-detail "Rooftop Intelligence" panel renders with a photo like the
// existing demo leads. status='new', no campaign. Idempotent by import_seq.
//
// Usage: node scripts/import-cacer-everest-leads.mjs

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
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const TENANT_NAME = "Gruppo Everest";
const ICP_NAME = "Industrial Energy — Italian Food Manufacturing";

const ENCRYPTED_LEAD_COLUMNS = new Set([
  "primary_first_name","primary_last_name","primary_personal_email","primary_work_email","primary_phone","primary_secondary_phone","primary_linkedin_url","primary_instagram","primary_facebook","primary_photo_url","primary_headline","primary_title_role","primary_career","primary_seniority","primary_email_status","whatsapp_number","telegram","linkedin_internal_id","linkedin_assigned_account","company_name","company_website","company_address_1","company_address_2","company_cp","company_city","company_state","company_country","company_phone","company_email","company_linkedin","company_instagram","company_google_mybusiness","twitter_url","facebook_url","company_industry","company_sub_industry","keywords","employees","annual_revenue","organization_tagline","organization_description","organization_short_desc","organization_seo_desc","organization_logo_url","organization_technologies","similar_organization","google_reviews_rating","company_posts_content","industry_trends","company_linkedin_post","company_blog","instagram_last_posts","twitter_last_posts","company_mission","recent_website_news","website_summary","recent_linkedin_post","recent_ig_post","seller_notes","opportunity_notes","ai_summary","enrichment","ai_loss_analysis",
]);
function splitForEncryption(row) {
  const operational = {}, encrypted = {};
  for (const [k, v] of Object.entries(row)) {
    if (ENCRYPTED_LEAD_COLUMNS.has(k)) { if (v !== undefined && v !== null && v !== "") encrypted[k] = v; }
    else operational[k] = v;
  }
  return { operational, encrypted };
}
function encryptPayload(payload, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  return { ciphertext: Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ct]), version: 1 };
}

// Cleaned CSV rows (encoding fixed). employees = size estimate to drive plausible solar numbers.
const LEADS = [
  { seq:"cacer-1", first:"Massimo", last:"Viganò", title:"CEO and Executive Managing Director", seniority:"c_level", company:"Officina Meccanica Rivoltana srl", tag:"Plant Owner", email:"massimo@omrcoat.com", phone:"+39 363 879955", coPhone:null, li:"http://www.linkedin.com/in/massimo-vigano-157a1874", web:"https://omrcoating.com", coLi:"http://www.linkedin.com/company/officina-meccanica-rivoltana-srl", industry:"Oil & Energy", city:"Arzago d'Adda", state:"Lombardia", employees:95 },
  { seq:"cacer-2", first:"Marco", last:"Rossi", title:"Owner", seniority:"owner", company:"San Martino", tag:"Business Owner", email:null, phone:"+39 035 1234567", coPhone:"+39 0363 49075", li:null, web:"http://www.sanmartinotreviglio.it", coLi:null, industry:"Hospitality", city:"Treviglio", state:"BG", employees:25 },
  { seq:"cacer-3", first:"Giulia", last:"Ferrari", title:"Owner", seniority:"owner", company:"Park Hotel Cassano", tag:"Business Owner", email:null, phone:"+39 02 9876543", coPhone:"+39 340 1931932", li:null, web:"http://parkhotelcassano.com/", coLi:null, industry:"Hospitality", city:"Cassano d'Adda", state:"MI", employees:45 },
  { seq:"cacer-4", first:"Luca", last:"Bianchi", title:"Owner", seniority:"owner", company:"Azienda Agricola Cascina Bassanella", tag:"Business Owner", email:null, phone:"+39 030 4567890", coPhone:"+39 333 7312713", li:null, web:"http://www.bassanella.it/", coLi:null, industry:"Agriculture", city:"Treviglio", state:"BG", employees:35 },
  { seq:"cacer-5", first:"Marco", last:"Moreschi", title:"Owner", seniority:"owner", company:"Moreschi S.r.l.", tag:"Plant Owner", email:"marco@moreschi.eu", phone:"+39 335 7752952", coPhone:null, li:"http://www.linkedin.com/in/marco-moreschi-6a561a5b", web:"https://moreschi.eu", coLi:"http://www.linkedin.com/company/moreschi-s-r-l-", industry:"Machinery", city:null, state:"Lombardy", employees:110 },
  { seq:"cacer-6", first:"Alessia", last:"Colombo", title:"Owner", seniority:"owner", company:"Hotel Des Alpes", tag:"Business Owner", email:null, phone:"+39 035 2345678", coPhone:"+39 0346 31682", li:null, web:"http://www.hotel-desalpes.it/", coLi:null, industry:"Hospitality", city:"Castione della Presolana", state:"BG", employees:40 },
  { seq:"cacer-7", first:"Matteo", last:"Ricci", title:"Owner", seniority:"owner", company:"Albergo Max Meublè", tag:"Business Owner", email:null, phone:"+39 02 8765432", coPhone:"+39 0346 31698", li:null, web:"http://www.albergomax.com/", coLi:null, industry:"Hospitality", city:"Castione della Presolana", state:"BG", employees:20 },
  { seq:"cacer-8", first:"Francesca", last:"Marino", title:"Owner", seniority:"owner", company:"Residence Cirese", tag:"Business Owner", email:null, phone:"+39 030 3456789", coPhone:"+39 347 8039785", li:null, web:"http://www.cirese.it/", coLi:null, industry:"Hospitality", city:"Borno", state:"BS", employees:30 },
];

function buildEnrichment(L, idx) {
  const area = L.employees * 22 + 600;
  const annualKwh = L.employees * 18000 + 250000;
  const billEur = Math.round(annualKwh * 0.21);
  const kwp = Math.round(L.employees * 2.5 + 80);
  const co2 = Math.round(kwp * 0.45);
  const payback = 52 + (idx % 7); // 52-58
  const savingsPct = 30 + (idx % 5); // 30-34
  const savingsEur = Math.round(billEur * (savingsPct / 100));
  const where = L.city ? `${L.city} (${L.state})` : L.state;
  return {
    source: "manual-demo",
    imported_at: new Date().toISOString(),
    icp: ICP_NAME,
    import_seq: L.seq,
    segment: L.tag,
    rooftop_photo_url: "/everest-rooftops/no-solar.png",
    has_solar_panels: "no",
    rooftop_area_m2: area,
    annual_electricity_kwh: annualKwh,
    estimated_bill_eur_year: billEur,
    proposed_system_kwp: kwp,
    estimated_savings_pct_year1: savingsPct,
    co2_offset_tons_year: co2,
    payback_months: payback,
    cer_eligible: true,
    transizione_5_0_eligible: true,
    ai_outreach_angle:
      `${L.company}'s ~${area.toLocaleString()} m² rooftop in ${where} is currently bare. ` +
      `With Italy's CACER community pooling and the Transizione 5.0 / PNRR tax credits, a ${kwp} kWp install ` +
      `pays back in ~${payback} months and cuts ~€${savingsEur.toLocaleString()}/yr off the energy bill ` +
      `(~${co2} t CO₂ offset/year).`,
  };
}

async function main() {
  const key = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) { console.error("bad key"); process.exit(1); }
  const { data: bio } = await svc.from("company_bios").select("id").eq("company_name", TENANT_NAME).is("archived_at", null).single();
  const { data: icp } = await svc.from("icp_profiles").select("id").eq("company_bio_id", bio.id).eq("profile_name", ICP_NAME).single();
  console.log(`→ tenant ${bio.id}  icp ${icp.id}`);

  // Reset 2026-06-29: demo keeps ONLY the two real plant-owner companies.
  const ONLY = new Set(["cacer-1", "cacer-5"]);
  let inserted = 0, skipped = 0;
  for (let i = 0; i < LEADS.length; i++) {
    const L = LEADS[i];
    if (!ONLY.has(L.seq)) continue;
    const { data: existing } = await svc.from("leads").select("id").eq("company_bio_id", bio.id).eq("enrichment->>import_seq", L.seq).maybeSingle();
    if (existing) { console.log(`  = ${L.first} ${L.last} (${L.company}) already exists`); skipped++; continue; }

    const leadRow = {
      company_bio_id: bio.id, icp_profile_id: icp.id, status: "new",
      allow_linkedin: true, allow_email: true,
      source_tool: "manual-demo", source_universe: "client",
      primary_first_name: L.first, primary_last_name: L.last,
      primary_title_role: L.title, primary_seniority: L.seniority,
      primary_work_email: L.email, primary_phone: L.phone, primary_secondary_phone: L.coPhone,
      primary_linkedin_url: L.li,
      company_name: L.company, company_website: L.web, company_city: L.city,
      company_state: L.state, company_country: "Italy", company_industry: L.industry,
      company_phone: L.coPhone, company_linkedin: L.coLi,
      enrichment: buildEnrichment(L, i),
    };
    const { operational, encrypted } = splitForEncryption(leadRow);
    const { ciphertext, version } = encryptPayload(encrypted, key);
    const { error, data } = await svc.from("leads").insert({
      ...operational, source: "client",
      encrypted_payload: "\\x" + ciphertext.toString("hex"),
      encryption_version: version, sync_status: "pending",
    }).select("id").single();
    if (error) { console.error(`  ✘ ${L.company}: ${error.message}`); continue; }
    console.log(`  ✓ ${L.first} ${L.last} — ${L.company} (id=${data.id})`);
    inserted++;
  }
  console.log(`\nDone. inserted=${inserted} skipped=${skipped}`);
}
main().catch(e => { console.error("✘", e.message); process.exit(1); });
