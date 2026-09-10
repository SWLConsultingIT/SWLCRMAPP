#!/usr/bin/env node
// Reassign every Pathway lead's icp_profile_id to match the ICP the
// flow they're currently in implies. Boss directive: "si ya hay una
// campaña de Asset, hacé que esos pertenezcan al ICP de Asset".
//
// How: flow name contains "asset"   → Asset Finance — Unified
//                          "invoice" → Invoice Finance — Unified
//                          "bridging" → Bridging Finance — Unified (SKIPPED
//                                       per Fran: "Bridging no todavía")
//
// One lead can be in multiple campaign rows. If ANY of them maps to
// Asset and ANY maps to Invoice (legacy cross-ICP mess), the script
// skips that lead and prints a warning rather than picking arbitrarily.
//
// Modes:
//   node repair-pathway-lead-icps.mjs          # dry-run
//   node repair-pathway-lead-icps.mjs --apply

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

const BIO = "10969697-f900-47f5-ba64-2287fa72b44d"; // Pathway Commercial Finance

// 1. Resolve the 3 unified ICPs by name
const { data: icps } = await svc.from("icp_profiles")
  .select("id, profile_name")
  .eq("company_bio_id", BIO);
const assetIcp   = icps.find(i => /Asset Finance — Unified/.test(i.profile_name))?.id;
const invoiceIcp = icps.find(i => /Invoice Finance — Unified/.test(i.profile_name))?.id;
const bridgingIcp = icps.find(i => /Bridging Finance — Unified/.test(i.profile_name))?.id;
if (!assetIcp || !invoiceIcp || !bridgingIcp) {
  console.error("Could not resolve one of the unified ICPs:", { assetIcp, invoiceIcp, bridgingIcp });
  process.exit(1);
}
console.log(`Asset Unified:    ${assetIcp}`);
console.log(`Invoice Unified:  ${invoiceIcp}`);
console.log(`Bridging Unified: ${bridgingIcp}  (SKIPPED per Fran)`);
console.log(`Mode: ${apply ? "APPLY (will UPDATE)" : "DRY-RUN"}\n`);

// 2. Pull every campaign row for leads in Pathway
const camps = [];
let from = 0;
while (true) {
  const { data } = await svc.from("campaigns")
    .select("id, name, lead_id, status, leads!inner(company_bio_id, icp_profile_id, primary_first_name, primary_last_name, company_name)")
    .eq("leads.company_bio_id", BIO)
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  camps.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Loaded ${camps.length} campaign rows.\n`);

// 3. Infer target ICP from each flow name
function targetIcpFor(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  // Order matters — check Bridging first because the literal word
  // "asset" doesn't show up in Bridging-themed flow names, but if
  // a name ever had both keywords this would surface it cleanly.
  if (/bridging/.test(n)) return "BRIDGING_SKIPPED";
  if (/asset/.test(n))    return assetIcp;
  if (/invoice/.test(n))  return invoiceIcp;
  return null;
}

// 4. Build per-lead set of inferred ICPs (across all their campaigns)
const inferredByLead = new Map(); // leadId → Set<icpId>
const leadInfo = new Map();       // leadId → {name, co, currentIcp}
for (const c of camps) {
  const inferred = targetIcpFor(c.name);
  if (!inferred) continue;
  if (!inferredByLead.has(c.lead_id)) inferredByLead.set(c.lead_id, new Set());
  inferredByLead.get(c.lead_id).add(inferred);
  if (!leadInfo.has(c.lead_id)) {
    leadInfo.set(c.lead_id, {
      name: `${c.leads.primary_first_name ?? ""} ${c.leads.primary_last_name ?? ""}`.trim() || "(no name)",
      co: c.leads.company_name ?? "—",
      currentIcp: c.leads.icp_profile_id,
    });
  }
}

// 5. Decide updates
const updates = []; // [{leadId, fromIcp, toIcp, name, co, viaFlow}]
const conflicts = [];
const skippedBridging = [];
const alreadyOk = [];
for (const [leadId, set] of inferredByLead) {
  const info = leadInfo.get(leadId);
  // Filter out the "BRIDGING_SKIPPED" sentinel — if the lead has ONLY
  // Bridging flows, it's skipped; if it has Bridging AND Asset, we
  // pick the non-Bridging one and continue (Bridging flows are
  // typically legacy archived rows mixed in).
  const realTargets = [...set].filter(x => x !== "BRIDGING_SKIPPED");
  if (realTargets.length === 0) { skippedBridging.push(leadId); continue; }
  if (realTargets.length > 1) {
    conflicts.push({ leadId, info, targets: realTargets });
    continue;
  }
  const target = realTargets[0];
  if (info.currentIcp === target) { alreadyOk.push(leadId); continue; }
  updates.push({
    leadId, fromIcp: info.currentIcp, toIcp: target,
    name: info.name, co: info.co,
  });
}

console.log(`Leads already on the right ICP: ${alreadyOk.length}`);
console.log(`Leads only on Bridging flows (skipped): ${skippedBridging.length}`);
console.log(`Leads with conflicting flow ICPs: ${conflicts.length}`);
if (conflicts.length > 0) {
  console.log("  (these leads have both Asset and Invoice flows — left untouched)");
  for (const c of conflicts.slice(0, 10)) {
    console.log(`    ${c.leadId}  ${c.info.name} · ${c.info.co}  targets=${c.targets.join(", ")}`);
  }
}
console.log(`Leads to UPDATE: ${updates.length}\n`);

// Break down updates by target
const byTarget = new Map();
for (const u of updates) {
  const k = u.toIcp === assetIcp ? "Asset Unified" : u.toIcp === invoiceIcp ? "Invoice Unified" : u.toIcp;
  byTarget.set(k, (byTarget.get(k) ?? 0) + 1);
}
for (const [k, n] of byTarget) console.log(`  → ${n} leads to ${k}`);
console.log("");

// Show first 20 updates as sanity check
console.log("Sample (first 20):");
for (const u of updates.slice(0, 20)) {
  const target = u.toIcp === assetIcp ? "Asset" : u.toIcp === invoiceIcp ? "Invoice" : "?";
  console.log(`  ${u.leadId.slice(0,8)}  ${u.name.padEnd(28).slice(0,28)}  ${u.co.padEnd(40).slice(0,40)}  →  ${target}`);
}
if (updates.length > 20) console.log(`  … +${updates.length - 20} more\n`);

if (!apply) {
  console.log("\nDry-run only. Re-run with --apply to actually update.");
  process.exit(0);
}
if (updates.length === 0) {
  console.log("\nNothing to update.");
  process.exit(0);
}

// 6. Apply in chunks
console.log("\nApplying updates…");
let done = 0;
// Group by target ICP so we can do bulk updates per target
const groups = new Map();
for (const u of updates) {
  if (!groups.has(u.toIcp)) groups.set(u.toIcp, []);
  groups.get(u.toIcp).push(u.leadId);
}
for (const [toIcp, leadIds] of groups) {
  for (let i = 0; i < leadIds.length; i += 200) {
    const slice = leadIds.slice(i, i + 200);
    const { error } = await svc.from("leads")
      .update({ icp_profile_id: toIcp })
      .in("id", slice);
    if (error) { console.error(`chunk failed: ${error.message}`); continue; }
    done += slice.length;
    console.log(`  ${done}/${updates.length} updated`);
  }
}
console.log(`\nDone. Updated ${done} leads.`);
