// Route-level auth + tenant-isolation guard.
//
// Almost every /api route uses the service-role key (RLS bypassed), so each
// one must enforce its own auth and tenant check. Historically that was done
// by inlining `getUserScope()` + `if (!scope.userId) 401` + a
// `company_bio_id` comparison — and ~25 mutating/PII routes simply forgot,
// producing cross-tenant IDOR. This module centralizes the pattern so a route
// can't silently ship without it.
//
// LOCAL PREVIEW: mirrors the proxy.ts bypass. When the no-auth local front is
// on there is no session, so `getUserScope()` returns a null user and every
// guard would 401 — breaking local dev. `isPreviewNoAuth()` short-circuits the
// guard in that exact case ONLY. It is hard-disabled in production
// (NODE_ENV === "production"), identical to the proxy guard, so it can never
// weaken a real deployment.

import { NextResponse } from "next/server";
import { getUserScope, type UserScope } from "@/lib/scope";

/** True only in local dev preview mode (front-without-backend). Never true in
 *  production — the NODE_ENV check makes the flag inert even if the
 *  NEXT_PUBLIC env leaks into a prod bundle. Keep in lockstep with proxy.ts. */
export function isPreviewNoAuth(): boolean {
  return (
    process.env.NEXT_PUBLIC_PREVIEW_NO_AUTH === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

export type ScopeGuard =
  | { ok: true; scope: UserScope | null; preview: boolean }
  | { ok: false; response: NextResponse };

/**
 * Require a logged-in user. On success returns the resolved `scope`
 * (or `null` in preview mode); on failure returns a ready-to-return 401.
 *
 *   const g = await requireUser();
 *   if (!g.ok) return g.response;
 *   const { scope } = g;
 */
export async function requireUser(): Promise<ScopeGuard> {
  if (isPreviewNoAuth()) return { ok: true, scope: null, preview: true };
  const scope = await getUserScope();
  if (!scope.userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, scope, preview: false };
}

/**
 * Assert that a row belongs to the caller's tenant. Returns a 403 response to
 * return, or `null` when access is allowed.
 *
 * Convention (matches the well-gated routes):
 *  - `scope === null`  → preview mode, allow.
 *  - `!scope.isScoped` → super_admin / all-tenant viewer, allow (bypass).
 *  - otherwise the row's owning bio id must equal the caller's `companyBioId`.
 *
 * `rowBioId` is the OWNING tenant's company_bio_id. For resources shared across
 * tenants (e.g. sellers via `shared_with_company_bio_ids`), pass the owner id
 * so that only the owner can mutate; pass shared ids to `allowSharedWith`
 * when read/use by a sharee is acceptable.
 */
export function assertTenant(
  scope: UserScope | null,
  rowBioId: string | null | undefined,
  allowSharedWith?: readonly (string | null | undefined)[] | null
): NextResponse | null {
  if (!scope) return null; // preview mode
  if (!scope.isScoped) return null; // super_admin / all-tenant viewer

  if (rowBioId && rowBioId === scope.companyBioId) return null;
  if (allowSharedWith && allowSharedWith.some((b) => b === scope.companyBioId)) {
    return null;
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
