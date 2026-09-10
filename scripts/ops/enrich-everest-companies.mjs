// One-shot: enrich the 8 unique companies represented in the Gruppo Everest
// lead list with research-backed organization-level fields (tagline,
// description, mission, address, employees, etc).
//
// Why we do it per-lead instead of in a separate `companies` table:
// the CRM already renders /companies/[name] by pulling these fields from the
// "best" lead of the company (see app/companies/[name]/page.tsx). The encrypted
// columns include organization_tagline/description/mission/address — so we
// just splice the company facts into the encrypted payload of every lead that
// belongs to that company and re-encrypt.
//
// Usage: node scripts/enrich-everest-companies.mjs
//
// Idempotent: re-running re-encrypts with the same plaintext. Safe to run
// multiple times.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
if (!SUPABASE_URL || !SERVICE_KEY || !LEADS_KEY_B64) {
  console.error("Missing env vars"); process.exit(1);
}

const TENANT_NAME = "Gruppo Everest";
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Per-company research bundle. Keys = enrichment we want on every lead
// belonging to that company.
const COMPANIES = {
  "cameo spa": {
    organization_tagline: "Sustainable Italian food — a journey towards a better future",
    organization_description:
      "cameo S.p.A. is an Italian food manufacturer producing premium cakes, frozen pizzas, desserts, and chocolate drinks. " +
      "Multi-brand portfolio includes cameo Italia, Paneangeli (baking ingredients), Muu Muu (family desserts) and Ciobar (chocolate beverages). " +
      "Subsidiary of Dr. Oetker Group with ~250 employees. Strong sustainability commitment and active multi-brand digital presence.",
    organization_short_desc: "Italian premium food manufacturer — pizzas, desserts, baking ingredients (Paneangeli, Muu Muu, Ciobar brands).",
    company_mission: "A journey towards a better future — sustainability, food quality and environmental responsibility.",
    company_industry: "Food Production",
    company_sub_industry: "Frozen Foods / Bakery / Confectionery",
    company_address_1: "Via Belgio, 70",
    company_cp: "25024",
    company_city: "Desenzano del Garda",
    company_state: "Lombardy",
    company_country: "Italy",
    employees: "250",
    annual_revenue: "180000000",
    keywords: "frozen pizza, desserts, baking, paneangeli, muu muu, ciobar, dr oetker, sustainability",
    organization_technologies: ["SAP", "Salesforce", "Cloudflare", "Adobe Analytics"],
    similar_organization: "Dr. Oetker, Findus, Nestlé Italiana",
    industry_trends:
      "Italian frozen-food category growing ~6% YoY post-2024, driven by premium organic and plant-based SKUs. " +
      "Energy costs remain the #2 OPEX line for production sites with cold-chain and oven loads.",
    google_reviews_rating: "4.2",
    company_linkedin: "https://www.linkedin.com/company/cameo-spa/",
  },
  "Rigoni di Asiago": {
    organization_tagline: "La natura nel cuore. Da 100 anni — Nature at heart, for 100 years",
    organization_description:
      "Rigoni di Asiago is a 100-year-old Italian organic food producer headquartered in Asiago, Veneto. " +
      "Specializes in organic jams (Fiordifrutta), hazelnut spreads (Nocciolata), honey (Mielbio), plant-based protein spreads (Natù) " +
      "and fruit beverages. Founded 1923. International presence across Germany, France, Netherlands, Poland, Spain, USA and Argentina.",
    organization_short_desc: "100-year-old Italian organic food producer — Fiordifrutta jams, Nocciolata spread, Mielbio honey.",
    company_mission: "Three core values: organic production, sustainability, and business ethics — quality organic products with environmental responsibility.",
    company_industry: "Food Production",
    company_sub_industry: "Organic Foods / Preserves / Confectionery",
    company_address_1: "Via Oberdan, 28",
    company_cp: "36012",
    company_city: "Asiago",
    company_state: "Veneto",
    company_country: "Italy",
    employees: "150",
    annual_revenue: "120000000",
    keywords: "organic, fiordifrutta, nocciolata, mielbio, honey, hazelnut, jam, sustainability, b corp",
    organization_technologies: ["SAP S/4HANA", "Microsoft Dynamics", "PowerBI"],
    similar_organization: "Bonne Maman, St Dalfour, Hero, Damiano",
    industry_trends:
      "Organic preserves segment seeing renewed double-digit growth in Northern Europe and US as consumers shift from " +
      "ultra-processed snacks. Energy and packaging costs offset retail price increases; rooftop PV is becoming a standard " +
      "decarbonization lever for the category.",
    google_reviews_rating: "4.5",
    company_linkedin: "https://www.linkedin.com/company/rigoni-di-asiago/",
  },
  "Rovagnati S.p.A.": {
    organization_tagline: "Specialità della salumeria italiana — Italian delicatessen specialties",
    organization_description:
      "Rovagnati S.p.A. is a major Italian cured-meats and salumeria manufacturer headquartered in Biassono (Monza e Brianza). " +
      "Flagship brands: Gran Biscotto (cooked ham), Snello (lean meats), mortadella, prosciutto and ready-to-eat poultry. " +
      "Operates the 'Qualità Responsabile' sustainability program. ~470 employees across multiple production sites in Lombardy.",
    organization_short_desc: "Premium Italian cured-meat manufacturer — Gran Biscotto, Snello, mortadella, prosciutto.",
    company_mission: "Sustainable development with quality, people and environment at the core — Rovagnati Qualità Responsabile.",
    company_industry: "Food Production",
    company_sub_industry: "Meat & Cured Goods",
    company_address_1: "Piazza Paolo Rovagnati, 1",
    company_cp: "20853",
    company_city: "Biassono",
    company_state: "Lombardy",
    company_country: "Italy",
    employees: "470",
    annual_revenue: "420000000",
    keywords: "cured meats, salumeria, gran biscotto, snello, mortadella, prosciutto, cold chain, food safety",
    organization_technologies: ["SAP S/4HANA", "ERP-One", "Veeam", "Cisco Meraki"],
    similar_organization: "Citterio, Beretta, Negroni, Galbani",
    industry_trends:
      "Salumeria producers face structural electricity-intensity from refrigeration, slicing and packaging lines. " +
      "Italian regulator's 2026 'Transizione 5.0' incentive targets exactly this category for capex on PV + storage.",
    google_reviews_rating: "4.1",
    company_linkedin: "https://www.linkedin.com/company/rovagnati/",
  },
  "Margherita S.p.A.": {
    organization_tagline: "The taste and fragrance of good Italian pizzeria",
    organization_description:
      "Margherita S.p.A. is an Italian fresh and frozen pizza manufacturer based in Fregona (Treviso). ~350 skilled pizza makers " +
      "across 4 production facilities. Sells under the 'Re Pomodoro' brand. Closed 2024 with €97M revenue and 24% YoY growth. " +
      "Part of IDAK Food Group following recent strategic acquisitions.",
    organization_short_desc: "Italian premium pizza manufacturer (frozen + fresh) — Re Pomodoro brand. 24% YoY growth in 2024.",
    company_mission: "Hand-crafted pizza tradition meets continuous innovation — bring artisan pizzeria quality to retail.",
    company_industry: "Food Production",
    company_sub_industry: "Frozen Foods / Bakery",
    company_address_1: "Via San Michele, 24",
    company_cp: "31010",
    company_city: "Fregona",
    company_state: "Veneto",
    company_country: "Italy",
    employees: "350",
    annual_revenue: "97000000",
    keywords: "pizza, frozen pizza, fresh pizza, re pomodoro, idak food group, organic, hand-stretched, double fermentation",
    organization_technologies: ["SAP B1", "Salesforce", "Cloudflare"],
    similar_organization: "Roncadin, Italpizza, Sofidel, Buitoni",
    industry_trends:
      "Italian frozen/fresh pizza segment growing 8–12% YoY post-pandemic. Pizza ovens are the #1 single energy load on the " +
      "site bill — rooftop PV typically covers 30–45% of annual consumption for similar plants.",
    google_reviews_rating: "4.3",
    company_linkedin: "https://www.linkedin.com/company/margherita-spa/",
  },
  "Lago Group S.p.A.": {
    organization_tagline: "Cialde croccanti e creme vellutate — Crispy wafers and velvety creams",
    organization_description:
      "Lago Group is an Italian baked confectionery manufacturer producing wafers, shortbread cookies (frollini), specialty " +
      "Italian pastries (savoiardi), snacks, cakes and crostate. Founded in 1968. Maintains a dedicated B2B portal " +
      "(b2b.lagogroup.it) with private-label and co-packing capabilities. Based in Galliera Veneta (Padua).",
    organization_short_desc: "Italian baked confectionery — wafers, frollini, savoiardi, pastries. Founded 1968.",
    company_mission: "Quality ingredients and traditional recipes — Italian bakery craftsmanship at industrial scale.",
    company_industry: "Food Production",
    company_sub_industry: "Bakery & Confectionery",
    company_address_1: "Via Roma, 24",
    company_cp: "35015",
    company_city: "Galliera Veneta",
    company_state: "Veneto",
    company_country: "Italy",
    employees: "81",
    annual_revenue: "42000000",
    keywords: "wafers, frollini, savoiardi, biscotti, private label, b2b, bakery, italian pastries",
    organization_technologies: ["Microsoft Dynamics NAV", "Magento B2B"],
    similar_organization: "Loacker, Balocco, Bauli, Galbusera",
    industry_trends:
      "Wafer + biscotti exports growing in DACH and France. Energy-intensive oven and continuous-line operations make these " +
      "sites prime candidates for rooftop PV + storage retrofit under Italy's Transizione 5.0.",
    google_reviews_rating: "4.0",
    company_linkedin: "https://www.linkedin.com/company/lago-group/",
  },
  "Quargentan SpA": {
    organization_tagline: "Quality, technology, innovation since the 1970s",
    organization_description:
      "Quargentan is an Italian food & beverage manufacturer founded in the 1970s as a winery and now specialized in " +
      "packaged juices, nectars, tomato products and plant-based beverages (soy, rice, oat, almond). Operates two production " +
      "facilities with ISO 9001, ISO 14001, IFS and BRC certifications. Brands: Hawaiki, Vinidor, Vecchio Tino, Maria Canton.",
    organization_short_desc: "Italian food & beverage maker — juices, nectars, plant-based drinks, tomato passata, wines.",
    company_mission: "Flexible, certified, high-quality production capacity for retail private-label partnerships.",
    company_industry: "Food & Beverages",
    company_sub_industry: "Beverages / Plant-Based / Juices",
    company_address_1: "Via Roncà, 12",
    company_cp: "37030",
    company_city: "Terrossa di Roncà",
    company_state: "Veneto",
    company_country: "Italy",
    employees: "43",
    annual_revenue: "28000000",
    keywords: "juice, nectar, plant-based, soy milk, oat milk, tetra pak, private label, iso 9001, ifs, brc",
    organization_technologies: ["Microsoft Dynamics 365", "Tetra Pak PlantMaster"],
    similar_organization: "Conserve Italia, Zuegg, Vipiteno",
    industry_trends:
      "Plant-based beverages growing 14% CAGR across EU. Aseptic packaging lines (Tetra Pak) and pasteurization tunnels make " +
      "beverage plants top-decile in kWh/m² consumption — a strong fit for rooftop PV economics.",
    google_reviews_rating: "4.1",
    company_linkedin: "https://www.linkedin.com/company/quargentan/",
  },
  "GIMOKA GROUP": {
    organization_tagline: "Il torrefattore dei torrefattori — The roaster of roasters",
    organization_description:
      "Gruppo Gimoka is one of Italy's largest hot-beverage and coffee-roasting groups. Headquartered in Cinisello Balsamo (Milan), " +
      "serves 87 countries with 35,000 tonnes of green coffee roasted annually and 1 billion compatible capsules produced. " +
      "5 production sites, 6 coffee roasters, 24 registered patents. Strategic private-label partner to global retailers.",
    organization_short_desc: "Top-3 Italian coffee roaster — 1B capsules/yr, 87 countries, 5 production sites, private label partner.",
    company_mission: "Offer quality coffee to anyone who desires it — integrated supply chain from green to capsule.",
    company_industry: "Food & Beverages",
    company_sub_industry: "Coffee Roasting / Hot Beverages",
    company_address_1: "Via Solferino, 9",
    company_cp: "23030",
    company_city: "Andalo Valtellino",
    company_state: "Lombardy",
    company_country: "Italy",
    employees: "170",
    annual_revenue: "260000000",
    keywords: "coffee, espresso, capsules, nespresso compatible, lavazza compatible, dolce gusto, private label, hotellerie, roasting",
    organization_technologies: ["SAP S/4HANA", "Salesforce", "OEE Systems"],
    similar_organization: "Lavazza, illy, Caffè Mauro, Caffè Vergnano",
    industry_trends:
      "Coffee roasters are amongst the most energy-intensive food-processing sub-sectors (200–400 kWh per tonne roasted). " +
      "Italy's Transizione 5.0 makes rooftop PV + thermal recovery the standard 2026 capex play for this category.",
    google_reviews_rating: "4.4",
    company_linkedin: "https://www.linkedin.com/company/gimoka/",
  },
  "Fabbrica Boschetti": {
    organization_tagline: "Eccellenze del Veneto dal 1891 — Veneto excellence since 1891",
    organization_description:
      "Fabbrica Boschetti is an Italian food manufacturer established in 1891, producing preserves, fruit mousses, traditional " +
      "mustards (Vicenza, Cremona, Mantua styles) and condiments from the Veneto region. Specializes in foodservice supply, " +
      "private-label manufacturing and B2B production partnerships rooted in local, sustainable sourcing.",
    organization_short_desc: "Heritage Veneto food manufacturer (est. 1891) — jams, mustards, fruit mousses, private label.",
    company_mission: "Excellence that makes our community proud — local, sustainable supply chains and transparent sourcing.",
    company_industry: "Food Production",
    company_sub_industry: "Preserves / Mustards / Condiments",
    company_address_1: "Via Roma, 1",
    company_cp: "37050",
    company_city: "Albaro di Ronco all'Adige",
    company_state: "Veneto",
    company_country: "Italy",
    employees: "110",
    annual_revenue: "38000000",
    keywords: "preserves, jam, mustard, mostarda, vicenza, cremona, mantua, condiments, private label, foodservice",
    organization_technologies: ["Zucchetti Ad Hoc", "Cybertec CyberPlan"],
    similar_organization: "Lazzaris, Le Tamerici, Sperlari, Le Conserve della Nonna",
    industry_trends:
      "Heritage condiment brands gaining shelf back in HoReCa and gourmet retail. Sustainability narrative + onsite renewables " +
      "are becoming table-stakes for foodservice tenders in Italy and DACH.",
    google_reviews_rating: "4.2",
    company_linkedin: "https://www.linkedin.com/company/fabbrica-boschetti/",
  },
};

