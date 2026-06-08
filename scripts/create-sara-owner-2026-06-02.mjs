// Creates a Growth Engine account for sarabartoli01@gmail.com with `owner`
// access on SWL Consulting and Arqy only. Mirrors the canonical flow in
// app/api/team/invite/route.ts:
//   1. invite the auth user (sends a Supabase invite email so she sets her pw)
//   2. user_profiles row (role='client', tier='owner', default tenant = SWL)
//   3. user_company_memberships row per tenant, tier='owner'
//
// NOT super_admin — she only gets the two tenants. Idempotent-ish: re-running
// after the user exists skips the invite and upserts memberships.

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

const EMAIL = "sarabartoli01@gmail.com";
const TIER = "owner";
const TENANTS = [
  { name: "SWL Consulting", id: "7c02e222-be59-416d-9434-acf4685f8590" },
  { name: "Arqy",           id: "0902962f-4b15-4810-a5bd-730d4b22a527" },
];
const DEFAULT_TENANT = TENANTS[0].id; // landing tenant on first login

// 1. Find or invite the user.
const { data: list, error: lErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
if (lErr) { console.error(lErr); process.exit(1); }
let user = (list?.users ?? []).find(u => u.email?.toLowerCase() === EMAIL.toLowerCase());

if (user) {
  console.log(`User already exists: ${user.id} — skipping invite.`);
} else {
  const { data: invited, error: iErr } = await svc.auth.admin.inviteUserByEmail(EMAIL);
  if (iErr || !invited?.user) { console.error("Invite failed:", iErr?.message); process.exit(1); }
  user = invited.user;
  console.log(`Invited new user: ${user.id} (${user.email}) — invite email sent.`);
}

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
