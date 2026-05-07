import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { NextRequest, NextResponse } from "next/server";

// Per-tenant assignment of sellers. A seller has a primary owner
// (sellers.company_bio_id) and a list of additional tenants it can serve
// (sellers.shared_with_company_bio_ids[]). The dispatchers consider both
// when resolving "which sellers can send for tenant X".
//
// GET: returns every seller (across tenants) with name, owner, and current
// shared list. Admin UI uses this to render a checkbox per seller for the
// client being viewed.
//
// PATCH: { sellerId, companyBioId, shared: boolean }. Adds or removes the
// tenant from that seller's shared array. Returns updated row.

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseService();
  const { data: sellers, error } = await supabase
    .from("sellers")
    .select("id, name, active, company_bio_id, shared_with_company_bio_ids, linkedin_status, linkedin_status_note")
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sellers: sellers ?? [] });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { sellerId, companyBioId, shared } = await req.json();
  if (!sellerId || !companyBioId || typeof shared !== "boolean") {
    return NextResponse.json({ error: "Missing sellerId, companyBioId, or shared boolean" }, { status: 400 });
  }
  const supabase = getSupabaseService();
  const { data: existing, error: fetchErr } = await supabase
    .from("sellers")
    .select("id, company_bio_id, shared_with_company_bio_ids")
    .eq("id", sellerId)
    .maybeSingle();
  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  }
  // Reject sharing the seller with its own primary tenant — that's already
  // implied by company_bio_id; allowing it would create ambiguity in queries.
  if (existing.company_bio_id === companyBioId) {
    return NextResponse.json({ error: "Seller already belongs to this tenant as primary owner" }, { status: 400 });
  }
  const current = (existing.shared_with_company_bio_ids ?? []) as string[];
  let next: string[];
  if (shared) {
    next = current.includes(companyBioId) ? current : [...current, companyBioId];
  } else {
    next = current.filter(id => id !== companyBioId);
  }
  const { error: updateErr } = await supabase
    .from("sellers")
    .update({ shared_with_company_bio_ids: next })
    .eq("id", sellerId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, shared_with_company_bio_ids: next });
}
