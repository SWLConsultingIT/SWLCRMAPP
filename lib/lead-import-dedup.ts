// Shared dedup + plan builder for the leads import wizard.
//
// Both /api/leads/import/dry-run and /api/leads/import/commit need the same
// answer to "given this CSV + mapping + tenant, what would happen?" — which
// rows are inserts, which patch an existing lead, which are duplicates of
// rows earlier in the same upload, which are dupes already in an active
// campaign (so they get left alone).
//
// Commit runs the plan + writes; dry-run runs the plan + returns the
// breakdown to the wizard's Confirm step so the operator sees ghosts of
// the writes before pressing Import.

import { applyMappingToRow, type LeadMappingResult } from "@/lib/lead-csv-mapper";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

export type ImportRowOutcome = {
  rowIndex: number; // 1-based for the operator UI
  status: "insert" | "update" | "skipped_duplicate" | "skipped_no_data";
  // Filled when the row resolved to an existing lead (update OR
  // skipped-duplicate because that lead is already in an active campaign).
  existingLeadId?: string | null;
  // Human reason — surfaced in the Confirm step preview + the per-row table.
  reason?: string;
  // Friendly identifier so the preview can render a row without re-mapping.
  display?: { name: string; company: string; linkedin?: string | null };
  // The mapped row (only set for insert/update outcomes so the caller can
  // write without re-mapping a second time).
  mapped?: Record<string, unknown>;
  patch?: Record<string, unknown>;
};

export type ImportPlan = {
  outcomes: ImportRowOutcome[];
  counts: {
    insert: number;
    update: number;
    skippedDuplicate: number;
    skippedNoData: number;
  };
};

type ExistingLead = {
  id: string;
  source?: string | null;
  encrypted_payload?: unknown;
  primary_linkedin_url: string | null;
  primary_work_email: string | null;
  primary_personal_email: string | null;
  primary_phone: string | null;
  primary_first_name: string | null;
  primary_last_name: string | null;
  company_name: string | null;
};

// Same supabase shape both routes use. Kept loose so we don't pull the
// supabase-js types into a library file. `order()` is part of the shape
// because the paginated pull below needs a deterministic sort key (see
// fetchAllPages).
type ListBuilder = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
};
type OrderableBuilder = ListBuilder & {
  order: (col: string, opts?: { ascending?: boolean }) => ListBuilder;
};
type Supa = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => OrderableBuilder;
      in: (col: string, vals: string[]) => OrderableBuilder;
    };
  };
};

// PostgREST enforces a HARD server-side row ceiling (`max_rows`, set to 1000
// on this project). A single `.range(0, 49_999)` does NOT lift it — the
// response comes back silently truncated at 1000, which is exactly what this
// file used to do while its comment claimed the opposite. Measured 2026-08-25:
// the dedup index saw 1000 of SWL's 1860 leads (46% invisible), 1000 of
// Pathway's 1976, 1000 of De Vera's 1260. Every lead outside that window
// re-imported as a brand-new duplicate.
//
// The rest of the codebase already paginates in 1000-row loops
// (lib/dashboard-data.ts → fetchAllRows). Do the same here.
const PAGE_SIZE = 1000;

// Runaway guard for the pagination loop. Well above any real tenant (largest
// today: Pathway at ~2k leads). If one ever legitimately exceeds this the
// import needs a different strategy anyway, and stopping beats looping.
const MAX_ROWS = 100_000;

// Pull every page of a query. `makeQuery` must build a FRESH builder on each
// call — supabase-js builders are single-use, so reusing one returns the first
// page over and over.
//
// Pagination without ORDER BY is unsound: Postgres may return rows in a
// different physical order per call, so page 2 can repeat or skip rows from
// page 1. Callers pass an explicit sort column.
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

