// One-off onboarding import: Framis Italia — "South and Central Italy Leads" (20 rows).
//
// Reuses the PRODUCTION import pipeline rather than hand-writing INSERTs:
//   parseUploadedSheet  → lib/csv-xlsx-parser.ts   (same parser the wizard uses)
//   heuristicLeadMapping→ lib/lead-csv-mapper.ts   (the no-OpenAI fallback the
//                                                   /api/leads/import route falls
//                                                   back to when no key is set)
//   applyMappingToRow   → lib/lead-csv-mapper.ts   (called inside buildImportPlan)
//   buildImportPlan     → lib/lead-import-dedup.ts (dedup, tenant-scoped)
// and then writes rows with the EXACT shape of app/api/leads/import/commit/route.ts
// for the super_admin / encrypt=false branch (source='swl', plaintext).
//
// Seller exclusions are matched on DOMAIN (website host + email host + company
// LinkedIn slug), not on display text, so "Leo" / "Another Leo France contact"
// resolve deterministically to the two leofrance.it rows.
//
// Run:  npx tsx scripts/import-framis-leads-2026-09-14.mts [--commit]
//       (default is a dry run that writes nothing)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseUploadedSheet } from "../lib/csv-xlsx-parser.ts";
import { heuristicLeadMapping } from "../lib/lead-csv-mapper.ts";
import { buildImportPlan } from "../lib/lead-import-dedup.ts";

const CSV_PATH = process.env.FRAMIS_CSV
  ?? `${process.env.HOME}/Downloads/South and Central Italy Leads - 20 Leads.csv`;
const BIO_ID = "942337a7-84a5-4d3a-8196-0f194ee5496a";   // Framis Italia
const ICP_ID = "9f7312ad-a75e-42ea-898a-7b6e64885ec4";   // South & Central Italy ICP
const COMMIT = process.argv.includes("--commit");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://uljoengwmmwdqpcxnbjs.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_KEY not set"); process.exit(1); }

// ── Seller exclusion list ────────────────────────────────────────────────
// "We cancel these prospects - they are not relevant to what we were looking for."
// Keyed by registrable domain so website / work-email / LinkedIn all agree.
const EXCLUDED = [
  { label: "Giovanni Raspini",            domains: ["giovanniraspini.com"] },
  { label: "UNOPIU'",                     domains: ["unopiu.com", "unopiu.it"] },
  { label: "Poltrona Frau",               domains: ["poltronafrau.com", "poltronafrau.it"] },
  { label: "Panatta",                     domains: ["panattasport.com", "panattasport.it"] },
  { label: "Benelli Armi",                domains: ["benelli.it"] },
  { label: "LEO FRANCE",                  domains: ["leofrance.com", "leofrance.it"] },
  { label: "Cariaggi Lanificio",          domains: ["cariaggi.it"] },
  { label: "Microtex Composites",         domains: ["microtexcomposites.com"] },
  { label: "IL BISONTE",                  domains: ["ilbisonte.com", "ilbisonte.net"] },
];
// The seller named LEO FRANCE twice ("Leo" + "Another Leo France contact"),
// so that one domain is expected to knock out two rows; everything else is 1:1.
const EXPECTED_EXCLUDED_ROWS = 10;
const EXPECTED_KEPT_ROWS = 10;

