// Step 4 of the import wizard: write the mapped rows into `leads`.
//
// All dedup + plan logic is in lib/lead-import-dedup.ts (shared with the
// /dry-run preview). This route just executes the plan + handles
// per-row encryption + writes the audit log.
//
// Source assignment:
//   - super_admin → caller can opt-in to encrypt via `body.encrypt=true`.
//     Default false → source='swl', plaintext, readable in the UI.
//   - any tenant role (owner/manager/seller) → always source='client',
//     always encrypted, regardless of what they send.
//
// ICP assignment:
//   - body.icpProfileId is required so leads land with a profile_id and
//     don't sit orphaned (the one-ICP-per-campaign LAW kicks in the
//     moment someone tries to enrol them, so we'd rather block the
//     import than create unattachable leads). The caller picks the ICP
//     in step 1 of the wizard.
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
import type { LeadMappingResult } from "@/lib/lead-csv-mapper";
import { buildImportPlan } from "@/lib/lead-import-dedup";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 100;

type CommitBody = {
  fileName: string;
  rows: Array<Record<string, string>>;
  mapping: LeadMappingResult;
  // The ICP every imported lead lands under. Required so we don't create
  // orphan leads that can't be enrolled (one-ICP-per-campaign LAW).
  icpProfileId: string;
  // SWL admin only — opt-in to at-rest encryption for this batch.
  encrypt?: boolean;
};

type RowOutcome = {
  rowIndex: number;
  status: "inserted" | "updated" | "skipped_duplicate" | "skipped_no_data" | "error";
  leadId?: string | null;
  reason?: string;
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
  if (!body.icpProfileId || typeof body.icpProfileId !== "string") {
    return NextResponse.json({ error: "icpProfileId is required" }, { status: 400 });
  }

  const isSwlAdmin = scope.tier === "super_admin";
  const shouldEncrypt = isSwlAdmin ? body.encrypt === true : true;
  const targetBioId = scope.companyBioId;

  if (!targetBioId) {
    return NextResponse.json({ error: "missing tenant scope" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Validate the ICP belongs to this tenant — caller can't cross-attach
  // leads to another tenant's ICP by guessing its UUID.
  const { data: icpRow, error: icpErr } = await svc
    .from("icp_profiles")
    .select("id, company_bio_id")
    .eq("id", body.icpProfileId)
    .maybeSingle();
  if (icpErr) {
    return NextResponse.json({ error: `ICP lookup failed: ${icpErr.message}` }, { status: 500 });
  }
  if (!icpRow || icpRow.company_bio_id !== targetBioId) {
    return NextResponse.json({ error: "ICP not found in this tenant" }, { status: 400 });
  }

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

  const plan = await buildImportPlan({
    rows: body.rows,
    mapping: body.mapping,
    targetBioId,
    supabase: svc as unknown as Parameters<typeof buildImportPlan>[0]["supabase"],
  });

  // Materialize the writes. The plan already split intents into insert /
  // update / skipped; here we just turn that into the actual Supabase
  // operations, applying encryption when needed.
  type Insert = { rowIndex: number; row: Record<string, unknown> };
  type Update = { rowIndex: number; existingId: string; patch: Record<string, unknown> };
  const toInsert: Insert[] = [];
  const toUpdate: Update[] = [];
  const outcomes: RowOutcome[] = [];

  for (const o of plan.outcomes) {
    if (o.status === "skipped_no_data") {
      outcomes.push({ rowIndex: o.rowIndex, status: "skipped_no_data", reason: o.reason });
      continue;
    }
    if (o.status === "skipped_duplicate") {
      outcomes.push({
        rowIndex: o.rowIndex,
        status: "skipped_duplicate",
        leadId: o.existingLeadId ?? null,
        reason: o.reason,
      });
      continue;
    }
    if (o.status === "update" && o.existingLeadId && o.patch) {
      // Updates only patch missing fields — the ICP can change on an
      // already-imported lead via the wizard, so we honor the new pick
      // even when the row already exists.
      const patch = { ...o.patch, icp_profile_id: body.icpProfileId };
      toUpdate.push({ rowIndex: o.rowIndex, existingId: o.existingLeadId, patch });
      continue;
    }
    if (o.status === "insert" && o.mapped) {
      // Channel opt-ins default to true on import — column default for
      // allow_call is FALSE in the DB schema, which silently blocks
      // every imported lead from being reachable on Call.
      const allowDefaults = {
        allow_linkedin: o.mapped.allow_linkedin ?? true,
        allow_email:    o.mapped.allow_email    ?? true,
        allow_call:     o.mapped.allow_call     ?? true,
        allow_whatsapp: o.mapped.allow_whatsapp ?? true,
        allow_sms:      o.mapped.allow_sms      ?? true,
      };
      if (shouldEncrypt) {
        const { operational, encrypted } = splitLeadForEncryption(o.mapped);
        const { ciphertext, version } = encryptWithResolvedKey(encrypted, tenantKey!);
        // supabase-js JSON.stringify's Buffer as {"type":"Buffer","data":[...]}
        // and Postgres stores that verbatim into bytea — corrupting the
        // ciphertext so decrypt fails silently. Force the wire format
        // to Postgres's bytea hex literal so it lands as raw bytes.
        toInsert.push({
          rowIndex: o.rowIndex,
          row: {
            ...operational,
            ...allowDefaults,
            source: "client",
            company_bio_id: targetBioId,
            icp_profile_id: body.icpProfileId,
            encrypted_payload: "\\x" + ciphertext.toString("hex"),
            encryption_version: version,
            sync_status: "synced",
            lead_score: o.mapped.lead_score ?? 0,
          },
        });
      } else {
        toInsert.push({
          rowIndex: o.rowIndex,
          row: {
            ...o.mapped,
            ...allowDefaults,
            source: "swl",
            company_bio_id: targetBioId,
            icp_profile_id: body.icpProfileId,
            sync_status: "synced",
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
      // Bulk failed — fall back to per-row to isolate the bad rows. One
      // bad lead shouldn't poison the whole batch.
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

  await logDataAccess({
    companyBioId: targetBioId,
    caller: shouldEncrypt ? "client-app" : "swl-admin",
    reason: `import:${body.fileName} (${inserted} inserted, ${updated} updated, ${skipped} skipped, ${errors} errors) icp=${body.icpProfileId}`,
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
