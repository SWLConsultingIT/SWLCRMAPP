import { cache } from "react";
import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

/** Cookie name for admin "demo impersonation". When set, an admin user
 * sees the app as if they belonged to a specific (is_demo=true) tenant. */
export const DEMO_SESSION_COOKIE = "demo_session_bio_id";

/** Cookie name for the multi-tenant switcher. Any user (super_admin, owner,
 * or otherwise) can switch their active tenant if they have a membership in
 * it. Falls back to `user_profiles.company_bio_id` when unset. Distinct from
 * DEMO_SESSION_COOKIE because demo impersonation is admin-only and pretends
 * to be `client` role; this cookie keeps the real role intact. */
export const ACTIVE_TENANT_COOKIE = "active_tenant_bio_id";

/**
 * RBAC tiers (from migration 010, 2026-05-04).
 * - super_admin: SWL ops, cross-tenant. Sees /admin/* SWL views.
 * - owner: full per-tenant admin. Manages team + settings. Does NOT see SWL /admin views.
 * - manager: tenant-wide read/write but no team management.
 * - seller: only own assigned leads + campaigns.
 * - viewer: read-only across the tenant.
 */
export type Tier = "super_admin" | "owner" | "manager" | "seller" | "viewer";

export type UserScope = {
  userId: string | null;
  /** Legacy binary role. Kept for backwards-compat during migration. Prefer `tier`. */
  role: "admin" | "client" | null;
  /** RBAC tier. Source of truth going forward. */
  tier: Tier | null;
  companyBioId: string | null;
  /** True when queries must be filtered to a specific company. False = admin / no user (see everything). */
  isScoped: boolean;
  /** Admin is currently impersonating a demo tenant via the cookie override. */
  isDemoMode: boolean;
  /** When `isDemoMode`, this is the demo tenant's bio id (mirror of companyBioId for clarity). */
  demoBioId: string | null;
};

// ── RBAC helpers ────────────────────────────────────────────────────────────
// Use these instead of comparing tiers directly so business rules stay
// readable and centralized. Adding a new tier means updating these helpers
// in one place.

/** SWL-only super-admin views (cross-tenant ops, /admin/[id], /admin/reliability, etc). */
export function canViewSwlAdmin(tier: Tier | null): boolean {
  return tier === "super_admin";
}

/** Sees the unified "Admin" sidebar item — super_admin sees SWL view, owner/manager see their tenant view. */
export function canViewAdminMenu(tier: Tier | null): boolean {
  return tier === "super_admin" || tier === "owner" || tier === "manager";
}

/** Invite users, assign roles, remove team members. */
export function canManageTeam(tier: Tier | null): boolean {
  return tier === "super_admin" || tier === "owner";
}

/** Edit tenant-wide settings (branding, integrations, ICPs). */
export function canEditTenantSettings(tier: Tier | null): boolean {
  return tier === "super_admin" || tier === "owner";
}

/** Read all leads + campaigns within the tenant (vs only own assigned). */
export function canViewAllTenantData(tier: Tier | null): boolean {
  return tier === "super_admin" || tier === "owner" || tier === "manager";
}

/** Create campaigns. Sellers can — but only for their own assigned leads (enforced server-side at create time). */
export function canCreateCampaigns(tier: Tier | null): boolean {
  return tier !== "viewer" && tier !== null;
}

/** Approve campaigns (the gate currently held by `role === "admin"`). */
export function canApproveCampaigns(tier: Tier | null): boolean {
  return tier === "super_admin" || tier === "owner" || tier === "manager";
}

/**
 * For a user with tier='seller', return the seller record IDs they're linked
 * to (via `sellers.user_id`). Used by /leads, /queue, /campaigns to apply a
 * `seller_id IN (...)` filter so the seller only sees their assigned work.
 *
 * Returns:
 *   - null            → caller is not a seller (no filter needed)
 *   - empty array []  → caller IS a seller but has no links yet (show nothing)
 *   - [id, id, ...]   → filter by these seller IDs
 *
 * Wrapped in React.cache so multiple components reading this in the same
 * request share one DB lookup.
 */
export const getMyAssignedSellerIds = cache(async function getMyAssignedSellerIds(): Promise<string[] | null> {
  const scope = await getUserScope();
  if (scope.tier !== "seller") return null;
  if (!scope.userId) return [];
  const svc = getSupabaseService();
  const { data } = await svc
    .from("sellers")
    .select("id")
    .eq("user_id", scope.userId);
  return (data ?? []).map(r => r.id as string);
});

/**
 * Resolves the current user's tenancy scope.
 * - Admins see everything across all clients UNLESS they've entered a demo
 *   tenant — in which case the cookie forces scope to that bio_id.
 * - Clients see only data for their company_bio_id (cookie ignored).
 * - Unauthenticated requests behave like admins (server components called with no user context).
 *
 * Wrapped with React's `cache` so multiple server components calling
 * `getUserScope()` during the same request share a single resolution.
 * Without this, every page that calls it in three places (page header,
 * data fetcher, sidebar query) ran `auth.getUser()` + `user_profiles`
 * fetch three times.
 */