function host(v: string | undefined): string {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return "";
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?([^/?#\s]+)/);
  return m ? m[1] : "";
}
function emailHost(v: string | undefined): string {
  const s = (v ?? "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  return at === -1 ? "" : s.slice(at + 1);
}
function matchesDomain(hay: string, domain: string): boolean {
  return hay === domain || hay.endsWith("." + domain);
}

// ── 1. Parse ─────────────────────────────────────────────────────────────
const buf = readFileSync(CSV_PATH);
const sheet = parseUploadedSheet(buf, CSV_PATH.split("/").pop()!);
console.log(`CSV: ${CSV_PATH}`);
console.log(`Rows: ${sheet.totalRows}  Columns: ${sheet.headers.length}\n`);

// ── 2. Split kept vs excluded on multiple identifier fields ──────────────
type Tagged = { idx: number; row: Record<string, string>; excludedBy: string | null };
const tagged: Tagged[] = sheet.rows.map((row, i) => {
  const ids = [
    host(row["Website"]),
    host(row["Company Linkedin Url"]),
    emailHost(row["Email"]),
  ].filter(Boolean);
  const liSlug = (row["Company Linkedin Url"] ?? "").toLowerCase();
  let hit: string | null = null;
  for (const e of EXCLUDED) {
    const byDomain = e.domains.some(d => ids.some(h => matchesDomain(h, d)));
    // LinkedIn company slug as a secondary identifier (e.g. /company/unopiu').
    const bySlug = e.domains.some(d => liSlug.includes("/company/" + d.split(".")[0]));
    if (byDomain || bySlug) { hit = e.label; break; }
  }
  return { idx: i + 1, row, excludedBy: hit };
});

const excluded = tagged.filter(t => t.excludedBy);
const kept = tagged.filter(t => !t.excludedBy);

console.log(`── EXCLUDED (${excluded.length}) ──`);
for (const t of excluded) {
  console.log(`  row ${String(t.idx).padStart(2)} | ${t.row["First Name"]} ${t.row["Last Name"]} | ${t.row["Company Name"]} | ${t.row["Email"]}  → ${t.excludedBy}`);
}
console.log(`\n── KEEP (${kept.length}) ──`);
for (const t of kept) {
  console.log(`  row ${String(t.idx).padStart(2)} | ${t.row["First Name"]} ${t.row["Last Name"]} | ${t.row["Company Name"]} | ${t.row["Title"]} | emp=${t.row["# Employees"]} | ${t.row["Company State"]}`);
}

// Fail closed: if the exclusion matcher drifts, do not write anything.
if (excluded.length !== EXPECTED_EXCLUDED_ROWS || kept.length !== EXPECTED_KEPT_ROWS) {
  console.error(`\nABORT: expected ${EXPECTED_EXCLUDED_ROWS} excluded / ${EXPECTED_KEPT_ROWS} kept, got ${excluded.length}/${kept.length}.`);
  process.exit(1);
}
const unmatched = EXCLUDED.filter(e => !excluded.some(t => t.excludedBy === e.label));
if (unmatched.length) {
  console.error(`\nABORT: exclusion entries matched nothing: ${unmatched.map(e => e.label).join(", ")}`);
  process.exit(1);
}

// ── 3. Map with the production mapper ────────────────────────────────────
const mapping = heuristicLeadMapping({
  fileName: CSV_PATH.split("/").pop()!,
  sourceHeaders: sheet.headers,
  sampleRows: sheet.rows.slice(0, 5),
});

// Step-2 operator corrections. The import wizard shows the inferred mapping and
// lets the operator fix it before committing; these are the fixes a human would
// make on this Apollo export, applied here so the run is reproducible:
//   - "Corporate Phone" is a real company line — the heuristic has no rule for
//     that exact wording and dumps it in enrichment. Send it to company_phone so
//     the phone-consolidation path picks it up.
//   - Apollo ships BOTH the person's location (Address/City/State/Country) and
//     the company's (Company Address/City/State/Country). The heuristic points
//     both at the company_* columns, so the winner is decided by header order.
//     Pin the company columns to the company's own values and keep the contact's
//     location as enrichment instead of letting it silently overwrite them.
const MAPPING_OVERRIDES: Record<string, string> = {
  "Corporate Phone": "company_phone",
  "Address": "_extra:Contact Address",
  "City": "_extra:Contact City",
  "State": "_extra:Contact State",
  "Country": "_extra:Contact Country",
  "Company Address": "company_address_1",
};
for (const m of mapping.mappings) {
  const ov = MAPPING_OVERRIDES[m.source];
  if (ov) m.target = ov;
}

console.log(`\n── MAPPING (source_tool=${mapping.source_tool}) ──`);
for (const m of mapping.mappings) {
  const ov = MAPPING_OVERRIDES[m.source] ? "  (operator override)" : "";
  console.log(`  ${m.source}  →  ${m.target}${ov}`);
}

// ── 4. Dedup plan against the tenant (production code path) ──────────────
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const keptRows = kept.map(t => t.row);
const plan = await buildImportPlan({
  rows: keptRows,
  mapping,
  targetBioId: BIO_ID,
  supabase: svc as unknown as Parameters<typeof buildImportPlan>[0]["supabase"],
});
console.log(`\n── DEDUP PLAN ── insert=${plan.counts.insert} update=${plan.counts.update} dupe=${plan.counts.skippedDuplicate} nodata=${plan.counts.skippedNoData}`);
for (const o of plan.outcomes) {
  if (o.status !== "insert") console.log(`  ! row ${o.rowIndex} ${o.status}: ${o.reason ?? ""}`);
}

// ── 5. Build insert rows exactly like commit/route.ts (swl, unencrypted) ─
const toInsert = plan.outcomes
  .filter(o => o.status === "insert" && o.mapped)
  .map(o => ({
    ...o.mapped!,
    allow_linkedin: (o.mapped as Record<string, unknown>).allow_linkedin ?? true,
    allow_email:    (o.mapped as Record<string, unknown>).allow_email    ?? true,
    allow_call:     (o.mapped as Record<string, unknown>).allow_call     ?? true,
    allow_whatsapp: (o.mapped as Record<string, unknown>).allow_whatsapp ?? true,
    allow_sms:      (o.mapped as Record<string, unknown>).allow_sms      ?? true,
    source: "swl",
    company_bio_id: BIO_ID,
    icp_profile_id: ICP_ID,
    sync_status: "synced",
  }));

console.log(`\nRows ready to insert: ${toInsert.length}`);
console.log("Sample row:", JSON.stringify(toInsert[0], null, 2).slice(0, 1400));

if (!COMMIT) {
  console.log("\nDRY RUN — nothing written. Re-run with --commit to write.");
  process.exit(0);
}

// Guard: never double-import.
const { count: already } = await svc.from("leads").select("id", { count: "exact", head: true }).eq("company_bio_id", BIO_ID);
if ((already ?? 0) > 0) {
  console.error(`ABORT: tenant already has ${already} leads. Refusing to re-import.`);
  process.exit(1);
}

const { data, error } = await svc.from("leads").insert(toInsert).select("id, primary_first_name, primary_last_name, company_name");
if (error) { console.error("INSERT FAILED:", error); process.exit(1); }
console.log(`\n✓ Inserted ${data!.length} leads:`);
for (const r of data!) console.log(`  ${r.id} | ${r.primary_first_name} ${r.primary_last_name} | ${r.company_name}`);
