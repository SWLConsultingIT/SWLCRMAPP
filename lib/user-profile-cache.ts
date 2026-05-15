// Process-level cache for the `user_profiles` row that drives every
// authenticated server-side request via getUserScope(). Without this, the
// proxy + every server component fires a fresh SELECT on user_profiles per
// request — that table was getting ~10 reads/sec across the cluster and
// contributed to the disk-IO saturation that took the DB down on 2026-05-15.
//
// Caching strategy:
// - Keyed by user_id (uuid). The cached value is the raw SELECT row used by
//   getUserScope to derive role/tier/companyBioId.
// - TTL = 60s. Long enough to absorb burst navigation by a single user;
//   short enough that a role/tenant change becomes visible after a minute
//   even if invalidation was forgotten somewhere.
// - Per-process (each Vercel worker / Node instance has its own Map). A
//   tenant switch in one worker won't immediately propagate to another, but
//   the 60s TTL bounds the staleness window. If we ever need cross-worker
//   invalidation we'd add Redis — for now this is intentionally simple.
// - Hard cap at 1000 entries to prevent memory leak in long-running workers.
//   Eviction is FIFO (oldest insert wins eviction). With ~22 concurrent
//   users this is wildly oversized; tightening later is fine.
//
// Tenant isolation: the cached row contains company_bio_id, which is the
// scope key. We do NOT cache the result of getUserScope() itself — only the
// raw profile row — so the cookie-driven branches (demo impersonation,
// tenant switcher) still execute fresh each request.

export type CachedProfileRow = {
  role: string | null;
  tier: string | null;
  company_bio_id: string | null;
  // Mirrors the company_bios(archived_at) join used in scope.ts. We cache
  // it together so we don't fall back to a second query when the join shape
  // is what we ultimately need.
  company_bios:
    | { archived_at: string | null }
    | { archived_at: string | null }[]
    | null;
};

type Entry = { value: CachedProfileRow; expires: number };

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;

const store = new Map<string, Entry>();

export function getCachedProfile(userId: string): CachedProfileRow | null {
  const entry = store.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(userId);
    return null;
  }
  return entry.value;
}

export function setCachedProfile(userId: string, value: CachedProfileRow): void {
  store.set(userId, { value, expires: Date.now() + TTL_MS });
  if (store.size > MAX_ENTRIES) {
    // Drop the oldest insert to keep the map bounded. Map iteration order is
    // insertion order, so first key is the oldest.
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
}

/** Call this whenever the user's tier/role/tenant changes server-side. */
export function invalidateProfileCache(userId: string): void {
  store.delete(userId);
}

/** Clear the entire cache. Reserved for tests / explicit admin actions. */
export function clearProfileCache(): void {
  store.clear();
}
