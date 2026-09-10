// Creates a Growth Engine account for joaquin@swlconsulting.com with
// super_admin access (SWL internal ops), password set directly — no invite
// email, so he can log in immediately.
//
// Mirrors the canonical flow in app/api/team/invite/route.ts, except the auth
// user is created with `password` + `email_confirm: true` instead of
// inviteUserByEmail (Fran asked for the credentials handed over directly):
//   1. auth.admin.createUser({ email, password, email_confirm: true })
//   2. user_profiles: role='admin', tier='super_admin', is_super_admin=true,
//      home tenant = SWL Consulting  (mirrors juan@/luciano@/lucia.antel@)
//   3. user_company_memberships: one 'owner' row on SWL Consulting. Super
//      admins are implicit members of every active bio (see lib/scope.ts), so
//      the home row is all that's needed.
// Idempotent-ish: re-running after the user exists resets the password and
// upserts the profile + membership.
//
// PROVENANCE: the account was actually created on 2026-09-09 by issuing these
// same three operations directly (POST /auth/v1/admin/users + two SQL
// statements via the Management API). This file is the reproducible
// equivalent, kept for the record alongside the other onboarding scripts;
// it has not itself been executed against prod.

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
// NOTE (2026-09-09): .env.local in this checkout is wired to a LOCAL Supabase
// instance — its URL gives ECONNREFUSED and its service key 401s against the
// hosted project. So default to the hosted host and let the caller pass the
// prod service key in the environment:
//   SUPABASE_SERVICE_KEY=<prod service_role> JOAQUIN_PW=... node scripts/ops/create-joaquin-admin-2026-09-09.mjs
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://uljoengwmmwdqpcxnbjs.supabase.co";
if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}
const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = "joaquin@swlconsulting.com";
const PASSWORD = process.env.JOAQUIN_PW;
const SWL_BIO = "7c02e222-be59-416d-9434-acf4685f8590"; // SWL Consulting
if (!PASSWORD) { console.error("Set JOAQUIN_PW in the environment."); process.exit(1); }

// 1. Find or create the auth user.
const { data: list, error: lErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
if (lErr) { console.error(lErr); process.exit(1); }
let user = (list?.users ?? []).find(u => u.email?.toLowerCase() === EMAIL);

if (user) {
  const { error: uErr } = await svc.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true });
  if (uErr) { console.error("Password reset failed:", uErr.message); process.exit(1); }
  console.log(`User already existed: ${user.id} — password reset ✓`);
} else {
  const { data: created, error: cErr } = await svc.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true, // no confirmation round-trip; he logs in right away
  });
  if (cErr || !created?.user) { console.error("Create failed:", cErr?.message); process.exit(1); }
  user = created.user;
  console.log(`Created user: ${user.id} (${user.email}) ✓`);
}

// 2. user_profiles — same shape as the other SWL super admins.
const { error: pErr } = await svc.from("user_profiles").upsert(
  { user_id: user.id, company_bio_id: SWL_BIO, role: "admin", tier: "super_admin", is_super_admin: true },
  { onConflict: "user_id" }
);
if (pErr) { console.error("user_profiles failed:", pErr.message); process.exit(1); }
console.log("user_profiles: tier=super_admin, role=admin, is_super_admin=true, home=SWL Consulting ✓");

// 3. Membership on the home tenant.
const { data: prior } = await svc
  .from("user_company_memberships")
  .select("user_id, tier")
  .eq("user_id", user.id)
  .eq("company_bio_id", SWL_BIO)
  .maybeSingle();
if (!prior) {
  const { error: mErr } = await svc.from("user_company_memberships")
    .insert({ user_id: user.id, company_bio_id: SWL_BIO, tier: "owner" });
  if (mErr) { console.error("membership failed:", mErr.message); process.exit(1); }
  console.log("membership: SWL Consulting → owner ✓");
} else {
  console.log(`membership: already ${prior.tier} — skip.`);
}

// 4. Read-back.
const { data: prof } = await svc
  .from("user_profiles")
  .select("role, tier, is_super_admin, company_bios(company_name)")
  .eq("user_id", user.id)
  .maybeSingle();
console.log("\nRead-back:", JSON.stringify(prof));
console.log("Done.");
