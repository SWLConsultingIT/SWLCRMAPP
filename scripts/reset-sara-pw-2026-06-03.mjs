// Sets a known password for sara@swlconsulting.com and confirms her email so
// she can log in. Does not touch her profile/memberships (already assigned).
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
const PASSWORD = "Sara-SWL-2026!";

const { data: list, error: lErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
if (lErr) { console.error(lErr); process.exit(1); }
const user = (list?.users ?? []).find(u => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user) { console.error(`No auth user for ${EMAIL} — aborting.`); process.exit(1); }

const { error: uErr } = await svc.auth.admin.updateUserById(user.id, {
  password: PASSWORD, email_confirm: true,
});
if (uErr) { console.error("update failed:", uErr.message); process.exit(1); }
console.log(`Password set + email confirmed for ${user.email} (${user.id}) ✓`);
console.log(`  email: ${EMAIL}`);
console.log(`  password: ${PASSWORD}`);
