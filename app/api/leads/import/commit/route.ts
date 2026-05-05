// Step 3 of the import wizard: write the mapped rows into `leads`.
//
// Source assignment is decided by the caller's tier, not by a UI toggle:
//   - super_admin without active demo  → source='swl', plain (legacy SWL flow)
//   - any tenant role (owner/manager/seller within a bio_id)
//                                       → source='client', encrypted at rest
//
// company_bio_id is taken from the caller's scope and never from the request
// body — clients can't insert into another tenant by spoofing the field.

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
};

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

  // Determine source by caller tier. super_admin with no tenant scope (not in
  // demo mode) writes legacy SWL leads. Anyone else writes encrypted client
  // leads scoped to their own bio.
  const isSwlInternal = scope.tier === "super_admin" && !scope.companyBioId;
  const targetBioId = isSwlInternal ? null : scope.companyBioId;

  if (!isSwlInternal && !targetBioId) {
    return NextResponse.json({ error: "missing tenant scope" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // For client imports, resolve the tenant's encryption key once.
  let tenantKey: Buffer | null = null;
  let encryptionMode: "standard" | "sovereign" | null = null;
  if (!isSwlInternal && targetBioId) {
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

  // Build the rows to insert.
  type Row = Record<string, unknown>;
  const inserts: Row[] = [];
  let skipped = 0;
  for (const csvRow of body.rows) {
    const mapped = applyMappingToRow(csvRow, body.mapping);
    // Need at least a name OR an email/linkedin to be considered a usable lead.
    const hasName = mapped.primary_first_name || mapped.primary_last_name;
    const hasContact = mapped.primary_work_email || mapped.primary_personal_email || mapped.primary_phone || mapped.primary_linkedin_url;
    if (!hasName && !hasContact) {
      skipped++;
      continue;
    }

    if (isSwlInternal) {
      inserts.push({
        ...mapped,
        source: "swl",
        company_bio_id: targetBioId,
        sync_status: "pending",
      });
    } else {
      // Split PII vs operational. The PII half goes into encrypted_payload,
      // the operational half stays in plain so the orchestrator/RLS work.
      const { operational, encrypted } = splitLeadForEncryption(mapped);
      const { ciphertext, version } = encryptWithResolvedKey(encrypted, tenantKey!);
      inserts.push({
        ...operational,
        source: "client",
        company_bio_id: targetBioId,
        encrypted_payload: ciphertext,
        encryption_version: version,
        sync_status: "pending",
      });
    }
  }

  if (inserts.length === 0) {
    return NextResponse.json({ error: "no usable rows", skipped }, { status: 422 });
  }

  // Insert in batches to avoid huge requests / Postgres parse limits.
  let inserted = 0;
  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    const batch = inserts.slice(i, i + BATCH_SIZE);
    const { error } = await svc.from("leads").insert(batch);
    if (error) {
      return NextResponse.json(
        { error: `Insert failed at batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`, inserted },
        { status: 500 },
      );
    }
    inserted += batch.length;
  }

  // Audit: a single log entry per import run, not per lead, so the access log
  // doesn't get spammed for bulk operations.
  if (!isSwlInternal && targetBioId) {
    await logDataAccess({
      companyBioId: targetBioId,
      caller: "client-app",
      reason: `import:${body.fileName} (${inserted} leads)`,
      encryptionMode: encryptionMode ?? undefined,
    });
  }

  return NextResponse.json({
    inserted,
    skipped,
    source: isSwlInternal ? "swl" : "client",
    encrypted: !isSwlInternal,
  });
}
