#!/usr/bin/env node
// Find + delete duplicate leads in De Vera Grill (tenant aef0e3b3…).
//
// "Duplicate" = same lead identity matched by one of:
//   - LinkedIn slug (the /in/<slug> segment of primary_linkedin_url)
//   - work email + company
//   - personal email + company
//   - phone (last 10 digits)
//   - normalized first + last name + company
//
// Of each duplicate group we keep the lead with an active campaign
// (boss rule "borra las duplicadas que estan sin campaign"). If
// multiple have campaigns or none do, we keep the oldest one (id sort).
//
// Two modes:
//   node dedup-devera-grill.mjs          # dry-run, prints groups
//   node dedup-devera-grill.mjs --apply  # actually deletes

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

// Resolve the tenant by company_name so we don't hard-code the UUID.
async function resolveDeVeraBioId() {
  const { data, error } = await svc
    .from("company_bios")
    .select("id, company_name")
    .ilike("company_name", "%de vera%");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("De Vera Grill tenant not found in company_bios");
  }
  if (data.length > 1) {
    console.error("Multiple matches for 'De Vera':", data);
    throw new Error("Ambiguous tenant — narrow the ilike");
  }
  console.log(`Resolved tenant: ${data[0].company_name} → ${data[0].id}`);
  return data[0].id;
}

