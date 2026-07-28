// Tenant-scoped lead delete. Cascades to lead_replies, campaign_messages,
// campaigns, and lead_notes — the schema doesn't have ON DELETE CASCADE on
// every back-ref, so the route does it explicitly.
//
// Auth: any authenticated user can delete a lead inside their own tenant.
// Pre-2026-05-29 this route had NO auth gate at all — anyone with the URL
// could wipe any lead in any tenant.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { decryptLeadPayload, encryptLeadPayload, bufferFromSupabaseBytea, logDataAccess, ENCRYPTED_LEAD_COLUMNS } from "@/lib/leads-crypto";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: lead, error: readErr } = await svc
    .from("leads")
    .select("id, company_bio_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await svc.from("lead_replies").delete().eq("lead_id", id);
  await svc.from("campaign_messages").delete().eq("lead_id", id);
  await svc.from("campaigns").delete().eq("lead_id", id);
  await svc.from("lead_notes").delete().eq("lead_id", id);

  const { error } = await svc.from("leads").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true });
}

// PATCH a single lead field. Currently used by the inline phone editor on
// the lead detail header — Fran 2026-06-01 needed to fix Argentina mobile
// formatting (missing "9" prefix) without going through the CSV reimport
// flow. Keep the allowlist tight so this can't be turned into a generic
// "rewrite anything" endpoint.
const ALLOWED_FIELDS = new Set([
  "primary_phone",
  "primary_secondary_phone",
  "primary_work_email",
  "primary_linkedin_url",
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(k)) update[k] = body[k];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no allowed fields in body" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { data: lead, error: readErr } = await svc
    .from("leads")
    .select("id, company_bio_id, source, encrypted_payload")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Replacing a wrong-number flag: when the seller edits primary_phone
  // (or primary_secondary_phone) on a lead that had allow_call=false from
  // a "wrong number" post-call outcome, re-enable the channel automatically
  // so the next dispatch / Call button works without needing a separate
  // admin step. (2026-06-01.)
  if ("primary_phone" in update || "primary_secondary_phone" in update) {
    update.allow_call = true;
  }
  update.updated_at = new Date().toISOString();

  // Client-source leads keep PII (email, phone, name…) in encrypted_payload;
  // the plain columns are NULL and reads come from the decrypted blob. Writing
  // the plain column would silently NO-OP — the edit wouldn't show. So for those
  // leads, round-trip the encrypted fields THROUGH encrypted_payload and keep
  // them out of the plain update. (This also fixes the same latent bug the phone
  // editor had for client tenants.) SWL-source leads stay on plain columns.
  const encryptedEdits: Record<string, unknown> = {};
  const encryptedCols = ENCRYPTED_LEAD_COLUMNS as readonly string[];
  for (const k of Object.keys(update)) {
    if (encryptedCols.includes(k)) encryptedEdits[k] = update[k];
  }
  const isClientEncrypted = (lead as any).source === "client" && !!(lead as any).encrypted_payload;
  if (isClientEncrypted && Object.keys(encryptedEdits).length > 0) {
    try {
      const bioId = lead.company_bio_id as string;
      const current = await decryptLeadPayload(bufferFromSupabaseBytea((lead as any).encrypted_payload), bioId);
      const { ciphertext } = await encryptLeadPayload({ ...current, ...encryptedEdits }, bioId);
      // bytea write MUST be the hex-escaped form — a raw Buffer corrupts the
      // ciphertext through supabase-js (De Vera Grill incident, 2026-05).
      update.encrypted_payload = "\\x" + ciphertext.toString("hex");
      await logDataAccess({ companyBioId: bioId, leadId: id, caller: "client-app", reason: "inline field edit" });
      // Don't also write the encrypted fields to the (unread) plain columns.
      for (const k of Object.keys(encryptedEdits)) delete update[k];
    } catch (e) {
      return NextResponse.json({ error: "could not update encrypted field: " + (e as Error).message }, { status: 500 });
    }
  }

  const { error } = await svc.from("leads").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: Object.keys(update) });
}
