// Assigns sara@swlconsulting.com (already signed up, sitting in Pending
// Assignment) to SWL Consulting + Arqy as `owner`. Does NOT touch her password.
//   1. find the existing auth user (abort if not found)
//   2. user_profiles row (role='client', tier='owner', default tenant = SWL)
//   3. user_company_memberships row per tenant, tier='owner'

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = "sara@swlconsulting.com";
const TIER = "owner";
const TENANTS = [
  { name: "SWL Consulting", id: "7c02e222-be59-416d-9434-acf4685f8590" },
  { name: "Arqy",           id: "0902962f-4b15-4810-a5bd-730d4b22a527" },
];
const DEFAULT_TENANT = TENANTS[0].id; // landing tenant on first login

// 1. Find the existing user (she signed up, so she must exist).
const { data: list, error: lErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
if (lErr) { console.error(lErr); process.exit(1); }
const user = (list?.users ?? []).find(u => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user) { console.error(`No auth user for ${EMAIL} — aborting (expected an existing signup).`); process.exit(1); }
console.log(`Found user: ${user.id} (${user.email}) — password untouched.`);

// 2. user_profiles (upsert on user_id so a re-run is safe).
const { error: pErr } = await svc.from("user_profiles").upsert(
  { user_id: user.id, company_bio_id: DEFAULT_TENANT, role: "client", tier: TIER },
  { onConflict: "user_id" }
);
if (pErr) { console.error("user_profiles failed:", pErr.message); process.exit(1); }
console.log(`user_profiles: tier=${TIER}, default tenant=SWL ✓`);

// 3. Memberships — one owner row per tenant.
for (const t of TENANTS) {
  const { data: prior } = await svc
    .from("user_company_memberships")
    .select("user_id, tier")
    .eq("user_id", user.id)
    .eq("company_bio_id", t.id)
    .maybeSingle();
  if (prior) {
    if (prior.tier !== TIER) {
      await svc.from("user_company_memberships").update({ tier: TIER })
        .eq("user_id", user.id).eq("company_bio_id", t.id);
      console.log(`  ${t.name}: ${prior.tier} → ${TIER} ✓`);
    } else {
      console.log(`  ${t.name}: already ${TIER} — skip.`);
    }
  } else {
    const { error: mErr } = await svc.from("user_company_memberships")
      .insert({ user_id: user.id, company_bio_id: t.id, tier: TIER });
    if (mErr) { console.error(`  ${t.name} membership failed:`, mErr.message); process.exit(1); }
    console.log(`  ${t.name}: new ${TIER} ✓`);
  }
}

// 4. Read-back.
const { data: finalMems } = await svc
  .from("user_company_memberships")
  .select("tier, company_bios(company_name)")
  .eq("user_id", user.id);
console.log("\nFinal memberships:");
for (const m of finalMems ?? []) {
  const name = Array.isArray(m.company_bios) ? m.company_bios[0]?.company_name : m.company_bios?.company_name;
  console.log(`  ${name} → ${m.tier}`);
}
console.log("\nDone.");
