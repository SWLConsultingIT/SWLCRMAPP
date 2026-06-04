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
// supabase-js types into a library file. range() is mandatory because
// PostgREST defaults to a 1000-row page — without it the dedup index
// silently misses everything past lead #1001.
type ListBuilder = {
  range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: unknown }>;
};
type Supa = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => ListBuilder;
      in: (col: string, vals: string[]) => ListBuilder;
    };
  };
};

// Pull cap. 50k mirrors the wizard's row cap — any tenant past this point
// should paginate, but we're nowhere near that yet (Pathway = 627 leads,
// De Vera Grill ≈ 100s, biggest pilot under 5k). If you bump the wizard
// cap, bump this too.
const PAGE_CAP = 49_999;

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
function normPhone(p: string | null | undefined): string {
  if (!p) return "";
  const digits = String(p).replace(/[^0-9]/g, "");
  if (digits.length < 7) return "";
  return digits.slice(-10);
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

  // One shot to pull every lead in this tenant + every lead-id with an
  // in-flight campaign. PostgREST defaults to a 1000-row page, so
  // .range(0, PAGE_CAP) is mandatory — without it the dedup index
  // misses every lead past #1001 and the wizard's preview silently
  // under-reports duplicates. Burned 2026-05-29 (De Vera Grill: dedup
  // bulk-inserted 95 leads that should've been caught).
  //
  // We also pull source + encrypted_payload because client-source
  // leads keep their PII inside the ciphertext, not in plaintext
  // columns — without hydrating them the dedup keys (first/last name,
  // LinkedIn URL, email, phone, company) are all NULL and every
  // re-import duplicates them invisibly. Burned 2026-05-29 too.
  const [existingRes, activeCampRes] = await Promise.all([
    supabase.from("leads")
      .select("id, source, encrypted_payload, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, primary_first_name, primary_last_name, company_name")
      .eq("company_bio_id", targetBioId)
      .range(0, PAGE_CAP),
    supabase.from("campaigns")
      .select("lead_id")
      .in("status", ["active", "paused"])
      .range(0, PAGE_CAP),
  ]);

  const existingRaw = (existingRes.data ?? []) as ExistingLead[];

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
    ((activeCampRes.data ?? []) as Array<{ lead_id: string | null }>)
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
    const li = normLI(l.primary_linkedin_url);
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

  // Intra-batch composite dedup (matches the Supabase UNIQUE indexes —
  // generic emails like info@empresa.com at two different companies
  // aren't duplicates; same email + same company is).
  const seenEmailCo = new Set<string>();
  const seenLICo = new Set<string>();
  const seenNameCo = new Set<string>();

  const outcomes: ImportRowOutcome[] = [];

  for (let i = 0; i < rows.length; i++) {
    const csvRow = rows[i];
    const rowIndex = i + 1;
    const mapped = applyMappingToRow(csvRow, mapping);

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

    const li = normLI(mapped.primary_linkedin_url as string | null);
    const we = normEmail(mapped.primary_work_email as string | null);
    const pe = normEmail(mapped.primary_personal_email as string | null);
    const ph = normPhone(mapped.primary_phone as string | null);
    const co = normCo(mapped.company_name as string | null);
    const fn = ((mapped.primary_first_name as string | null) || "").trim().toLowerCase();
    const ln = ((mapped.primary_last_name as string | null) || "").trim().toLowerCase();

    const wKey = we && co && !isGenericEmail(we) ? `${we}||${co}` : null;
    const peKey = pe && co && !isGenericEmail(pe) ? `${pe}||${co}` : null;
    const lKey = li && co ? `${li}||${co}` : null;
    const nKey = fn && ln && co ? `${fn}|${ln}|${co}` : null;

    if ((wKey && seenEmailCo.has(wKey)) || (peKey && seenEmailCo.has(peKey)) || (lKey && seenLICo.has(lKey)) || (nKey && seenNameCo.has(nKey))) {
      outcomes.push({ rowIndex, status: "skipped_duplicate", reason: "duplicate within this upload", display });
      continue;
    }

    let dbMatch: ExistingLead | null = null;
    let matchedBy = "";
    if (li && byLI.has(li))      { dbMatch = byLI.get(li)!;      matchedBy = "LinkedIn URL"; }
    else if (we && !isGenericEmail(we) && byWE.has(we)) { dbMatch = byWE.get(we)!; matchedBy = "work email"; }
    else if (pe && !isGenericEmail(pe) && byPE.has(pe)) { dbMatch = byPE.get(pe)!; matchedBy = "personal email"; }
    else if (ph && byPh.has(ph)) { dbMatch = byPh.get(ph)!;      matchedBy = "phone"; }
    else if (nKey && byNameCo.has(nKey)) { dbMatch = byNameCo.get(nKey)!; matchedBy = "name + company"; }

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

    if (wKey) seenEmailCo.add(wKey);
    if (peKey) seenEmailCo.add(peKey);
    if (lKey) seenLICo.add(lKey);
    if (nKey) seenNameCo.add(nKey);

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
