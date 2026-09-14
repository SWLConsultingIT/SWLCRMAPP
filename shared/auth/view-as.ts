// Admin "View as Seller" — effective view scope, NOT an identity mutation.
//
// An admin (super_admin / owner / manager) can preview the app as one of THEIR
// tenant's sellers to inspect the seller UX + permissions. The real auth user,
// JWT, persisted role and tenant never change — this only NARROWS what the admin
// sees (data + UI), it can never widen access. Tenant isolation is enforced
// server-side: the target seller MUST belong to the admin's own tenant.
//
// V1 is a READ-ONLY preview: writes are blocked while viewing-as (see
// `blockedInViewAs`), so the effective user id is only ever used for reads.
//
// Kept import-free of scope.ts (callers pass `isAdmin`) so scope.ts can import
// this without a cycle.

/** HttpOnly cookie holding the sellers.id an admin is currently viewing-as. */
export const VIEW_AS_COOKIE = "view_as_seller_id";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ViewAsSeller = { sellerId: string; sellerUserId: string; sellerName: string };

type SellerRow = {
  id: string;
  name: string | null;
  user_id: string | null;
  company_bio_id?: string | null;
  active?: boolean | null;
};

/**
 * Resolve + VALIDATE a view-as target from the cookie. Returns null (no
 * override) unless ALL hold:
 *   - a cookie value is present;
 *   - the real caller is an admin (canViewAllTenantData — passed as `isAdmin`);
 *   - the caller has a tenant;
 *   - the seller exists, maps to a real login (`user_id`), is active, and
 *     belongs to the caller's OWN tenant (`company_bio_id === companyBioId`).
 * Any failure ⇒ null ⇒ the admin keeps their real (admin) scope. Fail closed.
 */
export async function resolveViewAsSeller(
  svc: SupabaseClient,
  cookieValue: string | null | undefined,
  isAdmin: boolean,
  companyBioId: string | null,
): Promise<ViewAsSeller | null> {
  if (!cookieValue || !isAdmin || !companyBioId) return null;
  const { data } = await svc
    .from("sellers")
    .select("id, name, user_id, company_bio_id, active")
    .eq("id", cookieValue)
    .maybeSingle();
  const seller = data as SellerRow | null;
  if (!seller) return null;
  if (!seller.user_id) return null;                       // must map to a login
  if (seller.active === false) return null;               // inactive seller
  if (seller.company_bio_id !== companyBioId) return null; // TENANT ISOLATION — fail closed
  return { sellerId: seller.id, sellerUserId: seller.user_id as string, sellerName: seller.name ?? "Seller" };
}

export type ViewAsSellerOption = { sellerId: string; userId: string; name: string };

/** The admin's own-tenant sellers that can be previewed (real login + active). */
export async function listViewAsSellers(svc: SupabaseClient, companyBioId: string | null): Promise<ViewAsSellerOption[]> {
  if (!companyBioId) return [];
  const { data } = await svc
    .from("sellers")
    .select("id, name, user_id, active")
    .eq("company_bio_id", companyBioId)
    .eq("active", true)
    .not("user_id", "is", null)
    .order("name", { ascending: true });
  const rows = (data ?? []) as SellerRow[];
  return rows
    .filter(s => s.user_id)
    .map(s => ({ sellerId: s.id, userId: s.user_id as string, name: s.name ?? "Seller" }));
}
