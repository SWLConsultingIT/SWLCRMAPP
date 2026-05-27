// Consolidate Pathway down to 3 unified ICPs (Asset, Invoice, Bridging).
//
// Steps:
//   1. Delete every active/paused campaign for Pathway leads. We wipe child
//      rows first (campaign_messages, lead_replies) so the campaigns delete
//      doesn't trip FK constraints. Completed/failed campaigns are kept so
//      the journey timeline + Won/Lost views still tell the story.
//   2. Ensure the unified Bridging ICP exists (Asset + Invoice already do
//      from the previous import run).
//   3. UPDATE leads.icp_profile_id from each legacy ICP → its unified
//      counterpart (Asset, Invoice, or Bridging).
//   4. DELETE the 13 legacy ICP rows now that nothing references them.
//   5. Print the final 3-bucket count so we can sanity check.
//
// Idempotent: re-running deletes 0 campaigns (none active), reuses the
// Bridging ICP, finds 0 leads to re-tag, and finds 0 legacy ICPs to drop.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PATHWAY_BIO_ID = "10969697-f900-47f5-ba64-2287fa72b44d";

const NEW_ASSET_ICP   = "c99841b8-5413-414e-a2b0-f89da2f37e68";
const NEW_INVOICE_ICP = "85cf66f2-fac6-49e3-8508-ad2d094abeab";
const ICP_BRIDGING_NAME = "Bridging Finance — Unified (UK SME · Director / Owner)";

const LEGACY_ASSET = [
  "912f5c7c-3fc0-4563-89ae-67b772752adc",
  "fcc52405-992d-4d77-99ad-80d99a6238fe",
  "50c4383f-f083-4b8c-9bea-0793b4e5b200",
  "62b060a2-47fe-4f3f-af31-8c144d79d9aa",
  "8fa0127e-99d0-47be-ba14-3db2d48a1112",
];
const LEGACY_INVOICE = [
  "ce03b677-5643-4e3c-8a11-5d55266ca0d7",
  "1f496887-ff64-4332-883c-ca9990df3aee",
  "68934b3b-b875-4be6-a7a2-fd47f4bdcda5",
  "f6538462-8185-4bb0-9776-ee08ed770554",
  "68fb8754-5cd7-4a68-acf5-961b5dcea3a7",
  "3e8feb92-f699-4ff1-933a-3a2f5a49f03b",
];
const LEGACY_BRIDGING = [
  "98fd0cac-f1a0-48c6-9b17-2ff3f150118f",
  "0f6816b6-dd13-48d2-9086-b2eea1257a5d",
];
const ALL_LEGACY = [...LEGACY_ASSET, ...LEGACY_INVOICE, ...LEGACY_BRIDGING];

