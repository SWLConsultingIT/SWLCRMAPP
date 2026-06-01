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

  // Find the seller row matched to the current user (if any) so the
  // marker carries seller_id, not just user_id. The /admin/<tenant>/Aircall
  // page binds user_id → seller_id; super-admins acting on a tenant
  // won't have a binding and will be recorded with seller_id=null.
  const { data: seller } = await svc
    .from("sellers")
    .select("id")
    .eq("user_id", scope.userId)
    .eq("active", true)
    .maybeSingle();

  const { data: inserted, error } = await svc.from("calls").insert({
    lead_id: leadId ?? null,
    seller_id: seller?.id ?? null,
    direction: "outbound",
    status: "initiated",
    phone_number: phone,
    started_at: new Date().toISOString(),
  }).select("id").maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, callId: inserted?.id ?? null });
}
