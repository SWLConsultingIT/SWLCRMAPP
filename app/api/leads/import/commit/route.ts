// Step 3 of the import wizard: write the mapped rows into `leads`.
//
// Behaviour parity with the n8n Sheets sync (taR8Y8neAPFurUfv) so users can
// import via either path and get the same dedup + scoring guarantees:
//   1. Intra-batch dedup: catches the same lead listed twice in the upload.
//   2. DB dedup: matches against existing leads by linkedin_url / work_email /
//      personal_email / phone / (name + company). If the lead exists and is
//      in an active campaign, skip. Otherwise update with new fields only.
//   3. Lead scoring: cheap heuristic (filled-fields count) so leads land in
//      /leads with a non-null score and sellers see triage hints right away.
//   4. Per-row result: returns inserted / updated / skipped_* / error per row
//      so the UI shows exactly which rows failed and why.
//
// Source assignment:
//   - super_admin → caller can opt-in to encrypt via `body.encrypt=true`.
//     Default false → source='swl', plaintext, readable in the UI.
//   - any tenant role (owner/manager/seller) → always source='client',
//     always encrypted, regardless of what they send. That's the privacy
//     contract for client-tenant uploads.
//
// company_bio_id always comes from the caller's scope, never from the body.

import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canEditTenantSettings } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import {
  resolveTenantKey,
  encryptWithResolvedKey,
  splitLeadForEncryption,
  logDataAccess,
} from "@/lib/leads-crypto";
import { applyMappingToRow, type LeadMappingResult } from "@/lib/lead-csv-mapper";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 100;

type CommitBody = {
  fileName: string;
  rows: Array<Record<string, string>>;
  mapping: LeadMappingResult;
  // SWL admin only — opt-in to at-rest encryption for this batch. Ignored
  // for non-SWL roles (they always encrypt).
  encrypt?: boolean;
};

type RowOutcome = {
  rowIndex: number;
  status: "inserted" | "updated" | "skipped_duplicate" | "skipped_no_data" | "error";
  leadId?: string | null;
  reason?: string;
};

// ─── helpers ──────────────────────────────────────────────────────────────

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