async function main() {
  // ── 0. Sanity check tenant ──
  const { data: bio } = await svc.from("company_bios").select("id, company_name").eq("id", PATHWAY_BIO_ID).single();
  if (!bio) { console.error("Pathway bio not found"); process.exit(1); }
  console.log(`→ Tenant: ${bio.company_name} (${bio.id})`);

  // ── 1. Find Pathway lead IDs ──
  let allLeadIds = [];
  let off = 0;
  while (true) {
    const { data } = await svc.from("leads").select("id").eq("company_bio_id", PATHWAY_BIO_ID).range(off, off + 999);
    if (!data || data.length === 0) break;
    allLeadIds.push(...data.map(l => l.id));
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`  ${allLeadIds.length} Pathway leads total`);

  // ── 2. Find active/paused campaigns to delete ──
  console.log(`\n→ Step 1 / 5 — delete active+paused campaigns ...`);
  // Supabase REST .in() has a URL-length cap; chunk if needed.
  async function chunked(arr, fn) {
    const CHUNK = 500;
    const out = [];
    for (let i = 0; i < arr.length; i += CHUNK) {
      const sub = arr.slice(i, i + CHUNK);
      const res = await fn(sub);
      out.push(res);
    }
    return out;
  }

  let activeCampIds = [];
  await chunked(allLeadIds, async (sub) => {
    const { data } = await svc.from("campaigns").select("id").in("lead_id", sub).in("status", ["active", "paused"]);
    activeCampIds.push(...(data ?? []).map(c => c.id));
  });
  console.log(`  ${activeCampIds.length} active/paused campaigns to delete`);

  if (activeCampIds.length > 0) {
    // Delete child rows first (FK protection).
    let msgsDeleted = 0;
    await chunked(activeCampIds, async (sub) => {
      const { count } = await svc.from("campaign_messages").delete({ count: "exact" }).in("campaign_id", sub);
      msgsDeleted += count ?? 0;
    });
    console.log(`    ${msgsDeleted} campaign_messages deleted`);

    let repliesDeleted = 0;
    await chunked(activeCampIds, async (sub) => {
      const { count } = await svc.from("lead_replies").delete({ count: "exact" }).in("campaign_id", sub);
      repliesDeleted += count ?? 0;
    });
    console.log(`    ${repliesDeleted} lead_replies deleted (campaign-scoped)`);

    let campsDeleted = 0;
    await chunked(activeCampIds, async (sub) => {
      const { count, error } = await svc.from("campaigns").delete({ count: "exact" }).in("id", sub);
      if (error) { console.error(`campaigns delete: ${error.message}`); process.exit(1); }
      campsDeleted += count ?? 0;
    });
    console.log(`    ${campsDeleted} campaigns deleted`);
  }

  // ── 3. Ensure unified Bridging ICP ──
  console.log(`\n→ Step 2 / 5 — ensure unified Bridging ICP ...`);
  let bridgingIcpId;
  const { data: bridgingExisting } = await svc.from("icp_profiles")
    .select("id").eq("company_bio_id", PATHWAY_BIO_ID).eq("profile_name", ICP_BRIDGING_NAME).maybeSingle();
  if (bridgingExisting) {
    bridgingIcpId = bridgingExisting.id;
    console.log(`  Reusing Bridging ICP id=${bridgingIcpId}`);
  } else {
    const { data, error } = await svc.from("icp_profiles").insert({
      company_bio_id: PATHWAY_BIO_ID,
      profile_name: ICP_BRIDGING_NAME,
      target_industries: [
        "Residential Landlords / BTL Investors",
        "Property Developers", "Property Refurbishment",
        "Commercial Property Investors", "Hospitality Freehold Operators",
        "Auction Property Buyers",
      ],
      target_roles: [
        "Owner", "Managing Director", "Director", "Property Director",
        "Finance Director", "CFO", "Partner", "Founder",
      ],
      company_size: "1-100",
      geography: ["United Kingdom (England · Scotland · Wales · NI)"],
      pain_points:
        "UK property professionals needing fast, asset-backed short-term lending for acquisitions, refurbs, auction " +
        "purchases, chain-breaks and refinance bridges. Bank facilities are too slow, term lender appetite limited. " +
        "Trigger events include recently-acquired assets, mortgage redemption windows, and existing bridge maturing " +
        "in the next 90 days.",
      solutions_offered:
        "Bridging Finance via Pathway Commercial Finance — regulated + unregulated bridge across 40+ lenders. " +
        "Decisions within 24-48h, drawdown 7-14 days. Loan sizes £100k-£25m, LTVs to 75%, terms 3-24 months. " +
        "Refinance of in-flight bridges + auction-finance specialty.",
      notes:
        "Unified Bridging ICP — supersedes the 2 prior product-specific Bridging ICPs (98fd0cac, 0f6816b6). " +
        "Lead universe filtered by UK property verticals; charge signals + recent acquisitions used to prioritize.",
      status: "approved",
      execution_status: "completed",
    }).select("id").single();
    if (error || !data) { console.error(`Bridging ICP insert failed: ${error?.message}`); process.exit(1); }
    bridgingIcpId = data.id;
    console.log(`  Created Bridging ICP id=${bridgingIcpId}`);
  }

  // ── 4. Migrate legacy ICPs → unified ──
  console.log(`\n→ Step 3 / 5 — migrate leads to unified ICPs ...`);
  async function migrate(legacyIds, targetId, label) {
    const { count, error } = await svc.from("leads")
      .update({ icp_profile_id: targetId }, { count: "exact" })
      .eq("company_bio_id", PATHWAY_BIO_ID)
      .in("icp_profile_id", legacyIds);
    if (error) { console.error(`migrate ${label}: ${error.message}`); process.exit(1); }
    console.log(`  ${label}: ${count} leads → ${targetId.slice(0, 8)}…`);
    return count ?? 0;
  }
  const movedAsset    = await migrate(LEGACY_ASSET,    NEW_ASSET_ICP,    "Asset legacy → unified");
  const movedInvoice  = await migrate(LEGACY_INVOICE,  NEW_INVOICE_ICP,  "Invoice legacy → unified");
  const movedBridging = await migrate(LEGACY_BRIDGING, bridgingIcpId,    "Bridging legacy → unified");

  // ── 5. Delete legacy ICPs ──
  console.log(`\n→ Step 4 / 5 — delete legacy ICP rows ...`);
  const { count: icpDeleted, error: icpDelErr } = await svc.from("icp_profiles")
    .delete({ count: "exact" })
    .eq("company_bio_id", PATHWAY_BIO_ID)
    .in("id", ALL_LEGACY);
  if (icpDelErr) { console.error(`ICP delete: ${icpDelErr.message}`); process.exit(1); }
  console.log(`  ${icpDeleted} legacy ICPs deleted`);

  // ── 6. Final verification ──
  console.log(`\n→ Step 5 / 5 — final verification ...`);
  let final = [];
  off = 0;
  while (true) {
    const { data } = await svc.from("leads").select("id, icp_profile_id").eq("company_bio_id", PATHWAY_BIO_ID).range(off, off + 999);
    if (!data || data.length === 0) break;
    final.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  const bucket = { Asset: 0, Invoice: 0, Bridging: 0, Other: 0 };
  for (const l of final) {
    if (l.icp_profile_id === NEW_ASSET_ICP) bucket.Asset++;
    else if (l.icp_profile_id === NEW_INVOICE_ICP) bucket.Invoice++;
    else if (l.icp_profile_id === bridgingIcpId) bucket.Bridging++;
    else bucket.Other++;
  }
  console.log(`  Total Pathway leads: ${final.length}`);
  console.log(`    Asset:    ${bucket.Asset}`);
  console.log(`    Invoice:  ${bucket.Invoice}`);
  console.log(`    Bridging: ${bucket.Bridging}`);
  console.log(`    Other:    ${bucket.Other}`);

  // ICP count
  const { data: icpsLeft } = await svc.from("icp_profiles").select("id, profile_name").eq("company_bio_id", PATHWAY_BIO_ID);
  console.log(`\n  Pathway ICPs remaining (${icpsLeft?.length}):`);
  for (const i of icpsLeft ?? []) console.log(`    ${i.id} — ${i.profile_name}`);

  console.log(`\n✓ Done.`);
  console.log(`  New Bridging ICP id: ${bridgingIcpId}`);
  console.log(`  Update sheet/Pathway/appscript_sync_all.gs ICP_TO_PRODUCT with just the 3 unified ICPs.`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
