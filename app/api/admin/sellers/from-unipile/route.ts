import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-admin";
import { getSupabaseService } from "@/lib/supabase-service";

// Super-admin shortcut: create a seller row for the currently-active tenant
// from an already-connected Unipile account. Skips the Unipile auth popup
// entirely — useful when you've connected a client's LinkedIn directly in the
// Unipile dashboard and just need to attach it to their CRM tenant.
//
// Body: { unipile_account_id, name, companyBioId, linkedin_daily_limit? }
//
// Guards:
//   - Caller must be super_admin (requireAdminApi).
//   - The Unipile account must be orphan (no seller already references it),
//     otherwise we'd silently steal it from whoever it belongs to.
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({})) as {
    unipile_account_id?: string;
    name?: string;
    companyBioId?: string;
    linkedin_daily_limit?: number;
  };

  const unipileId = body.unipile_account_id?.trim();
  const name = body.name?.trim();
  const companyBioId = body.companyBioId?.trim();
  const dailyLimit = typeof body.linkedin_daily_limit === "number" ? body.linkedin_daily_limit : 15;

  if (!unipileId) return NextResponse.json({ error: "unipile_account_id required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!companyBioId) return NextResponse.json({ error: "companyBioId required" }, { status: 400 });

  const svc = getSupabaseService();

  // Orphan check: refuse if any seller already references this Unipile account.
  const { data: existing } = await svc
    .from("sellers")
    .select("id, company_bio_id, name")
    .eq("unipile_account_id", unipileId)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: `Unipile account already linked to seller "${existing[0].name}"`, sellerId: existing[0].id },
      { status: 409 },
    );
  }

  // Verify the target tenant exists (defensive — a stale companyBioId would
  // otherwise insert a seller pointing at a deleted tenant).
  const { data: bio } = await svc
    .from("company_bios")
    .select("id, company_name, archived_at")
    .eq("id", companyBioId)
    .maybeSingle();
  if (!bio || bio.archived_at) {
    return NextResponse.json({ error: "Tenant not found or archived" }, { status: 404 });
  }

  const { data: created, error } = await svc
    .from("sellers")
    .insert({
      name,
      company_bio_id: companyBioId,
      unipile_account_id: unipileId,
      linkedin_daily_limit: dailyLimit,
      active: true,
    })
    .select("id, name, company_bio_id, unipile_account_id")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, seller: created });
}
