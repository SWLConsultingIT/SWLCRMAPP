// Admin "View as Seller" — set / clear the view-as cookie.
//
// POST { sellerId: string | null }
//   - string → preview the app as that seller (must be an ACTIVE seller with a
//     login in the ADMIN'S OWN tenant). Server-validated — a tampered cookie /
//     payload can never cross tenants or target a non-seller.
//   - null   → clear (return to Admin view).
//
// Only real admins (super_admin / owner / manager) may set it. The real user,
// role and JWT never change — this is a read-only view override (writes are
// blocked by proxy.ts while active).

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseService } from "@/integrations/supabase/service";
import { getUserScope, canViewAllTenantData } from "@/shared/auth/scope";
import { VIEW_AS_COOKIE, resolveViewAsSeller } from "@/shared/auth/view-as";

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Gate on the REAL tier — while already viewing-as, `tier` reads 'seller'.
  if (!canViewAllTenantData(scope.realTier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { sellerId } = (await req.json().catch(() => ({}))) as { sellerId?: string | null };
  const cookieStore = await cookies();

  if (!sellerId) {
    cookieStore.delete(VIEW_AS_COOKIE);
    return NextResponse.json({ ok: true, active: false });
  }

  // Validate: active seller, real login, in the admin's OWN tenant. Fail closed.
  const seller = await resolveViewAsSeller(getSupabaseService(), sellerId, true, scope.companyBioId);
  if (!seller) {
    return NextResponse.json({ error: "invalid_seller", message: "Seller not found in your tenant, inactive, or has no login." }, { status: 400 });
  }

  // 2h maxAge — an inspection session, not a working day. Cleared on logout too.
  cookieStore.set(VIEW_AS_COOKIE, seller.sellerId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 2,
  });

  return NextResponse.json({ ok: true, active: true, seller: { id: seller.sellerId, name: seller.sellerName } });
}
