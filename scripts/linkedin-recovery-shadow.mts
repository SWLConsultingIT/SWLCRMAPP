// Historical shadow backfill for LinkedIn Recovery.
//
// Reproduces the CASE-1 DB_ELIGIBLE cohort and creates linkedin_recovery rows in
// SHADOW state (NEVER auto-acted) so the pilot can review historical candidates.
// It does NO Unipile calls and sends NOTHING. Idempotent (UNIQUE lead_id).
//
// Historical campaigns mostly have a NULL completed_at, so classifyCandidate
// already routes them to SHADOW; we additionally FORCE every backfilled row to
// SHADOW so nothing a backfill creates can ever auto-withdraw/reinvite.
//
// Usage (prod creds passed explicitly — .env.local points at LOCAL supabase):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=<key> \
//     npx tsx scripts/linkedin-recovery-shadow.mts --dry-run
//   ...same with --execute to actually insert (needs explicit go).
//   Optional: --limit=500  --tenant=<company_bio_id>[,<id>...]
//
// Default is --dry-run. NEVER run against prod without explicit authorization.

import { createClient } from "@supabase/supabase-js";
import { discoverCandidates, buildRecoveryRow } from "../lib/linkedin-recovery-discovery.ts";
import { RECOVERY_STATES } from "../lib/linkedin-recovery.ts";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const dryRun = !execute; // default
const limitArg = args.find((a) => a.startsWith("--limit="));
const tenantArg = args.find((a) => a.startsWith("--tenant="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 1000;
const tenants = tenantArg ? tenantArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : null;

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env (pass prod creds explicitly).");
  process.exit(1);
}

async function main() {
  const svc = createClient(URL!, KEY!, { auth: { persistSession: false } });
  console.log(`LinkedIn Recovery shadow backfill — ${dryRun ? "DRY RUN" : "EXECUTE"} · limit=${limit}${tenants ? ` · tenants=${tenants.join(",")}` : ""}`);

  const candidates = await discoverCandidates(svc as any, { companyBioIds: tenants, limit });
  const enrollable = candidates.filter((c) => c.decision.enroll);

  // Breakdown for the readout.
  const byReason: Record<string, number> = {};
  const byTenant: Record<string, number> = {};
  for (const c of candidates) {
    byReason[c.decision.enroll ? c.decision.reason : `skip:${(c.decision as any).reason}`] =
      (byReason[c.decision.enroll ? c.decision.reason : `skip:${(c.decision as any).reason}`] ?? 0) + 1;
    if (c.decision.enroll) byTenant[c.companyBioId ?? "(none)"] = (byTenant[c.companyBioId ?? "(none)"] ?? 0) + 1;
  }

  console.log(`\nCandidates scanned: ${candidates.length}`);
  console.log(`Enrollable (SHADOW): ${enrollable.length}`);
  console.log("By reason:", JSON.stringify(byReason, null, 2));
  console.log("Enrollable by tenant:", JSON.stringify(byTenant, null, 2));

  if (dryRun) {
    console.log("\nDRY RUN — no rows written. Re-run with --execute to insert SHADOW rows.");
    return;
  }

  // Force SHADOW on every backfilled row so a backfill can never auto-act.
  const rows = enrollable
    .map(buildRecoveryRow)
    .filter(Boolean)
    .map((r) => ({ ...(r as Record<string, unknown>), state: RECOVERY_STATES.SHADOW, eligible_withdraw_at: null }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { data, error } = await svc.from("linkedin_recovery").upsert(chunk, { onConflict: "lead_id", ignoreDuplicates: true }).select("id");
    if (error) { console.error("insert error:", error.message); process.exit(1); }
    inserted += data?.length ?? 0;
  }
  console.log(`\nInserted ${inserted} SHADOW rows (idempotent; existing leads skipped).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
