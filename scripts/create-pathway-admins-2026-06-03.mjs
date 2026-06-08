// Creates Growth Engine accounts for samantha@ and Nathan@pathwaycommercialfinance.co.uk
// with `owner` access on Pathway Commercial Finance only.
//
// Unlike the invite-by-email flow (create-sara-owner), this sets a password
// directly (admin.createUser + email_confirm) so we can hand the client ready
// credentials. Each user should change their password on first login.
//
// Mirrors the canonical flow in app/api/team/invite/route.ts:
//   1. create the auth user with a password (email pre-confirmed)
//   2. user_profiles row (role='client', tier='owner', default tenant = Pathway)
//   3. user_company_memberships row, tier='owner'
// Idempotent-ish: re-running after a user exists skips create and upserts rows.

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

const TIER = "owner";
const PATHWAY = { name: "Pathway Commercial Finance", id: "10969697-f900-47f5-ba64-2287fa72b44d" };
const USERS = [
  { email: "samantha@pathwaycommercialfinance.co.uk", password: "Pathway-Sam-2026!" },
  { email: "Nathan@pathwaycommercialfinance.co.uk",   password: "Pathway-Nat-2026!" },
];

for (const u of USERS) {
  console.log(`\n=== ${u.email} ===`);

  // 1. Find or create the auth user (with a set password, email pre-confirmed).
  const { data: list, error: lErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (lErr) { console.error(lErr); process.exit(1); }
  let user = (list?.users ?? []).find(x => x.email?.toLowerCase() === u.email.toLowerCase());

  if (user) {
    console.log(`User already exists: ${user.id} — resetting password.`);
    const { error: uErr } = await svc.auth.admin.updateUserById(user.id, {
      password: u.password, email_confirm: true,
    });
    if (uErr) { console.error("password reset failed:", uErr.message); process.exit(1); }
  } else {
    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
    });
    if (cErr || !created?.user) { console.error("create failed:", cErr?.message); process.exit(1); }
    user = created.user;
    console.log(`Created new user: ${user.id} (${user.email}) ✓`);
  }

  // 2. user_profiles (upsert on user_id so a re-run is safe).
  const { error: pErr } = await svc.from("user_profiles").upsert(
    { user_id: user.id, company_bio_id: PATHWAY.id, role: "client", tier: TIER },
    { onConflict: "user_id" }
  );
  if (pErr) { console.error("user_profiles failed:", pErr.message); process.exit(1); }
  console.log(`user_profiles: tier=${TIER}, default tenant=Pathway ✓`);

  // 3. Membership — one owner row on Pathway.
  const { data: prior } = await svc
    .from("user_company_memberships")
    .select("user_id, tier")
    .eq("user_id", user.id)
    .eq("company_bio_id", PATHWAY.id)
    .maybeSingle();
  if (prior) {
    if (prior.tier !== TIER) {
      await svc.from("user_company_memberships").update({ tier: TIER })
        .eq("user_id", user.id).eq("company_bio_id", PATHWAY.id);
      console.log(`  ${PATHWAY.name}: ${prior.tier} → ${TIER} ✓`);
    } else {
      console.log(`  ${PATHWAY.name}: already ${TIER} — skip.`);
    }
  } else {
    const { error: mErr } = await svc.from("user_company_memberships")
      .insert({ user_id: user.id, company_bio_id: PATHWAY.id, tier: TIER });
    if (mErr) { console.error(`  ${PATHWAY.name} membership failed:`, mErr.message); process.exit(1); }
    console.log(`  ${PATHWAY.name}: new ${TIER} ✓`);
  }
}

console.log("\nAll done.");
