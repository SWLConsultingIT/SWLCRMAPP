// Gruppo Everest demo — add a THIRD PV plant opportunity: Berti Legnami S.r.l.
// (Pravisdomini, PN). Same shape as the two existing CACER plants:
//   • plant lead under the "Industrial Energy — Italian Manufacturing SMEs (CACER)"
//     ICP, source=client (encrypted), with enrichment.plant_intel + rooftop
//     intelligence + rooftop_lat/lng + a nearby_companies[] array (drives the
//     cross-sell "nearby energy consumers" button + /nearby page).
//   • a dedicated "Nearby Energy Consumers — Pravisdomini (Berti Legnami)" ICP
//     with the 5 C&I targets from the opportunity sheet as separate lead rows.
//
// Berti is an EXISTING PV plant (199.88 kW, live since 2011) on a legacy IV Conto
// Energia feed-in tariff (€0.306/kWh) — so has_solar_panels="yes" and the play is
// asset-optimisation + a ~28.8 kWp roof expansion, not a greenfield install.
//
// Only the RELEVANT, defensible figures from the sheet are loaded — the flagged
// inconsistent numbers (800 kWp system, €336k GSE) are intentionally left out.
//
// Usage: node scripts/add-everest-berti-lead.mjs        (idempotent by import_seq)

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
const KEY = Buffer.from(env.LEADS_ENCRYPTION_KEY, "base64");
if (KEY.length !== 32) { console.error("LEADS_ENCRYPTION_KEY must be 32 bytes"); process.exit(1); }

const BIO = "4ab610c8-e852-4b37-97d7-c41ba19b0d0e";
const PLANT_ICP = "da1b0fc7-ad76-40e2-9646-348cd7f82d28"; // Industrial Energy — Italian Manufacturing SMEs (CACER)

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
function encToBytea(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  return "\\x" + Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ct]).toString("hex");
}
async function insertLead(row, extraOps = {}) {
  const { operational, encrypted } = splitForEncryption(row);
  const { error } = await svc.from("leads").insert({
    ...operational, ...extraOps,
    company_bio_id: BIO,
    source: "client",
    encrypted_payload: encToBytea(encrypted),
    encryption_version: 1,
    sync_status: "pending",
  });
  if (error) throw new Error(error.message);
}
// Idempotency: skip a lead whose encrypted payload carries this import_seq.
async function seqExists(seq) {
  const { data } = await svc.from("leads").select("id, encrypted_payload").eq("company_bio_id", BIO);
  const { createDecipheriv } = await import("node:crypto");
  const dec = b => { const d = createDecipheriv("aes-256-gcm", KEY, b.subarray(1,13)); d.setAuthTag(b.subarray(13,29)); return JSON.parse(Buffer.concat([d.update(b.subarray(29)), d.final()]).toString()); };
  for (const l of data || []) {
    if (!l.encrypted_payload) continue;
    try { const p = dec(Buffer.from(String(l.encrypted_payload).slice(2), "hex")); if (p?.enrichment?.import_seq === seq) return true; } catch {}
  }
  return false;
}

// ── Berti Legnami plant intelligence (from the Pilot-1 opportunity sheet) ──
const GEO = { lat: 45.7947888, lng: 12.676428 };

const NEARBY = [
  { name: "Marchetti Mobili",                     industry: "Furniture Manufacturing", address: "Via Faè 7, 33076 Pravisdomini (PN)",                 phone: "0434 644672", web: "http://marchettimobili.com/",         distance_km: 1.0, mwh: 175,
    first: "Andrea",  last: "Marchetti", title: "Operations Manager" },
  { name: "Xivet LED Technology — Gielle Plast S.r.l.", industry: "Plastics / General Contractor", address: "Via Frattina 68, 33076 Pravisdomini (PN)", phone: "0434 644800", web: "https://xivet.tech/",                distance_km: 1.9, mwh: 110,
    first: "Giovanni", last: "Bortolin", title: "Plant Manager" },
  { name: "Termoidraulica di Schileo Leandro",    industry: "Plumbing & HVAC",         address: "Via A. Pacinotti 40, 30020 Pramaggiore — Blessaglia (VE)", phone: "0421 799961", web: "http://termoidraulicaschileo.com/", distance_km: 4.0, mwh: 50,
    first: "Leandro", last: "Schileo",   title: "Owner" },
  { name: "Ever S.r.l.",                          industry: "Industrial",              address: "Via A. Pacinotti 37, 30020 Pramaggiore (VE)",       phone: "0421 200455", web: "https://ever.it/",                  distance_km: 4.4, mwh: 175,
    first: "Nicholas", last: "Trevisan",  title: "Energy Manager", email: "nicholas.trevisan@ever.it" },
  { name: "Hotel Al Barco",                       industry: "Hospitality",             address: "Via Morer delle Anime 4, 30029 San Stino — Corbolone (VE)", phone: "0421 461827", web: "http://hotelalbarco.it/",          distance_km: 5.6, mwh: 175,
    first: "Silvia",  last: "Marson",    title: "General Manager" },
];

