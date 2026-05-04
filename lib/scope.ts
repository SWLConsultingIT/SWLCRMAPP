import { cache } from "react";
import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

/** Cookie name for admin "demo impersonation". When set, an admin user
 * sees the app as if they belonged to a specific (is_demo=true) tenant. */
export const DEMO_SESSION_COOKIE = "demo_session_bio_id";

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
    .select("role, tier, company_bio_id")
    .eq("user_id", user.id)
    .single();

  const role = (profile?.role ?? "client") as "admin" | "client";
  // tier was backfilled in migration 010 from role; defensive fallback in case
  // a row is missing it (shouldn't happen, but null-safe).
  const tier: Tier = (profile?.tier as Tier | undefined)
    ?? (role === "admin" ? "super_admin" : "owner");
  const ownBioId = profile?.company_bio_id ?? null;

  // Demo impersonation only applies to admins. We verify the cookie value
  // points at a real is_demo=true tenant before honoring it — otherwise a
  // stale cookie would silently leak data from a real client tenant.
  if (role === "admin") {
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

  // Admin is scoped to their own bio on operational pages (Dashboard, Leads,
  // Campaigns, Opportunities) so they see SWL data, not a 'cross-tenant
  // firehose' that the previous behavior produced. The cross-tenant view
  // already lives in /admin and /admin/[id], which use the service role
  // directly and bypass this scope. Demo impersonation is handled above
  // and overrides this branch entirely.
  const isScoped = !!ownBioId;
  return { userId: user.id, role, tier, companyBioId: ownBioId, isScoped, isDemoMode: false, demoBioId: null };
});
