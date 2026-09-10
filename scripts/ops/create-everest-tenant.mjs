// One-shot: create the "Gruppo Everest" tenant and grant owner memberships to
// juan@, luciano@, and sales@swlconsulting.com so the tenant appears in their
// TenantSwitcher dropdowns.
//
// Usage: node scripts/create-everest-tenant.mjs
//
// Reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY.
// Idempotent: reuses bio + memberships if they already exist.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

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
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const OWNER_EMAILS = [
  "juan@swlconsulting.com",
  "luciano@swlconsulting.com",
  "sales@swlconsulting.com",
];
const COMPANY_NAME = "Gruppo Everest";

const bioPayload = {
  company_name: COMPANY_NAME,
  tagline: "Facciamo impianti — Italian engineering for solar, electrical & mechanical systems",
  industry: "Renewable Energy / Industrial Systems Integration",
  description:
    "Gruppo Everest is a federation of premium Italian engineering companies specialized in " +
    "the design, installation and management of photovoltaic, electrical and mechanical systems. " +
    "With 140+ years of combined experience, 200+ qualified professionals and 7,000+ completed " +
    "installations across Italy, the group serves industrial, agricultural, commercial and " +
    "civil clients with turnkey energy and building-systems projects.",
  value_proposition:
    "End-to-end ownership of every project — from feasibility study and permitting to installation, " +
    "monitoring and storage. One technical counterpart, a full multi-disciplinary team, and " +
    "operational field experience that reduces risk and accelerates ROI for industrial energy investments.",
  main_services: [
    "Photovoltaic systems (design, permitting, installation, monitoring, storage)",
    "Electrical installations (MT/BT switchboards, structured cabling, building automation)",
    "Mechanical systems (HVAC, hydronic, geothermal, fire suppression)",
    "Energy efficiency audits & retrofit projects",
    "O&M for industrial photovoltaic plants",
  ],
  differentiators:
    "Group of independent specialist companies under one umbrella — clients get a single technical " +
    "counterpart but access the full bench of 200+ engineers and installers. 7,000+ delivered " +
    "installations, multi-regional footprint, and the financial stability of an aggregated group.",
  target_market:
    "Industrial facilities (food production, manufacturing, logistics), agricultural operations " +
    "with available rooftop or land, large commercial real-estate owners, and professional energy " +
    "investors / utilities across Italy — especially Veneto, Lombardy, Emilia-Romagna and Piedmont. " +
    "Decision makers: Plant Managers, Operations Directors, Procurement / Supply Chain Directors, " +
    "CFOs and Owners of medium / large industrial sites.",
  location: "Italy (multi-regional, HQ in Northern Italy)",
  website: "https://gruppoeverest.com/",
  linkedin_url: null,
  instagram_url: null,
  twitter_url: null,
  facebook_url: null,
  youtube_url: null,
  tiktok_url: null,
  tone_of_voice: "professional",
  tone_by_channel: { default: "professional", linkedin: null, email: null, call: null },
  languages: ["Italian", "English"],
  certifications: [],
  key_clients: [],
  case_studies: [],
  resources: [],
  encryption_mode: "standard",
  is_demo: false,
};

async function findUserIdByEmail(email) {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find(u => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (users.length < perPage) return null;
    page += 1;
    if (page > 50) return null;
  }
}

async function main() {
  console.log(`→ Resolving user_ids for ${OWNER_EMAILS.length} owners ...`);
  const userIds = [];
  for (const email of OWNER_EMAILS) {
    const id = await findUserIdByEmail(email);
    if (!id) {
      console.error(`✘ User ${email} not found in auth.users — create the auth user first.`);
      process.exit(1);
    }
    console.log(`  ${email} → ${id}`);
    userIds.push({ email, id });
  }

  console.log(`→ Checking if "${COMPANY_NAME}" bio already exists ...`);
  const { data: existing, error: existErr } = await svc
    .from("company_bios")
    .select("id, company_name, archived_at")
    .eq("company_name", COMPANY_NAME)
    .is("archived_at", null);
  if (existErr) throw new Error(`select existing failed: ${existErr.message}`);

  let bioId;
  if (existing && existing.length > 0) {
    bioId = existing[0].id;
    console.log(`  Reusing existing bio id = ${bioId}`);
  } else {
    console.log(`→ Inserting new company_bios row ...`);
    const { data: bio, error: bioErr } = await svc
      .from("company_bios")
      .insert(bioPayload)
      .select("id, company_name")
      .single();
    if (bioErr || !bio) throw new Error(`insert bio failed: ${bioErr?.message}`);
    bioId = bio.id;
    console.log(`  Created bio id = ${bioId}`);
  }

  console.log(`→ Upserting user_company_memberships (owner) for all 3 users ...`);
  for (const { email, id } of userIds) {
    const { error: memErr } = await svc
      .from("user_company_memberships")
      .upsert(
        { user_id: id, company_bio_id: bioId, tier: "owner" },
        { onConflict: "user_id,company_bio_id" }
      );
    if (memErr) throw new Error(`upsert membership for ${email} failed: ${memErr.message}`);
    console.log(`  ${email} → membership OK (tier=owner)`);
  }

  console.log(`\n✓ Done. Gruppo Everest tenant ready.`);
  console.log(`  company_bio_id = ${bioId}`);
  console.log(`  Owners: ${OWNER_EMAILS.join(", ")}`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
