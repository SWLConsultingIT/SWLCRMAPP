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
  primary_linkedin_url: string | null;
  primary_work_email: string | null;
  primary_personal_email: string | null;
  primary_phone: string | null;
  primary_first_name: string | null;
  primary_last_name: string | null;
  company_name: string | null;
};

// Same supabase shape both routes use. Kept loose so we don't pull the
// supabase-js types into a library file.
type Supa = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        limit?: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
      } & Promise<{ data: unknown[] | null; error: unknown }>;
      in?: (col: string, vals: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

function normLI(url: string | null | undefined): string {
  if (!url) return "";
  return String(url).trim().toLowerCase().split("?")[0].replace(/\/+$/, "");
}
function normEmail(e: string | null | undefined): string {
  return e ? String(e).trim().toLowerCase() : "";
}
function normPhone(p: string | null | undefined): string {
  if (!p) return "";
  const digits = String(p).replace(/[^0-9]/g, "");
  if (digits.length < 7) return "";
  return digits.slice(-10);
}
function normCo(c: string | null | undefined): string {
  return c ? String(c).trim().toLowerCase() : "";
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
  // in-flight campaign. The wizard caps imports at 50k rows, and tenant
  // sizes top out in the low-tens-of-thousands, so a single SELECT here
  // beats per-row roundtrips every time.
  const [existingRes, activeCampRes] = await Promise.all([
    supabase.from("leads")
      .select("id, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, primary_first_name, primary_last_name, company_name")
      .eq("company_bio_id", targetBioId),
    supabase.from("campaigns")
      .select("lead_id")
      .in!("status", ["active", "paused"]),
  ]);

  const existing = (existingRes.data ?? []) as ExistingLead[];
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
    const fn = (l.primary_first_name || "").trim().toLowerCase();
    const ln = (l.primary_last_name || "").trim().toLowerCase();
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

    const wKey = we && co ? `${we}||${co}` : null;
    const peKey = pe && co ? `${pe}||${co}` : null;
    const lKey = li && co ? `${li}||${co}` : null;
    const nKey = fn && ln && co ? `${fn}|${ln}|${co}` : null;

    if ((wKey && seenEmailCo.has(wKey)) || (peKey && seenEmailCo.has(peKey)) || (lKey && seenLICo.has(lKey)) || (nKey && seenNameCo.has(nKey))) {
      outcomes.push({ rowIndex, status: "skipped_duplicate", reason: "duplicate within this upload", display });
      continue;
    }

    let dbMatch: ExistingLead | null = null;
    let matchedBy = "";
    if (li && byLI.has(li))      { dbMatch = byLI.get(li)!;      matchedBy = "LinkedIn URL"; }
    else if (we && byWE.has(we)) { dbMatch = byWE.get(we)!;      matchedBy = "work email"; }
    else if (pe && byPE.has(pe)) { dbMatch = byPE.get(pe)!;      matchedBy = "personal email"; }
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