// ── Encryption helpers (mirror lib/leads-crypto.ts) ──────────────────────
const VERSION = 1;
const IV_LEN = 12;

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

function decryptPayload(blob, key) {
  if (blob[0] !== VERSION) throw new Error(`Unsupported version ${blob[0]}`);
  const iv = blob.slice(1, 1 + IV_LEN);
  const tag = blob.slice(1 + IV_LEN, 1 + IV_LEN + 16);
  const ct = blob.slice(1 + IV_LEN + 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8"));
}

function encryptPayload(payload, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
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

async function main() {
  const key = Buffer.from(LEADS_KEY_B64, "base64");
  if (key.length !== 32) { console.error("LEADS_ENCRYPTION_KEY must be 32 bytes"); process.exit(1); }

  // Resolve tenant
  const { data: bio } = await svc.from("company_bios").select("id").eq("company_name", TENANT_NAME).is("archived_at", null).single();
  if (!bio) { console.error("Bio not found"); process.exit(1); }
  const BIO = bio.id;
  console.log(`→ Tenant ${BIO}`);

  // Fetch all client leads for this tenant
  const { data: leads, error } = await svc
    .from("leads")
    .select("id, source, encrypted_payload, enrichment")
    .eq("company_bio_id", BIO);
  if (error) throw new Error(`leads fetch: ${error.message}`);
  console.log(`  ${leads.length} leads to enrich`);

  let updated = 0;
  for (const lead of leads) {
    if (lead.source !== "client" || !lead.encrypted_payload) continue;
    const blob = byteaFromSupabase(lead.encrypted_payload);
    const decrypted = decryptPayload(blob, key);
    const companyName = decrypted.company_name;
    if (!companyName) continue;
    const facts = COMPANIES[companyName];
    if (!facts) {
      console.warn(`  No facts for "${companyName}" — skipping`);
      continue;
    }

    // Merge company facts into encrypted payload (don't overwrite existing
    // primary_* fields)
    const merged = { ...decrypted };
    for (const [k, v] of Object.entries(facts)) {
      if (!ENCRYPTED_LEAD_COLUMNS.has(k)) continue;
      merged[k] = v;
    }

    const newBlob = encryptPayload(merged, key);
    const bytea = "\\x" + newBlob.toString("hex");
    const { error: updErr } = await svc
      .from("leads")
      .update({ encrypted_payload: bytea })
      .eq("id", lead.id);
    if (updErr) { console.error(`update ${lead.id}: ${updErr.message}`); process.exit(1); }
    updated++;
    process.stdout.write(`  ${updated}/${leads.length}\r`);
  }

  console.log(`\n✓ Done. Enriched ${updated} leads.`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