const plantIntel = {
  incentive_holder: "Berti Legnami S.r.l.",
  beneficiary: "Berti Legnami S.r.l.",
  building_owner: "Berti Legnami (family group)",
  installation_owner: "Berti Legnami (family group)",
  ownership_note: "Beneficiary (Berti Legnami S.r.l.) and installation owner (Berti Legnami S.p.A.) are the same family group in two legal forms — no third-party landlord or split ownership. A single, aligned decision-maker and a clean engagement path: the party receiving the incentive also controls the asset.",
  province: "Pordenone (PN)",
  city: "Pravisdomini",
  installation_type: "Rooftop",
  installed_power_kw: 199.88,
  segment: "100–500 kW",
  incentive_granted: "Aug 2011",
  incentive_valid_until: "Aug 2031",
  // Conto Energia specifics (rendered by the extended Plant Intelligence panel)
  conto_energia_scheme: "IV Conto Energia (D.M. 5 maggio 2011)",
  feed_in_tariff_eur_kwh: 0.306,
  convenzione: "F02I227446207",
  atto_concessione: "629560",
  // Site & roof
  roof_area_m2: 273,
  roof_available_m2: 273,
  expansion_potential_kwp: 28.8,
  geo_lat: GEO.lat,
  geo_lng: GEO.lng,
};

const plantEnrichment = {
  source: "manual-demo",
  imported_at: new Date().toISOString(),
  icp: "Industrial Energy — Italian Manufacturing SMEs (CACER)",
  import_seq: "berti-plant",
  segment: "Plant Owner",
  rooftop_photo_url: "/everest-rooftops/berti-pravisdomini.png",
  has_solar_panels: "yes",
  rooftop_area_m2: 273,
  proposed_system_kwp: 28.8,          // roof-expansion potential (validated scope)
  estimated_savings_pct_year1: null,  // sheet gives €/yr, not a %; omit rather than invent
  co2_offset_tons_year: 14.5,
  payback_months: 44,
  cer_eligible: true,
  transizione_5_0_eligible: true,
  ai_outreach_angle:
    "Berti Legnami runs a 199.88 kW rooftop PV plant on IV Conto Energia at €0.306/kWh — a legacy tariff far above today's market — with ~5.1 years (until Aug 2031) of guaranteed incentive still to run. Ownership is consolidated within the Berti family group, so there's a single, clean decision-maker. Play: protect and optimise the incentivised asset, add a ~28.8 kWp roof expansion under Scambio sul Posto, then replicate energy services across a dense C&I cluster (~685 MWh/yr combined) within 6 km.",
  rooftop_lat: GEO.lat,
  rooftop_lng: GEO.lng,
  cacer_potenza_kw: 199.88,           // drives the /nearby page header number
  cacer_comune: "PRAVISDOMINI",
  cacer_provincia: "PORDENONE",
  nearby_companies: NEARBY.map(n => ({ name: n.name, address: n.address, phone: n.phone, web: n.web, distance_km: n.distance_km })),
  plant_intel: plantIntel,
};
// Drop null enrichment keys so they don't render as empty stats.
for (const k of Object.keys(plantEnrichment)) if (plantEnrichment[k] === null) delete plantEnrichment[k];

