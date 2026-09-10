#!/usr/bin/env node
// Why don't the 8 Pathway acceptances surface as synthetic entries in
// /queue Replies? The query in app/queue/page.tsx filters
// campaign_messages step_number=1 + metadata.queued_by IN (webhook markers).
// Check whether those leads have a step_number=1 row at all, and if so,
// what's in metadata.queued_by.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => {
      const idx = l.indexOf("="); return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const bio = { id: "10969697-f900-47f5-ba64-2287fa72b44d", company_name: "Pathway Commercial Finance" };
console.log(`Pathway bio: ${bio.id} (${bio.company_name})`);

// All Pathway leads with linkedin_connected=true
const { data: accepted } = await supabase
  .from("leads")
  .select("id, primary_first_name, primary_last_name, company_name, linkedin_connected, current_channel")
  .eq("company_bio_id", bio.id)
  .eq("linkedin_connected", true);
console.log(`\nPathway leads with linkedin_connected=true: ${accepted?.length ?? 0}`);
for (const l of (accepted ?? []).slice(0, 15)) {
  console.log(`  ${l.id} — ${l.primary_first_name} ${l.primary_last_name} @ ${l.company_name}`);
}

if (!accepted?.length) process.exit(0);
const leadIds = accepted.map(l => l.id);

// For each, what step_number=1 rows exist? and what's queued_by?
const { data: msgs } = await supabase
  .from("campaign_messages")
  .select("id, lead_id, campaign_id, step_number, status, channel, sent_at, created_at, metadata")
  .in("lead_id", leadIds)
  .in("step_number", [0, 1, 2])
  .order("step_number", { ascending: true });

console.log(`\ncampaign_messages rows for those leads (step 0/1/2):`);
const byLead = {};
for (const m of msgs ?? []) {
  if (!byLead[m.lead_id]) byLead[m.lead_id] = [];
  byLead[m.lead_id].push(m);
}
for (const [lid, rows] of Object.entries(byLead)) {
  const lead = accepted.find(l => l.id === lid);
  console.log(`\n  ${lead.primary_first_name} ${lead.primary_last_name} @ ${lead.company_name}`);
  for (const m of rows) {
    const qb = m.metadata?.queued_by ?? "—";
    const accAt = m.metadata?.accepted_at ?? "—";
    console.log(`    step=${m.step_number} status=${m.status} channel=${m.channel} queued_by=${qb} accepted_at=${accAt} sent_at=${m.sent_at ?? "—"}`);
  }
}

// How many of them have at least one step_number=1 row with the expected queued_by marker?
const expected = new Set(["registro-nueva-conexion-webhook", "retroactive-fix-event-field-bug-2026-05-13"]);
let withMarker = 0, withoutMarker = 0;
for (const lid of leadIds) {
  const rows = byLead[lid] ?? [];
  const step1 = rows.find(r => r.step_number === 1);
  if (step1 && expected.has(step1.metadata?.queued_by)) withMarker++;
  else withoutMarker++;
}
console.log(`\nSummary: ${withMarker} with proper marker, ${withoutMarker} without.`);
console.log(`(The Queue page only surfaces the ones with the marker.)`);
