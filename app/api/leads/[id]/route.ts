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
    .select("id, company_bio_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  update.updated_at = new Date().toISOString();

  // Replacing a wrong-number flag: when the seller edits primary_phone
  // (or primary_secondary_phone) on a lead that had allow_call=false from
  // a "wrong number" post-call outcome, re-enable the channel automatically
  // so the next dispatch / Call button works without needing a separate
  // admin step. Without this, sellers were updating the number, getting
  // no feedback that the channel was still disabled, and discovering it
  // again at the next call attempt. (2026-06-01.)
  if ("primary_phone" in update || "primary_secondary_phone" in update) {
    update.allow_call = true;
  }

  const { error } = await svc.from("leads").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: Object.keys(update) });
}
