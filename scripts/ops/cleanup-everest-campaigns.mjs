// Cleanup helper — wipes campaigns / campaign_messages / lead_replies and
// resets lead statuses for the Gruppo Everest tenant, then deletes the sellers.
// Use to re-run create-everest-fake-campaigns.mjs from a clean slate. Leaves
// the bio, ICP and 15 leads intact.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANT_NAME = "Gruppo Everest";

async function main() {
  const { data: bio } = await svc.from("company_bios").select("id").eq("company_name", TENANT_NAME).is("archived_at", null).single();
  if (!bio) { console.error("Bio not found"); process.exit(1); }
  const BIO = bio.id;
  console.log(`→ Cleaning Gruppo Everest tenant ${BIO} ...`);

  // 1) Get lead ids for this tenant
  const { data: leads } = await svc.from("leads").select("id").eq("company_bio_id", BIO);
  const leadIds = (leads ?? []).map(l => l.id);
  console.log(`  ${leadIds.length} leads scoped`);

  if (leadIds.length > 0) {
    // 2) Get campaign ids for these leads
    const { data: camps } = await svc.from("campaigns").select("id").in("lead_id", leadIds);
    const campIds = (camps ?? []).map(c => c.id);
    console.log(`  ${campIds.length} campaigns to drop`);

    if (campIds.length > 0) {
      const { error: e1 } = await svc.from("campaign_messages").delete().in("campaign_id", campIds);
      if (e1) console.warn(`  campaign_messages delete: ${e1.message}`);
      const { error: e2 } = await svc.from("lead_replies").delete().in("campaign_id", campIds);
      if (e2) console.warn(`  lead_replies delete: ${e2.message}`);
      const { error: e3 } = await svc.from("campaigns").delete().in("id", campIds);
      if (e3) console.warn(`  campaigns delete: ${e3.message}`);
    }

    // 3) Reset lead statuses (status='new', drop opp_stage, drop current_channel, drop transferred_to_odoo_at)
    const { error: leadErr } = await svc.from("leads").update({
      status: "new",
      opportunity_stage: null,
      current_channel: null,
      transferred_to_odoo_at: null,
    }).in("id", leadIds);
    if (leadErr) console.warn(`  leads reset: ${leadErr.message}`);
  }

  // 4) Drop sellers (Juan Fontana + Luciano Sosa) under this bio
  const { error: sellErr } = await svc.from("sellers").delete().eq("company_bio_id", BIO);
  if (sellErr) console.warn(`  sellers delete: ${sellErr.message}`);

  console.log(`\n✓ Done. Bio, ICP and leads are kept.`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