async function fetchAllPages<T>(
  makeQuery: () => ListBuilder,
): Promise<{ rows: T[]; error: unknown }> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    // Surface the error instead of degrading to a partial index. A partial
    // index reads as "no duplicates found", which silently doubles a tenant's
    // leads — the caller has to fail the import, not guess.
    if (error) return { rows: out, error };
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

function normLI(url: string | null | undefined): string {
  if (!url) return "";
  const s = String(url).trim().toLowerCase();
  if (!s) return "";
  // Extract the canonical "/in/<slug>" or "/company/<slug>" segment.
  // Same person/company can appear under many URL forms:
  //   https://www.linkedin.com/in/jose-ventura/
  //   https://linkedin.com/in/jose-ventura?utm=x
  //   linkedin.com/in/jose-ventura/recent-activity/
  // …all dedupe to "in:jose-ventura" once we strip everything else.
  const m = s.match(/\/(in|company|pub|school)\/([^/?#]+)/);
  if (m) return `${m[1]}:${m[2]}`;
  // Fallback: strip protocol, www, query, hash, trailing slash.
  return s
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("?")[0]
    .split("#")[0]
    .replace(/\/+$/, "");
}
// A PERSONAL LinkedIn slug (/in/ or /pub/) identifies one human and is safe to
// dedupe on. A /company/ or /school/ URL identifies an ORG — scraped lists
// routinely drop the company page into every contact's linkedin field, so
// using it as a per-person key collapses all of a company's distinct people
// into one ("duplicate within this upload"). Return "" for those.
function personalLI(url: string | null | undefined): string {
  const n = normLI(url);
  return n.startsWith("in:") || n.startsWith("pub:") ? n : "";
}
// Two rows are the same person only if their names are equal (or one side has
// no name to compare). Lets distinct people who share a company mailbox / phone
// /switchboard through instead of merging them.
function namesCompatible(fn: string, ln: string, other: { primary_first_name: string | null; primary_last_name: string | null }): boolean {
  const a = normText(`${fn} ${ln}`);
  const b = normText(`${other.primary_first_name ?? ""} ${other.primary_last_name ?? ""}`);
  if (!a || !b) return true;
  return a === b;
}

// Phone is the ONLY key some rows carry: company records with a switchboard
// number and no person name at all (276 such leads in De Vera Grill —
// "Grupo Moura / (0230) 4539211"). For those, namesCompatible() waves
// everything through (it returns true whenever either side lacks a name), so a
// bare phone match merges two DIFFERENT companies that share a switchboard or
// a shared office. Measured 2026-08-25: De Vera holds 17 phone keys shared by
// distinct company names — e.g. "Poltur Argentina S.R.L" and "Polvani Tours"
// both on (11) 4322-9575.
//
// So: when there is no person name on either side, fall back to requiring the
// COMPANY to match. Cost is that "Plastic Omnium" and "Plastic Omnium Auto
// Inergy Argentina SA" stay two rows; benefit is we never silently patch one
// company's record onto another's — and never mark a live prospect as a
// duplicate of an unrelated company that happens to be mid-flow.
function phoneMatchAllowed(
  fn: string, ln: string, co: string, other: ExistingLead,
): boolean {
  if (!namesCompatible(fn, ln, other)) return false;
  const mine = normText(`${fn} ${ln}`);
  const theirs = normText(`${other.primary_first_name ?? ""} ${other.primary_last_name ?? ""}`);
  if (mine && theirs) return true; // real names, already proven equal above
  const otherCo = normCo(other.company_name);
  return !!co && !!otherCo && co === otherCo;
}
function normEmail(e: string | null | undefined): string {
  return e ? String(e).trim().toLowerCase() : "";
}
// Role / generic mailboxes shared by a whole company (info@, contacto@, …).
// Several DISTINCT people at one firm often list the same generic address, so
// using "email + company" as a dedup key collapses them into one and silently
// drops the rest ("duplicate within this upload"). When the local-part is
// generic we skip the email key and fall back to name+company, which keeps
// each real person. A genuinely personal address (j.perez@…) still dedups.
const GENERIC_EMAIL_LOCALPARTS = new Set<string>([
  "info", "contact", "contacto", "hello", "hola", "sales", "ventas", "admin",
  "office", "oficina", "mail", "email", "marketing", "hr", "rrhh", "soporte",
  "support", "ayuda", "help", "contacta", "comercial", "general", "team",
  "equipo", "no-reply", "noreply", "press", "prensa", "billing", "finanzas",
]);
function isGenericEmail(e: string): boolean {
  const local = e.split("@")[0]?.trim();
  return !!local && GENERIC_EMAIL_LOCALPARTS.has(local);
}
// Last 9 digits, matching `phoneKey` in lib/lead-csv-mapper.ts. It used to be
// the last 10, which silently broke every country whose national number is 9
// digits (Spain, France, Italy): "+34 600 11 22 33" → "34600112233" → last-10
// "4600112233" vs a locally-stored "600112233" → no match. Tenants routinely
// hold both formats at once (De Vera: 73 numbers with a "+" prefix, 723
// without), so the two spellings of one number have to fold together.
function normPhone(p: string | null | undefined): string {
  if (!p) return "";
  const digits = String(p).replace(/[^0-9]/g, "");
  if (digits.length < 7) return "";
  return digits.length > 9 ? digits.slice(-9) : digits;
}
// Normalize a free-form text field for fuzzy dedup keys. Strips
// diacritics so "José" == "Jose", and collapses any non-alphanumeric
// run to a single space so "Qbox  - Soluciones" == "Qbox - Soluciones".
function normText(t: string | null | undefined): string {
  if (!t) return "";
  // ̀-ͯ is the combining-diacritics block; stripping after
  // NFD turns "José" → "Jose" so dedup matches across encoding accidents.
  return String(t)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function normCo(c: string | null | undefined): string {
  return normText(c);
}

export function calcLeadScore(l: Record<string, unknown>): number {
  let s = 0;
  if (l.is_priority === true || l.is_priority === "TRUE") s = 100;
  if (l.primary_linkedin_url) s += 10;
  if (l.primary_work_email) s += 10;
  if (l.primary_phone) s += 5;
  if (l.company_name) s += 5;
  if (l.company_website) s += 5;
  ["allow_linkedin", "allow_email", "allow_whatsapp", "allow_sms", "allow_instagram", "allow_telegram"].forEach(f => {
    if (l[f] === true || l[f] === "TRUE") s += 3;
  });
  return s;
}

export async function buildImportPlan(input: {
  rows: Array<Record<string, string>>;
  mapping: LeadMappingResult;
  targetBioId: string;
  supabase: Supa;
}): Promise<ImportPlan> {
  const { rows, mapping, targetBioId, supabase } = input;

  // Pull EVERY lead in this tenant + every lead-id with an in-flight
  // campaign, paginated (see PAGE_SIZE — PostgREST caps each response at
  // 1000 rows no matter what Range asks for). Ordered by id so the pages
  // tile the set exactly once.
  //
  // We also pull source + encrypted_payload because client-source
  // leads keep their PII inside the ciphertext, not in plaintext
  // columns — without hydrating them the dedup keys (first/last name,
  // LinkedIn URL, email, phone, company) are all NULL and every
  // re-import duplicates them invisibly. Burned 2026-05-29.
  const [existingRes, activeCampRes] = await Promise.all([
    fetchAllPages<ExistingLead>(() =>
      supabase.from("leads")
        .select("id, source, encrypted_payload, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, primary_first_name, primary_last_name, company_name")
        .eq("company_bio_id", targetBioId)
        .order("id", { ascending: true })),
    fetchAllPages<{ lead_id: string | null }>(() =>
      supabase.from("campaigns")
        .select("lead_id")
        .in("status", ["active", "paused"])
        .order("id", { ascending: true })),
  ]);

  // Hard-fail on a broken read. Continuing with a partial (or empty) index
  // means the plan reports every row as "new" and the import doubles the
  // tenant's leads with no warning anywhere.
  if (existingRes.error) {
    throw new Error(
      `Dedup index could not be loaded (existing leads query failed): ${errMessage(existingRes.error)}. Import aborted so no duplicates are created.`,
    );
  }
  if (activeCampRes.error) {
    throw new Error(
      `Dedup index could not be loaded (active campaigns query failed): ${errMessage(activeCampRes.error)}. Import aborted so leads mid-campaign are not touched.`,
    );
  }

  const existingRaw = existingRes.rows;

  // Hydrate client-source rows by decrypting their payload into the
  // plaintext column slots so the dedup lookup keys (LI slug, email,
  // phone, name+company) actually have something to match.
  const needsDecrypt = existingRaw.some(l => l.source === "client" && l.encrypted_payload);
  let existing = existingRaw;
  if (needsDecrypt) {
    try {
      const { key } = await resolveTenantKey(targetBioId);
      existing = existingRaw.map(l => {
        if (l.source !== "client" || !l.encrypted_payload) return l;
        try {
          const blob = bufferFromSupabaseBytea(l.encrypted_payload);
          const decrypted = decryptWithResolvedKey(blob, key) as Record<string, unknown>;
          return {
            ...l,
            primary_linkedin_url:  (decrypted.primary_linkedin_url  as string | null) ?? l.primary_linkedin_url,
            primary_work_email:    (decrypted.primary_work_email    as string | null) ?? l.primary_work_email,
            primary_personal_email:(decrypted.primary_personal_email as string | null) ?? l.primary_personal_email,
            primary_phone:         (decrypted.primary_phone         as string | null) ?? l.primary_phone,
            primary_first_name:    (decrypted.primary_first_name    as string | null) ?? l.primary_first_name,
            primary_last_name:     (decrypted.primary_last_name     as string | null) ?? l.primary_last_name,
            company_name:          (decrypted.company_name          as string | null) ?? l.company_name,
          };
        } catch (err) {
          // Decrypt failures are common when the tenant key rotated or
          // a row got corrupted on insert (bytea-as-JSON bug). Skip the
          // row — better to miss one dedup match than crash the wizard.
          console.warn(`[lead-import-dedup] decrypt failed for lead ${l.id}: ${err instanceof Error ? err.message : String(err)}`);
          return l;
        }
      });
    } catch (err) {
      console.warn(`[lead-import-dedup] tenant key unavailable, dedup will skip encrypted leads: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const activeLeadIds = new Set(
    activeCampRes.rows
      .map(r => r.lead_id)
      .filter((id): id is string => Boolean(id)),
  );

  // Index lookup so each CSV row resolves in O(1).
  const byLI = new Map<string, ExistingLead>();
  const byWE = new Map<string, ExistingLead>();
  const byPE = new Map<string, ExistingLead>();
  const byPh = new Map<string, ExistingLead>();
  const byNameCo = new Map<string, ExistingLead>();
  for (const l of existing) {
    const li = personalLI(l.primary_linkedin_url);
    const we = normEmail(l.primary_work_email);
    const pe = normEmail(l.primary_personal_email);
    const ph = normPhone(l.primary_phone);
    if (li) byLI.set(li, l);
    if (we) byWE.set(we, l);
    if (pe) byPE.set(pe, l);
    if (ph) byPh.set(ph, l);
    const fn = normText(l.primary_first_name);
    const ln = normText(l.primary_last_name);
    const co = normCo(l.company_name);
    if (fn && ln && co) byNameCo.set(`${fn}|${ln}|${co}`, l);
  }

  // Intra-batch dedup. A row is a duplicate of an EARLIER row only if it's
  // plausibly the SAME PERSON: same personal LinkedIn slug, same name+company,
  // or same email WITH the same name. Email/phone alone are NOT used as person
  // keys — scraped lists put one company email/switchboard on every contact, so
  // keying on email+company collapsed distinct people ("duplicate within this
  // upload"). Names are folded into the email key so a shared company mailbox
  // no longer merges different people. (Fix 2026-06-17.)
  const seen = new Set<string>();

  const outcomes: ImportRowOutcome[] = [];

  for (let i = 0; i < rows.length; i++) {
    const csvRow = rows[i];
    const rowIndex = i + 1;
    const mapped = applyMappingToRow(csvRow, mapping);

    // Scraped lists routinely carry BOTH a "Person Linkedin Url" (/in/…) and a
    // "Company Linkedin Url" (/company/…), and a mapping slip can land the
    // company page in primary_linkedin_url. That (a) isn't the person's profile
    // and (b) trips the (primary_linkedin_url, company) unique index the moment
    // a 2nd person at the same firm carries the same company URL — exactly what
    // errored 16/25 rows. If primary holds a company/school page, move it to
    // company_linkedin and RECOVER the person's real /in/ profile from any
    // other column in the raw row (so we keep the personal LinkedIn instead of
    // nulling it). Mapping-independent safety net.
    {
      const rawLI = String(mapped.primary_linkedin_url ?? "").trim();
      const n = rawLI ? normLI(rawLI) : "";
      if (n.startsWith("company:") || n.startsWith("school:")) {
        if (!mapped.company_linkedin) mapped.company_linkedin = rawLI;
        let personal: string | null = null;
        for (const v of Object.values(csvRow)) {
          const s = String(v ?? "").trim();
          if (!s) continue;
          const ns = normLI(s);
          if (ns.startsWith("in:") || ns.startsWith("pub:")) { personal = s; break; }
        }
        mapped.primary_linkedin_url = personal; // recovered /in/ profile, or null
      }
    }

    const hasName = mapped.primary_first_name || mapped.primary_last_name;
    const hasContact = mapped.primary_work_email || mapped.primary_personal_email || mapped.primary_phone || mapped.primary_linkedin_url;

    const display = {
      name: `${mapped.primary_first_name ?? ""} ${mapped.primary_last_name ?? ""}`.trim() || "(unnamed)",
      company: (mapped.company_name as string | null) ?? "(no company)",
      linkedin: (mapped.primary_linkedin_url as string | null) ?? null,
    };

    if (!hasName && !hasContact) {
      outcomes.push({ rowIndex, status: "skipped_no_data", reason: "no name or contact info", display });
      continue;
    }

    const li = personalLI(mapped.primary_linkedin_url as string | null);
    const we = normEmail(mapped.primary_work_email as string | null);
    const pe = normEmail(mapped.primary_personal_email as string | null);
    const ph = normPhone(mapped.primary_phone as string | null);
    const co = normCo(mapped.company_name as string | null);
    // normText (not raw toLowerCase) so this side of the comparison is built
    // exactly like the byNameCo index above. They used to disagree: the index
    // stripped diacritics and collapsed punctuation, this side didn't — so
    // "José" never matched "jose" and "Manzano-Monis" never matched
    // "manzano monis". Spanish/Italian/LATAM lists are most of what we import,
    // so that asymmetry disabled name matching for the majority of accented
    // names (70 such leads in SWL, 48 in De Vera, 17 in IEB as of 2026-08-25).
    const fn = normText(mapped.primary_first_name as string | null);
    const ln = normText(mapped.primary_last_name as string | null);

    // Person keys. nameSig folds the person's name into the email key so two
    // different people sharing a company email don't collapse; falls back to
    // company when there's no name. Personal LinkedIn slug is unique to a human
    // so it stands alone.
    //
    // nameCoKey is the raw index key (must match how byNameCo was built);
    // nKey is its namespaced form for the intra-batch `seen` set. Keeping them
    // as two variables is deliberate: they were previously the same variable
    // carrying the "n:" prefix, which was then looked up against the
    // un-prefixed index — so `byNameCo.has(nKey)` was ALWAYS false and the
    // "name + company" branch below was unreachable dead code. That was the
    // only possible key for the 344 leads in prod that have neither LinkedIn
    // nor email, making them permanently un-dedupable.
    const nameSig = fn && ln ? `${fn}|${ln}` : "";
    const wKey  = we && !isGenericEmail(we) ? `e:${we}|${nameSig || co}` : null;
    const peKey = pe && !isGenericEmail(pe) ? `e:${pe}|${nameSig || co}` : null;
    const liKey = li ? `li:${li}` : null;
    const nameCoKey = fn && ln && co ? `${fn}|${ln}|${co}` : null;
    const nKey  = nameCoKey ? `n:${nameCoKey}` : null;

    if ((wKey && seen.has(wKey)) || (peKey && seen.has(peKey)) || (liKey && seen.has(liKey)) || (nKey && seen.has(nKey))) {
      outcomes.push({ rowIndex, status: "skipped_duplicate", reason: "duplicate within this upload", display });
      continue;
    }

    // DB match: same person already in this tenant. Email/phone matches also
    // require a compatible name so a shared company contact point doesn't merge
    // a new person onto an existing different one.
    let dbMatch: ExistingLead | null = null;
    let matchedBy = "";
    if (li && byLI.has(li))      { dbMatch = byLI.get(li)!;      matchedBy = "LinkedIn URL"; }
    else if (we && !isGenericEmail(we) && byWE.has(we) && namesCompatible(fn, ln, byWE.get(we)!)) { dbMatch = byWE.get(we)!; matchedBy = "work email"; }
    else if (pe && !isGenericEmail(pe) && byPE.has(pe) && namesCompatible(fn, ln, byPE.get(pe)!)) { dbMatch = byPE.get(pe)!; matchedBy = "personal email"; }
    else if (ph && byPh.has(ph) && phoneMatchAllowed(fn, ln, co, byPh.get(ph)!)) { dbMatch = byPh.get(ph)!; matchedBy = "phone"; }
    else if (nameCoKey && byNameCo.has(nameCoKey)) { dbMatch = byNameCo.get(nameCoKey)!; matchedBy = "name + company"; }

    if (dbMatch && activeLeadIds.has(dbMatch.id)) {
      outcomes.push({
        rowIndex,
        status: "skipped_duplicate",
        existingLeadId: dbMatch.id,
        reason: `already in DB (matched by ${matchedBy}) and in an active campaign — left untouched`,
        display,
      });
      continue;
    }

    if (wKey) seen.add(wKey);
    if (peKey) seen.add(peKey);
    if (liKey) seen.add(liKey);
    if (nKey) seen.add(nKey);

    const score = calcLeadScore(mapped as Record<string, unknown>);

    if (dbMatch) {
      // Existing lead, no active campaign → fill missing fields only.
      const patch: Record<string, unknown> = { lead_score: score, updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(mapped)) {
        if (v == null || v === "") continue;
        if ((dbMatch as Record<string, unknown>)[k] == null || (dbMatch as Record<string, unknown>)[k] === "") {
          patch[k] = v;
        }
      }
      outcomes.push({
        rowIndex,
        status: "update",
        existingLeadId: dbMatch.id,
        reason: `existing lead (matched by ${matchedBy}); missing fields will be filled`,
        display,
        mapped,
        patch,
      });
    } else {
      outcomes.push({
        rowIndex,
        status: "insert",
        reason: "new lead",
        display,
        mapped,
      });
    }
  }

  const counts = {
    insert: outcomes.filter(o => o.status === "insert").length,
    update: outcomes.filter(o => o.status === "update").length,
    skippedDuplicate: outcomes.filter(o => o.status === "skipped_duplicate").length,
    skippedNoData: outcomes.filter(o => o.status === "skipped_no_data").length,
  };

  return { outcomes, counts };
}
