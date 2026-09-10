#!/usr/bin/env node
// Backfill `metadata.queued_by` + `metadata.accepted_at` markers on every
// step_number=1 campaign_messages row whose lead has `linkedin_connected=true`
// but is missing the marker the /queue page needs to surface synthetic
// "Accepted Connection" entries.
//
// Why we need this: the webhook BESFOHaqTt2Ki0Vw only writes the marker
// when step 1 is still in `draft`/`queued`. If the dispatcher already sent
// step 1 by the time the accept fires (slow webhook, cron beat the human),
// the marker never lands and the engagement vanishes from the inbox.
//
// 2026-05-28 audit: 9 SWL PE Spain leads + 1 Pathway lead were in this
// state. Re-runnable — idempotent (only writes when marker missing).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => {
      const idx = l.indexOf("="); return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const DRY_RUN = process.argv.includes("--apply") === false;
const EXPECTED = new Set(["registro-nueva-conexion-webhook", "retroactive-fix-event-field-bug-2026-05-13"]);
const NEW_MARKER = "retroactive-backfill-2026-05-28";

const { data: leads } = await supabase.from("leads")
  .select("id, primary_first_name, primary_last_name, company_name, company_bio_id")
  .eq("linkedin_connected", true);
console.log(`Leads with linkedin_connected=true: ${leads.length}`);

const leadIds = leads.map(l => l.id);
const { data: step1s } = await supabase.from("campaign_messages")
  .select("id, lead_id, status, metadata, sent_at")
  .in("lead_id", leadIds)
  .eq("step_number", 1);

// Also pull step 0 sent_at to derive a plausible accepted_at when not set.
const { data: step0s } = await supabase.from("campaign_messages")
  .select("lead_id, sent_at")
  .in("lead_id", leadIds)
  .eq("step_number", 0)
  .eq("status", "sent");
const step0SentByLead = {};
for (const m of step0s ?? []) {
  if (!step0SentByLead[m.lead_id] || new Date(m.sent_at) > new Date(step0SentByLead[m.lead_id])) {
    step0SentByLead[m.lead_id] = m.sent_at;
  }
}

const toFix = [];
for (const m of step1s ?? []) {
  const qb = m.metadata?.queued_by;
  if (EXPECTED.has(qb)) continue; // already has marker
  toFix.push(m);
}
console.log(`Need backfill: ${toFix.length} step_number=1 rows.`);
if (DRY_RUN) {
  console.log("\n(dry-run — pass --apply to write)\n");
  for (const m of toFix.slice(0, 20)) {
    const lead = leads.find(l => l.id === m.lead_id);
    console.log(`  ${lead?.primary_first_name ?? "?"} ${lead?.primary_last_name ?? "?"} @ ${lead?.company_name ?? "?"} — current qb=${m.metadata?.queued_by ?? "-"}`);
  }
  process.exit(0);
}

let updated = 0, failed = 0;
for (const m of toFix) {
  const inferredAccept = step0SentByLead[m.lead_id]
    ? new Date(new Date(step0SentByLead[m.lead_id]).getTime() + 4 * 3600 * 1000).toISOString()
    : new Date().toISOString();
  const merged = {
    ...(m.metadata ?? {}),
    queued_by: NEW_MARKER,
    accepted_at: m.metadata?.accepted_at ?? inferredAccept,
    backfill_reason: "linkedin_connected=true but step-1 marker missing — webhook missed the window because dispatcher had already sent step 1",
  };
  const { error } = await supabase.from("campaign_messages").update({ metadata: merged }).eq("id", m.id);
  if (error) { failed++; console.error("  FAILED", m.id, error.message); }
  else updated++;
}
console.log(`Updated ${updated}, failed ${failed}.`);
