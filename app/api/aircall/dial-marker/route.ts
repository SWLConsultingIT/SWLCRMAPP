import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// POST /api/aircall/dial-marker — writes a row into `calls` BEFORE the
// Aircall Everywhere SDK fires. The embed SDK doesn't pass through our
// `/api/aircall/dial` endpoint (it talks directly to Aircall), so without
// this marker, the calls row created later by the webhook has no
// `seller_id` — and there's no way to tell which seller in a shared-seat
// tenant is mid-call.
//
// Why we need it: Fran's clients run on a single Aircall user per tenant
// (one seat shared across N sellers). Aircall allows only one active
// session per user, so a second seller can't dial while the first is in
// a call. The Active-call endpoint reads this marker to flash a
// "Aircall busy by <seller>" banner above the Call button on the second
// seller's screen, before they waste a click.
//
// The webhook's outbound branch matches by phone-last-10 and reuses the
// same row, so this marker isn't a duplicate — it's the row that
// eventually becomes the real call record once Aircall reports back.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { leadId, phone } = (await req.json().catch(() => ({}))) as {
    leadId?: string | null;
    phone?: string | null;
  };
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const svc = getSupabaseService();

  // Resolve the dialing tenant from the lead (a super_admin can dial across
  // tenants), falling back to the caller's own scope.
  let dialingBioId: string | null = scope.companyBioId ?? null;
  if (leadId) {
    const { data: leadRow } = await svc.from("leads").select("company_bio_id").eq("id", leadId).maybeSingle();
    dialingBioId = ((leadRow as { company_bio_id?: string | null } | null)?.company_bio_id) ?? dialingBioId;
  }

  // Find the seller row matched to the current user (if any) so the marker
  // carries seller_id, not just user_id. MUST be scoped to the dialing tenant
  // — without it, an admin whose user_id is also a seller in ANOTHER tenant
  // got that foreign seller stamped on the call (cross-tenant mis-attribution:
  // SWL calls showed "Luciano Sosa", a seller from a different bio, 2026-06-04).
  // No in-tenant seller binding → seller_id stays null (no chip), which is
  // correct for admins who aren't a seller in this tenant.
  let seller: { id: string } | null = null;
  if (dialingBioId) {
    const { data } = await svc
      .from("sellers")
      .select("id")
      .eq("user_id", scope.userId)
      .eq("active", true)
      .eq("company_bio_id", dialingBioId)
      .maybeSingle();
    seller = (data as { id: string } | null) ?? null;
  }

  const { data: inserted, error } = await svc.from("calls").insert({
    lead_id: leadId ?? null,
    seller_id: seller?.id ?? null,
    // The actual user who clicked Call — independent of any seller binding, so
    // History can show "Called by <teammate>" even for admins who aren't a
    // seller in this tenant. The webhook/sync marker-reconciliation reuses this
    // row, so the dialer persists onto the answered call too.
    dialed_by_user_id: scope.userId,
    direction: "outbound",
    status: "initiated",
    phone_number: phone,
    started_at: new Date().toISOString(),
  }).select("id").maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, callId: inserted?.id ?? null });
}
