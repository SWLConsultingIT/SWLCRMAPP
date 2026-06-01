import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// GET /api/aircall/active-call — answers "is the tenant's shared
// Aircall seat currently busy with another seller's call?".
//
// Returns { busy: false } when no other seller in the same tenant has
// an open call row in the last 10 minutes, otherwise { busy: true,
// byName, startedAt } so the CallButton can show a red banner above
// the Call action and the second seller knows not to bother dialing
// until the first one hangs up.
//
// "Other seller" = a calls row where seller_id is set, doesn't equal
// the caller's seller, and ended_at is still NULL. Rows older than 10
// minutes are treated as stale (Aircall webhook didn't close them; we
// don't want to leave the banner up indefinitely on a half-hang).
//
// Note: this only protects against the shared-seat scenario Fran's
// CRM uses. Tenants with one Aircall user per seller still get busy=false
// because each seller's own calls are filtered out by seller_id.
export async function GET() {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ busy: false });

  const svc = getSupabaseService();

  // Resolve current seller (may be null for super-admins on a tenant).
  const { data: mySeller } = await svc
    .from("sellers")
    .select("id")
    .eq("user_id", scope.userId)
    .maybeSingle();
  const mySellerId = mySeller?.id ?? null;

  // Window: 10 minutes back covers any reasonable dial→ring→answer→hangup
  // cycle while still letting a stuck row drop off.
  const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: rows } = await svc
    .from("calls")
    .select("id, seller_id, started_at, status, lead_id, leads!inner(company_bio_id), sellers(name)")
    .eq("leads.company_bio_id", scope.companyBioId)
    .is("ended_at", null)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(5);

  // Filter out own calls + rows without a seller (we can't claim they're
  // "another seller" so skip).
  const others = (rows ?? []).filter((r: any) => {
    if (!r.seller_id) return false;
    if (mySellerId && r.seller_id === mySellerId) return false;
    return true;
  });
  if (others.length === 0) return NextResponse.json({ busy: false });

  const top = others[0] as any;
  const sellerName = Array.isArray(top.sellers) ? top.sellers[0]?.name : top.sellers?.name;
  return NextResponse.json({
    busy: true,
    byName: sellerName ?? "another seller",
    startedAt: top.started_at,
    status: top.status,
  });
}
