// One-shot: create the "De Vera Grill" tenant and grant sales@swlconsulting.com
// an owner membership so it appears in the TenantSwitcher dropdown.
//
// Usage: node scripts/create-devera-tenant.mjs
//
// Reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY.
// Idempotent-ish: if a non-archived bio with the same company_name already
// exists, reuses it instead of inserting a duplicate.

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

const OWNER_EMAIL = "sales@swlconsulting.com";
const COMPANY_NAME = "De Vera Grill";

const bioPayload = {
  company_name: COMPANY_NAME,
  tagline: "We grill, you enjoy",
  industry: "Gastronomy / Restaurant & Catering",
  description:
    "Restaurante y servicio de catering especializado en parrilla y cocina internacional. " +
    "Negocio familiar fundado por tres hermanos descendientes de inmigrantes europeos, " +
    "ubicado en zona norte de Buenos Aires. Atiende familias, grupos y clientes corporativos.",
  value_proposition:
    "First-class hospitality with grill specialty and excellent price-quality ratio — " +
    "the leading dining and catering choice in zona norte.",
  main_services: [
    "Restaurant (grill & international cuisine)",
    "Social event catering",
    "Corporate event catering",
    "Meeting rooms / private events",
  ],
  differentiators:
    "Family-owned with European hospitality heritage; full event-management capability; " +
    "specialized grill menu.",
  target_market:
    "Corporate event planners, HR / office managers, and companies in northern Buenos Aires " +
    "(Tigre / Escobar / Pilar / Nordelta) looking for off-site dining experiences or " +
    "catered events. Also families and social groups for direct restaurant bookings.",
  location: "Benavidez, Tigre, Buenos Aires, Argentina",
  website: "https://www.deveragrill.com/",
  linkedin_url: null,
  instagram_url: "https://instagram.com/deveragrill",
  twitter_url: null,
  facebook_url: "https://facebook.com/deveragrill",
  youtube_url: null,
  tiktok_url: null,
  tone_of_voice: "warm",
  tone_by_channel: { default: "warm", linkedin: null, email: null, call: null },
  languages: ["Spanish", "English"],
  certifications: [],
  key_clients: [],
  case_studies: [],
  resources: [],
  is_demo: false,
};

async function findUserIdByEmail(email) {
  // listUsers() paginates; walk pages until we find the match.
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
    if (page > 50) return null; // safety cap
  }
}

async function main() {
  console.log(`→ Looking up user_id for ${OWNER_EMAIL} ...`);
  const userId = await findUserIdByEmail(OWNER_EMAIL);
  if (!userId) {
    console.error(`✘ User ${OWNER_EMAIL} not found in auth.users`);
    process.exit(1);
  }
  console.log(`  user_id = ${userId}`);

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

  console.log(`→ Upserting user_company_memberships (owner) ...`);
  const { error: memErr } = await svc
    .from("user_company_memberships")
    .upsert(
      { user_id: userId, company_bio_id: bioId, tier: "owner" },
      { onConflict: "user_id,company_bio_id" }
    );
  if (memErr) throw new Error(`upsert membership failed: ${memErr.message}`);
  console.log(`  Membership row OK (tier=owner)`);

  console.log(`\n✓ Done. De Vera Grill tenant ready.`);
  console.log(`  company_bio_id = ${bioId}`);
  console.log(`  Reload the CRM (or log out & in) — should appear in the tenant switcher for ${OWNER_EMAIL}.`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