export const getUserScope = cache(async function getUserScope(): Promise<UserScope> {
  const supabase = await getSupabaseServer();
  // Defensive: when the refresh token has been rotated/expired, supabase-ssr
  // throws AuthApiError("Invalid Refresh Token") instead of returning a clean
  // null user. Treat that as "not logged in" so server components don't crash
  // with a stale-cookie issue. The browser layer (lib/session-cache) already
  // handles the user-visible "session expired" flow.
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }
  if (!user) {
    return { userId: null, role: null, tier: null, companyBioId: null, isScoped: false, isDemoMode: false, demoBioId: null };
  }

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("role, tier, company_bio_id, company_bios(archived_at)")
    .eq("user_id", user.id)
    .single();

  const role = (profile?.role ?? "client") as "admin" | "client";
  // tier was backfilled in migration 010 from role; defensive fallback in case
  // a row is missing it (shouldn't happen, but null-safe).
  const tier: Tier = (profile?.tier as Tier | undefined)
    ?? (role === "admin" ? "super_admin" : "owner");

  // If the user's bio has been archived, treat them as if they had no scope —
  // they shouldn't be able to operate within a soft-deleted tenant. Super
  // admins still see the archived bio in /admin/recovery to restore it.
  const rawBios = (profile as unknown as { company_bios?: unknown })?.company_bios;
  const bioRow = Array.isArray(rawBios) ? rawBios[0] : rawBios;
  const bioArchived = !!(bioRow as { archived_at?: string | null } | null)?.archived_at;
  const ownBioId = bioArchived ? null : (profile?.company_bio_id ?? null);

  // Demo impersonation only applies to SWL SUPER_ADMINS. The earlier check
  // `role === "admin"` was too permissive — any tenant owner (which also
  // carries role='admin' from the legacy column) hit the demo branch and,
  // if a stale demo cookie was lying around, got silently impersonated
  // into another tenant. Cross-tenant leak class. The Pending Calls /
  // Queue tabs of an SWL admin showing Pathway leads on 2026-05-13 was
  // exactly this. Gate strictly on tier='super_admin' going forward.
  if (tier === "super_admin") {
    const cookieStore = await cookies();
    const demoBioId = cookieStore.get(DEMO_SESSION_COOKIE)?.value ?? null;
    if (demoBioId) {
      const { data: demoBio } = await svc
        .from("company_bios")
        .select("id, is_demo")
        .eq("id", demoBioId)
        .eq("is_demo", true)
        .maybeSingle();
      if (demoBio?.id) {
        // Faking the role as "client" here is the whole trick: every
        // `role === "admin"` gate in the app (Sidebar adminOnly filter,
        // /admin route guards, admin API endpoints) auto-hides without a
        // single per-page change. Real admin role returns the moment the
        // cookie is cleared via /api/admin/demos/exit. The DemoBanner reads
        // `isDemoMode` (independent of role) to keep the persistent Exit
        // button visible.
        // Demo impersonation: act as `owner` of the demo tenant. Same effect
        // as a tenant admin entering their own workspace — full visibility
        // within the demo bio, no SWL super_admin views.
        return {
          userId: user.id,
          role: "client",
          tier: "owner",
          companyBioId: demoBio.id,
          isScoped: true,
          isDemoMode: true,
          demoBioId: demoBio.id,
        };
      }
    }
  }

  // Multi-tenant switcher: if the user has explicitly switched to a tenant
  // (via TenantSwitcher → /api/auth/switch-tenant), honor that. We validate
  // the membership server-side here so a tampered cookie can't grant access
  // to a tenant the user doesn't belong to.
  const cookieStore = await cookies();
  const activeCookie = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  if (activeCookie && activeCookie !== ownBioId) {
    const { data: membership } = await svc
      .from("user_company_memberships")
      .select("company_bio_id, tier, company_bios(archived_at, is_demo)")
      .eq("user_id", user.id)
      .eq("company_bio_id", activeCookie)
      .maybeSingle();
    const memBio = (membership as { company_bios?: { archived_at?: string | null; is_demo?: boolean } | { archived_at?: string | null; is_demo?: boolean }[] } | null)?.company_bios;
    const memBioRow = Array.isArray(memBio) ? memBio[0] : memBio;
    if (membership && !memBioRow?.archived_at) {
      const switchedTier = (membership.tier as Tier | undefined) ?? tier;
      return {
        userId: user.id,
        role: switchedTier === "super_admin" ? "admin" : "client",
        tier: switchedTier,
        companyBioId: activeCookie,
        isScoped: true,
        isDemoMode: false,
        demoBioId: null,
      };
    }
  }

  // Admin is scoped to their own bio on operational pages (Dashboard, Leads,
  // Campaigns, Opportunities) so they see SWL data, not a 'cross-tenant
  // firehose' that the previous behavior produced. The cross-tenant view
  // already lives in /admin and /admin/[id], which use the service role
  // directly and bypass this scope. Demo impersonation is handled above
  // and overrides this branch entirely.
  const isScoped = !!ownBioId;
  return { userId: user.id, role, tier, companyBioId: ownBioId, isScoped, isDemoMode: false, demoBioId: null };
});
