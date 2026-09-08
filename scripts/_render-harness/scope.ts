// TEST STUB — replaces @/lib/scope for the render harness ONLY, via
// tsconfig.render.json path mapping. Production code is untouched: nothing
// here is reachable from the app build.
//
// getUserScope() reads an auth session from cookies, which a script has no
// way to produce. The ONLY thing the dashboard takes from the scope is the
// tenant id, so the harness supplies it directly and every other line of
// lib/dashboard-data.ts runs exactly as it does in the page.
export type UserScope = {
  userId: string | null; role: string | null; tier: string | null;
  companyBioId: string | null; isScoped: boolean;
  isDemoMode: boolean; demoBioId: string | null;
};

export const DEMO_SESSION_COOKIE = "demo_session_bio_id";

export async function getUserScope(): Promise<UserScope> {
  const bio = process.env.HARNESS_TENANT_ID ?? null;
  return {
    userId: "harness", role: "admin", tier: "owner",
    companyBioId: bio, isScoped: !!bio, isDemoMode: false, demoBioId: null,
  };
}
export async function requireScope() { return getUserScope(); }
export async function getMyAssignedUserId(): Promise<string | null> { return null; }
export async function getMyAssignedLeadIds(): Promise<string[] | null> { return null; }
