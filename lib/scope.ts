import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

/** Cookie name for admin "demo impersonation". When set, an admin user
 * sees the app as if they belonged to a specific (is_demo=true) tenant. */
export const DEMO_SESSION_COOKIE = "demo_session_bio_id";

export type UserScope = {
  userId: string | null;
  role: "admin" | "client" | null;
  companyBioId: string | null;
  /** True when queries must be filtered to a specific company. False = admin / no user (see everything). */
  isScoped: boolean;
  /** Admin is currently impersonating a demo tenant via the cookie override. */
  isDemoMode: boolean;
  /** When `isDemoMode`, this is the demo tenant's bio id (mirror of companyBioId for clarity). */
  demoBioId: string | null;
};

/**
 * Resolves the current user's tenancy scope.
 * - Admins see everything across all clients UNLESS they've entered a demo
 *   tenant — in which case the cookie forces scope to that bio_id.
 * - Clients see only data for their company_bio_id (cookie ignored).
 * - Unauthenticated requests behave like admins (server components called with no user context).
 */
export async function getUserScope(): Promise<UserScope> {
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
    return { userId: null, role: null, companyBioId: null, isScoped: false, isDemoMode: false, demoBioId: null };
  }

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("role, company_bio_id")
    .eq("user_id", user.id)
    .single();

  const role = (profile?.role ?? "client") as "admin" | "client";
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
        return {
          userId: user.id,
          role: "client",
          companyBioId: demoBio.id,
          isScoped: true,
          isDemoMode: true,
          demoBioId: demoBio.id,
        };
      }
    }
  }

  const isScoped = role !== "admin" && !!ownBioId;
  return { userId: user.id, role, companyBioId: ownBioId, isScoped, isDemoMode: false, demoBioId: null };
}
