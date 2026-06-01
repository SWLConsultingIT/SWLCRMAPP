// Grants simone.martini18@gmail.com `owner` membership on Arqy, SWL and
// Pathway. If the auth.users row doesn't exist yet, the script aborts
// without writing — you have to invite/create the user first (via the
// /admin team page or the auth dashboard), then re-run.
//
// Idempotent: upserts on (user_id, company_bio_id) so re-running just
// flips an existing membership to `owner`.

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

const EMAIL = "simone.martini18@gmail.com";
// Match company_bios.company_name exactly. SWL is "SWL Consulting",
// Pathway is "Pathway Commercial Finance".
const TENANTS = ["Arqy", "SWL Consulting", "Pathway Commercial Finance"];

// 1. Find the user by email.
const { data: userList, error: uErr } = await svc.auth.admin.listUsers({ perPage: 200 });
if (uErr) { console.error(uErr); process.exit(1); }
const user = (userList?.users ?? []).find(u => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user) {
  console.error(`No auth.users row for ${EMAIL}. Invite the user first via /admin team page or Supabase auth dashboard, then re-run.`);
  process.exit(1);
}
console.log(`User found: ${user.id} (${user.email})`);

// 2. Resolve the 3 company_bio_ids by name (lookup is case-sensitive on
//    company_name — ilike to be safe).
const { data: bios } = await svc.from("company_bios").select("id, company_name").or(TENANTS.map(t => `company_name.ilike.${t}`).join(","));
if (!bios || bios.length < 3) {
  console.error("Couldn't resolve all 3 tenants. Found:", bios?.map(b => b.company_name));
  process.exit(1);
}
const bioByName = new Map(bios.map(b => [b.company_name, b.id]));
console.log("Tenants:");
for (const t of TENANTS) console.log(`  ${t} → ${bioByName.get(t)}`);

// 3. Upsert memberships.
console.log("Upserting memberships…");
for (const t of TENANTS) {
  const bioId = bioByName.get(t);
  // Manual upsert via select + insert/update so we don't depend on a
  // unique constraint that may or may not be there.
  const { data: existing } = await svc
    .from("user_company_memberships")
    .select("id, tier")
    .eq("user_id", user.id)
    .eq("company_bio_id", bioId)
    .maybeSingle();

  if (existing) {
    if (existing.tier === "owner") {
      console.log(`  ${t}: already owner — skip.`);
      continue;
    }
    const { error } = await svc
      .from("user_company_memberships")
      .update({ tier: "owner" })
      .eq("id", existing.id);
    if (error) { console.error(error); process.exit(1); }
    console.log(`  ${t}: ${existing.tier} → owner ✓`);
  } else {
    const { error } = await svc
      .from("user_company_memberships")
      .insert({ user_id: user.id, company_bio_id: bioId, tier: "owner" });
    if (error) { console.error(error); process.exit(1); }
    console.log(`  ${t}: new owner ✓`);
  }
}

// 4. user_profiles.tier — keep it whatever it is unless it's missing.
//    A user with owner memberships across multiple tenants typically has
//    profile.tier='owner' (per the bootstrap logic), which is correct.
const { data: prof } = await svc.from("user_profiles").select("id, tier, role").eq("id", user.id).maybeSingle();
if (!prof) {
  console.log("\nuser_profiles row missing — inserting with tier=owner.");
  const { error } = await svc.from("user_profiles").insert({ id: user.id, tier: "owner", role: "client" });
  if (error) { console.error(error); process.exit(1); }
} else {
  console.log(`\nuser_profiles: tier=${prof.tier}, role=${prof.role} — left as-is.`);
}

// 5. Final read-back.
const { data: finalMems } = await svc
  .from("user_company_memberships")
  .select("company_bio_id, tier, company_bios(company_name)")
  .eq("user_id", user.id);
console.log("\nFinal memberships:");
for (const m of finalMems) {
  const name = Array.isArray(m.company_bios) ? m.company_bios[0]?.company_name : m.company_bios?.company_name;
  console.log(`  ${name ?? m.company_bio_id} → ${m.tier}`);
}
console.log("\nDone.");
