// Single source of truth for which PRIMARY-NAV surfaces are admin-only, i.e.
// require canViewAllTenantData (owner / manager / super_admin). The Sidebar and
// the Command Palette both gate on this so the two can never drift.
//
// Lead Miner (/icp) is a SELLER tool and must NEVER be listed here: during the
// "View as Seller" nav-parity pass it was wrongly bundled admin-only, which hid
// it from — and server-blocked it for — real sellers (P0, 2026-09-14). Sellers
// (and an admin previewing as one) must see and reach Lead Miner exactly like an
// admin does; only tenant-configuration surfaces (Company Bio, Admin) are gated.

export const ADMIN_ONLY_ROUTES = ["/company-bios", "/admin"] as const;

/** True only for tenant-config surfaces that require all-tenant (admin) access.
 *  Matches by route prefix so nested paths (e.g. /admin/[id]) are covered. */
export function isAdminOnlyRoute(href: string): boolean {
  return (ADMIN_ONLY_ROUTES as readonly string[]).some(r => href === r || href.startsWith(r + "/"));
}