// ── Normalization helpers (same as lib/lead-import-dedup.ts) ──
function normLI(url) {
  if (!url) return "";
  const s = String(url).trim().toLowerCase();
  if (!s) return "";
  // Only accept real LinkedIn URLs — older imports stored AI-generated
  // strings ("Response", summaries…) in primary_linkedin_url when a
  // column was mis-mapped, and a permissive fallback turned 7 unrelated
  // leads into a fake "duplicate group". Require linkedin.com in the
  // string, then extract the canonical /in|company|pub|school/<slug>.
  if (!s.includes("linkedin.com")) return "";
  const m = s.match(/\/(in|company|pub|school)\/([^/?#]+)/);
  if (m) return `${m[1]}:${m[2]}`;
  return "";
}
function normEmail(e) {
  return e ? String(e).trim().toLowerCase() : "";
}
function normPhone(p) {
  if (!p) return "";
  const digits = String(p).replace(/[^0-9]/g, "");
  if (digits.length < 7) return "";
  return digits.slice(-10);
}
function normText(t) {
  if (!t) return "";
  return String(t)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function fetchAllLeads(DEVERA_BIO_ID) {
  // Paginate so we don't get clipped at PostgREST's default 1000.
  const all = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await svc
      .from("leads")
      .select("id, primary_first_name, primary_last_name, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, company_name, created_at")
      .eq("company_bio_id", DEVERA_BIO_ID)
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return all;
}

async function fetchActiveCampLeadIds(DEVERA_BIO_ID) {
  // Tenant scope via leads!inner so we only see this tenant's campaigns.
  const { data, error } = await svc
    .from("campaigns")
    .select("lead_id, status, leads!inner(company_bio_id)")
    .eq("leads.company_bio_id", DEVERA_BIO_ID)
    .in("status", ["active", "paused", "completed"])
    .range(0, 49999);
  if (error) throw error;
  return new Set((data ?? []).map(r => r.lead_id).filter(Boolean));
}

function fingerprintsOf(l) {
  // Return EVERY identity key the lead has — same person can appear
  // with 2 different LinkedIn slugs but the same work email + company,
  // or with the same name + company but different phones, so we
  // index under all of them and let union-find merge groups.
  const keys = [];
  const li = normLI(l.primary_linkedin_url);
  if (li) keys.push(`LI:${li}`);
  const co = normText(l.company_name);
  const we = normEmail(l.primary_work_email);
  if (we && co) keys.push(`WE:${we}|${co}`);
  const pe = normEmail(l.primary_personal_email);
  if (pe && co) keys.push(`PE:${pe}|${co}`);
  const ph = normPhone(l.primary_phone);
  if (ph) keys.push(`PH:${ph}`);
  const fn = normText(l.primary_first_name);
  const ln = normText(l.primary_last_name);
  if (fn && ln && co) keys.push(`NM:${fn}|${ln}|${co}`);
  return keys;
}

// ── Disjoint-set / union-find over lead ids ──────────────────────────
class DSU {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) { this.parent.set(x, x); return x; }
    let p = this.parent.get(x);
    while (p !== this.parent.get(p)) p = this.parent.get(p);
    this.parent.set(x, p);
    return p;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function main() {
  const DEVERA_BIO_ID = await resolveDeVeraBioId();
  console.log(`Mode: ${apply ? "APPLY (will DELETE)" : "DRY-RUN (no changes)"}`);
  console.log("");

  const [leads, hasCampaign] = await Promise.all([
    fetchAllLeads(DEVERA_BIO_ID),
    fetchActiveCampLeadIds(DEVERA_BIO_ID),
  ]);
  console.log(`Loaded ${leads.length} leads, ${hasCampaign.size} have a campaign row.`);

  // Build union-find: for each key, every lead carrying that key joins
  // the same equivalence class. A lead with 2 LinkedIn slugs but the
  // same name+company gets merged with its other copy.
  const dsu = new DSU();
  const keyToLeads = new Map(); // key → [leadId, ...]
  const leadById = new Map(leads.map(l => [l.id, l]));
  let noKeys = 0;

  for (const l of leads) {
    const keys = fingerprintsOf(l);
    if (keys.length === 0) { noKeys++; continue; }
    dsu.find(l.id); // ensure node exists
    for (const k of keys) {
      const arr = keyToLeads.get(k) ?? [];
      arr.push(l.id);
      keyToLeads.set(k, arr);
    }
  }
  // Union every lead pair that shares any key.
  for (const [, ids] of keyToLeads) {
    for (let i = 1; i < ids.length; i++) dsu.union(ids[0], ids[i]);
  }
  console.log(`Skipped ${noKeys} leads with no usable identity (no name/email/li/phone/company).`);

  // Group leads by DSU root.
  const groups = new Map();
  for (const l of leads) {
    if (!dsu.parent.has(l.id)) continue;
    const root = dsu.find(l.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(l);
  }
  void leadById;

  // Filter to groups of size > 1
  const dupGroups = [...groups.entries()].filter(([, ls]) => ls.length > 1);
  console.log(`Found ${dupGroups.length} duplicate groups covering ${dupGroups.reduce((a, [, ls]) => a + ls.length, 0)} leads.`);
  console.log("");

  // For each group, decide what to keep + what to delete
  const toDelete = [];
  for (const [root, ls] of dupGroups) {
    // Sort: kept first. Prefer leads WITH campaign, then oldest by created_at.
    const sorted = [...ls].sort((a, b) => {
      const aHas = hasCampaign.has(a.id) ? 0 : 1;
      const bHas = hasCampaign.has(b.id) ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
    const keep = sorted[0];
    const drop = sorted.slice(1).filter(l => !hasCampaign.has(l.id));
    // If ALL duplicates have campaigns, drop is empty — never touch a
    // lead that's in a flow.
    if (drop.length === 0) continue;
    console.log(`[group ${root.slice(0, 8)}]`);
    console.log(`  KEEP   ${keep.id}  ${keep.primary_first_name ?? "?"} ${keep.primary_last_name ?? "?"} · ${keep.company_name ?? "?"} · ${hasCampaign.has(keep.id) ? "✓ campaign" : "no campaign"}`);
    for (const d of drop) {
      console.log(`  DELETE ${d.id}  ${d.primary_first_name ?? "?"} ${d.primary_last_name ?? "?"} · ${d.company_name ?? "?"}`);
      toDelete.push(d.id);
    }
  }

  console.log("");
  console.log(`Total to delete: ${toDelete.length} lead(s).`);

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to actually delete.");
    return;
  }
  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  // Delete in chunks of 100 so we don't hit URL length limits.
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const slice = toDelete.slice(i, i + 100);
    const { error } = await svc.from("leads").delete().in("id", slice);
    if (error) {
      console.error(`Chunk ${i} delete failed:`, error.message);
      continue;
    }
    deleted += slice.length;
    console.log(`  deleted ${deleted}/${toDelete.length}`);
  }
  console.log(`Done. Deleted ${deleted} duplicate lead(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