// Heuristic score, mirrors the Sheets sync calcScore. Filled fields signal
// "this lead is worth working on" — sellers triage on the resulting badge
// in /leads.
function calcScore(l: Record<string, unknown>): number {
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

// ─── route ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canEditTenantSettings(scope.tier) && scope.tier !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as CommitBody | null;
  if (!body || !Array.isArray(body.rows) || !body.mapping || !Array.isArray(body.mapping.mappings)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Source = swl when caller is super_admin AND they haven't explicitly
  // requested encryption. Any non-super_admin path encrypts unconditionally.
  const isSwlAdmin = scope.tier === "super_admin";
  const shouldEncrypt = isSwlAdmin ? body.encrypt === true : true;
  const targetBioId = scope.companyBioId;

  if (!targetBioId) {
    return NextResponse.json({ error: "missing tenant scope" }, { status: 400 });
  }

  const svc = getSupabaseService();

  let tenantKey: Buffer | null = null;
  let encryptionMode: "standard" | "sovereign" | null = null;
  if (shouldEncrypt) {
    try {
      const resolved = await resolveTenantKey(targetBioId);
      tenantKey = resolved.key;
      encryptionMode = resolved.mode;
    } catch (err) {
      return NextResponse.json(
        { error: `Encryption key unavailable: ${err instanceof Error ? err.message : "unknown"}` },
        { status: 500 },
      );
    }
  }

  // Pull existing leads + active campaign-lead pairs once. Composite UNIQUE
  // indexes on the leads table treat (email, company) and (linkedin, company)
  // as the natural keys, so we mirror that here for dedup decisions.
  const [existingRes, activeCampRes] = await Promise.all([
    svc.from("leads")
      .select("id, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, primary_first_name, primary_last_name, company_name, linkedin_internal_id, campaign_template_id")
      .eq("company_bio_id", targetBioId)
      .limit(20000),
    svc.from("campaigns")
      .select("lead_id")
      .in("status", ["active", "paused"]),
  ]);

  type ExistingLead = NonNullable<typeof existingRes.data>[number];
  const existing: ExistingLead[] = (existingRes.data ?? []) as ExistingLead[];
  const activeLeadIds = new Set((activeCampRes.data ?? []).map((r: { lead_id: string | null }) => r.lead_id).filter(Boolean) as string[]);

  // Build lookup indexes (one O(n) walk, then O(1) per row in the dedup pass)
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

  // Intra-batch composite-key dedup (matches the Supabase UNIQUE indexes).
  // Two leads sharing a generic email like info@empresa.com but in different
  // companies are valid — only same email + same company is a real conflict.
  const seenEmailCo = new Set<string>();
  const seenLICo = new Set<string>();
  const seenNameCo = new Set<string>();

  const outcomes: RowOutcome[] = [];
  type Insert = { rowIndex: number; row: Record<string, unknown> };
  type Update = { rowIndex: number; existingId: string; patch: Record<string, unknown> };
  const toInsert: Insert[] = [];
  const toUpdate: Update[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const csvRow = body.rows[i];
    const rowIndex = i + 1; // 1-based for the operator UI
    const mapped = applyMappingToRow(csvRow, body.mapping);

    const hasName = mapped.primary_first_name || mapped.primary_last_name;
    const hasContact = mapped.primary_work_email || mapped.primary_personal_email || mapped.primary_phone || mapped.primary_linkedin_url;
    if (!hasName && !hasContact) {
      outcomes.push({ rowIndex, status: "skipped_no_data", reason: "no name or contact info" });
      continue;
    }

    const li = normLI(mapped.primary_linkedin_url as string | null);
    const we = normEmail(mapped.primary_work_email as string | null);
    const pe = normEmail(mapped.primary_personal_email as string | null);
    const ph = normPhone(mapped.primary_phone as string | null);
    const co = normCo(mapped.company_name as string | null);
    const fn = ((mapped.primary_first_name as string | null) || "").trim().toLowerCase();
    const ln = ((mapped.primary_last_name as string | null) || "").trim().toLowerCase();

    // Intra-batch composite dedup
    const wKey = we && co ? `${we}||${co}` : null;
    const peKey = pe && co ? `${pe}||${co}` : null;
    const lKey = li && co ? `${li}||${co}` : null;
    const nKey = fn && ln && co ? `${fn}|${ln}|${co}` : null;
    if ((wKey && seenEmailCo.has(wKey)) || (peKey && seenEmailCo.has(peKey)) || (lKey && seenLICo.has(lKey)) || (nKey && seenNameCo.has(nKey))) {
      outcomes.push({ rowIndex, status: "skipped_duplicate", reason: "duplicate within the upload itself" });
      continue;
    }

    // DB match
    let dbMatch: ExistingLead | null = null;
    if (li && byLI.has(li)) dbMatch = byLI.get(li)!;
    else if (we && byWE.has(we)) dbMatch = byWE.get(we)!;
    else if (pe && byPE.has(pe)) dbMatch = byPE.get(pe)!;
    else if (ph && byPh.has(ph)) dbMatch = byPh.get(ph)!;
    else if (nKey && byNameCo.has(nKey)) dbMatch = byNameCo.get(nKey)!;

    if (dbMatch && activeLeadIds.has(dbMatch.id)) {
      outcomes.push({ rowIndex, status: "skipped_duplicate", leadId: dbMatch.id, reason: "lead already exists and is in an active campaign — left untouched" });
      continue;
    }

    // Register intra-batch keys NOW (after dedup decision) so subsequent rows
    // in this same upload are checked against this one.
    if (wKey) seenEmailCo.add(wKey);
    if (peKey) seenEmailCo.add(peKey);
    if (lKey) seenLICo.add(lKey);
    if (nKey) seenNameCo.add(nKey);

    const score = calcScore(mapped as Record<string, unknown>);

    if (dbMatch) {
      // Existing lead, no active campaign → fill in missing fields only
      const patch: Record<string, unknown> = { lead_score: score, updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(mapped)) {
        if (v == null || v === "") continue;
        if ((dbMatch as Record<string, unknown>)[k] == null || (dbMatch as Record<string, unknown>)[k] === "") {
          patch[k] = v;
        }
      }
      toUpdate.push({ rowIndex, existingId: dbMatch.id, patch });
    } else {
      // Channel opt-ins default to true on import — the column-level default
      // for `allow_call` is FALSE, which silently blocks every imported lead
      // from being reachable on Call (and from showing in campaign-sequence
      // call steps). Mapping may override per-row; otherwise we open all the
      // channels the seller can actually reach the lead on.
      const allowDefaults = {
        allow_linkedin: (mapped as Record<string, unknown>).allow_linkedin ?? true,
        allow_email:    (mapped as Record<string, unknown>).allow_email    ?? true,
        allow_call:     (mapped as Record<string, unknown>).allow_call     ?? true,
        allow_whatsapp: (mapped as Record<string, unknown>).allow_whatsapp ?? true,
        allow_sms:      (mapped as Record<string, unknown>).allow_sms      ?? true,
      };
      // Fresh insert
      if (shouldEncrypt) {
        const { operational, encrypted } = splitLeadForEncryption(mapped);
        const { ciphertext, version } = encryptWithResolvedKey(encrypted, tenantKey!);
        toInsert.push({
          rowIndex,
          row: {
            ...operational,
            ...allowDefaults,
            source: "client",
            company_bio_id: targetBioId,
            encrypted_payload: ciphertext,
            encryption_version: version,
            sync_status: "synced",
            lead_score: score,
          },
        });
      } else {
        toInsert.push({
          rowIndex,
          row: {
            ...mapped,
            ...allowDefaults,
            source: "swl",
            company_bio_id: targetBioId,
            sync_status: "synced",
            lead_score: score,
          },
        });
      }
    }
  }

  // ─── execute inserts ──────────────────────────────────────────────────
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const slice = toInsert.slice(i, i + BATCH_SIZE);
    const { data, error } = await svc.from("leads").insert(slice.map(s => s.row)).select("id");
    if (error || !data) {
      // Bulk failed — fall back to per-row to isolate the bad rows. One bad
      // lead shouldn't poison the whole batch.
      for (const item of slice) {
        const single = await svc.from("leads").insert(item.row).select("id").maybeSingle();
        if (single.error || !single.data) {
          outcomes.push({ rowIndex: item.rowIndex, status: "error", reason: single.error?.message ?? "insert failed" });
          errors++;
        } else {
          outcomes.push({ rowIndex: item.rowIndex, status: "inserted", leadId: (single.data as { id: string }).id });
          inserted++;
        }
      }
    } else {
      // Bulk succeeded — order is preserved by PostgREST, so we can map by
      // index back to the slice.
      data.forEach((rec: { id: string }, idx) => {
        const item = slice[idx];
        outcomes.push({ rowIndex: item.rowIndex, status: "inserted", leadId: rec.id });
        inserted++;
      });
    }
  }

  // ─── execute updates (parallel with concurrency cap) ─────────────────
  let updated = 0;
  const UPDATE_CONCURRENCY = 10;
  for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
    const slice = toUpdate.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(slice.map(async item => {
      const { error } = await svc.from("leads").update(item.patch).eq("id", item.existingId);
      if (error) {
        outcomes.push({ rowIndex: item.rowIndex, status: "error", leadId: item.existingId, reason: error.message });
        errors++;
      } else {
        outcomes.push({ rowIndex: item.rowIndex, status: "updated", leadId: item.existingId, reason: "filled missing fields on existing lead" });
        updated++;
      }
    }));
  }

  const skipped = outcomes.filter(o => o.status.startsWith("skipped")).length;

  // Audit one entry per import. Encrypted client uploads keep the
  // existing client-app tag; plaintext SWL imports get swl-admin so we can
  // tell them apart in the access log.
  await logDataAccess({
    companyBioId: targetBioId,
    caller: shouldEncrypt ? "client-app" : "swl-admin",
    reason: `import:${body.fileName} (${inserted} inserted, ${updated} updated, ${skipped} skipped, ${errors} errors)`,
    encryptionMode: encryptionMode ?? undefined,
  });

  outcomes.sort((a, b) => a.rowIndex - b.rowIndex);

  return NextResponse.json({
    inserted,
    updated,
    skipped,
    errors,
    encrypted: shouldEncrypt,
    rowResults: outcomes,
  });
}
