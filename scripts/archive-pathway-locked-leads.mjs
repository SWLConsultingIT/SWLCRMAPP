#!/usr/bin/env node
// Companion to close-pathway-locked.mjs — finishes the lead-side
// update that bounced off the response_outcome enum. The 22 campaigns
// are already closed_lost; this just archives the leads + flips their
// status so they don't reappear in future imports / pickers.

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

const BIO = "10969697-f900-47f5-ba64-2287fa72b44d";

// Find every lead whose campaign was just closed with one of the
// "give up" stop_reasons. Use that join so we don't have to rehydrate
// PII or re-classify failed messages — the campaigns table is the
// source of truth now.
const { data: camps } = await svc.from("campaigns")
  .select("lead_id, stop_reason, leads!inner(id, company_bio_id, status, archived)")
  .eq("leads.company_bio_id", BIO)
  .eq("status", "closed_lost")
  .in("stop_reason", ["recipient_locked", "name_mismatch_wrong_person"]);

const leadIds = [...new Set((camps ?? []).map(c => c.lead_id))];
console.log(`Leads to archive: ${leadIds.length}`);

if (!apply) {
  console.log("Dry-run. Re-run with --apply to write.");
  process.exit(0);
}

const { error } = await svc.from("leads")
  .update({ status: "closed_lost", archived: true })
  .in("id", leadIds);
if (error) { console.error("Update failed:", error.message); process.exit(1); }
console.log(`Done. Archived ${leadIds.length} leads.`);