async function main() {
  // 1) plant lead
  if (await seqExists("berti-plant")) {
    console.log("• Berti plant lead already exists — skipping");
  } else {
    await insertLead({
      icp_profile_id: PLANT_ICP,
      status: "new",
      allow_linkedin: true, allow_email: true, allow_call: true,
      source_tool: "manual-demo", source_universe: "client",
      lead_score: 0,
      primary_first_name: "Luciano",
      primary_last_name: "Berti",
      primary_title_role: "Legal Representative",
      primary_seniority: "owner",
      primary_work_email: "amministrazione@bertilegnami.it",
      primary_phone: "+39 0434 644811",
      company_name: "Berti Legnami S.r.l.",
      company_website: "https://www.bertilegnami.it",
      company_industry: "Wood / Sawmill & Timber",
      company_city: "Pravisdomini",
      company_state: "Pordenone",
      company_country: "Italy",
      company_address_1: "Via Postumia 13, 33076 Pravisdomini (PN), Italy",
      enrichment: plantEnrichment,
    });
    console.log("✓ Berti Legnami plant lead created (ICP: CACER plants)");
  }

  // 2) nearby ICP
  const NEARBY_ICP_NAME = "Nearby Energy Consumers — Pravisdomini (Berti Legnami)";
  let nearbyIcpId;
  const { data: existIcp } = await svc.from("icp_profiles").select("id").eq("company_bio_id", BIO).eq("profile_name", NEARBY_ICP_NAME);
  if (existIcp && existIcp.length) {
    nearbyIcpId = existIcp[0].id;
    console.log("• Nearby ICP already exists — reusing", nearbyIcpId);
  } else {
    const { data, error } = await svc.from("icp_profiles").insert({
      company_bio_id: BIO,
      profile_name: NEARBY_ICP_NAME,
      target_industries: ["Manufacturing", "Furniture", "Plastics", "Industrial", "Hospitality", "HVAC & Installations"],
      target_roles: ["Owner", "Plant Manager", "Operations Manager", "Energy Manager", "Facilities Manager", "General Manager"],
      company_size: "10-150",
      geography: ["Italy — Friuli-Venezia Giulia (Pravisdomini, PN)", "Italy — Veneto (Pramaggiore, San Stino di Livenza, VE)"],
      pain_points: "High, sustained C&I electricity load (combined ~685 MWh/yr across the cluster) with exposure to grid price volatility and no on-site generation. Sitting within 6 km of an incentivised PV plant, these businesses can join a local energy community (CER) and buy surplus renewable power without funding their own generation.",
      solutions_offered: "CER membership / private supply agreement anchored on the Berti Legnami rooftop plant — cheaper, grid-independent renewable energy, cost stability and green credentials, with a single Everest contact handling the setup.",
      notes: "Cross-sell pool for the Berti Legnami (Pravisdomini) plant. Sourced from the Pilot-1 opportunity sheet's nearby C&I targets. Imported 2026-07-06.",
      status: "approved",
      execution_status: "completed",
    }).select("id").single();
    if (error || !data) { console.error("Nearby ICP insert failed:", error?.message); process.exit(1); }
    nearbyIcpId = data.id;
    console.log("✓ Nearby ICP created", nearbyIcpId);
  }

  // 3) nearby lead rows
  let n = 0;
  for (let i = 0; i < NEARBY.length; i++) {
    const c = NEARBY[i];
    const seq = `berti-nearby-${i + 1}`;
    if (await seqExists(seq)) { console.log("  • nearby exists:", c.name); continue; }
    await insertLead({
      icp_profile_id: nearbyIcpId,
      status: "new",
      allow_linkedin: true, allow_email: true, allow_call: true,
      source_tool: "manual-demo", source_universe: "client",
      lead_score: Math.round(55 + c.mwh / 10),
      primary_first_name: c.first,
      primary_last_name: c.last,
      primary_title_role: c.title,
      primary_seniority: c.title === "Owner" ? "owner" : "manager",
      primary_work_email: c.email ?? null,
      primary_phone: c.phone,
      company_name: c.name,
      company_website: c.web,
      company_industry: c.industry,
      company_country: "Italy",
      company_address_1: c.address,
      enrichment: {
        industry: c.industry,
        distance_to_plant_km: c.distance_km,
        estimated_demand_mwh_year: c.mwh,
        address: c.address,
        import_seq: seq,
      },
    });
    console.log("  ✓ nearby lead:", c.name);
    n++;
  }

  console.log(`\nDone. plant + ${n} new nearby leads (ICP ${nearbyIcpId}).`);
}
main().catch(e => { console.error("✘", e.message); process.exit(1); });
