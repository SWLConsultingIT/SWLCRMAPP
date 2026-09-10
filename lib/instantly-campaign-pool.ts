// Cached reader for an Instantly campaign's sending pool (`email_list`), plus
// the dispatch-time wrapper around the pure guard in lib/sender-pool.ts.
//
// ── The performance problem this solves ────────────────────────────────────
// dispatch-email processes up to BATCH_SIZE (20) messages per tick, and runs
// them through Promise.all — so a naive "GET the campaign, then check the pool"
// inside dispatchOneEmail would fire 20 concurrent GETs for what is usually the
// SAME two or three campaigns, every 15 minutes, forever. That is a pointless
// multiplier on latency and on Instantly's rate limit.
//
// Two mechanisms fix it:
//
//   * TTL cache keyed by campaign id. The pool only changes when a human edits
//     the campaign in Instantly, so minutes of staleness are fine — and the
//     provision-time check (resolveFlowCampaignId) is the strong gate anyway.
//   * In-flight coalescing. The map stores the PROMISE, not the value, so 20
//     parallel callers on a cold lambda share one request instead of racing.
//
// Net cost at steady state: ~1 extra GET per campaign per TTL window, not one
// per email. A 20-email tick across 2 campaigns goes from 20 extra requests to
// at most 2, and to 0 on a warm lambda inside the window.
//
// ── Failure posture ────────────────────────────────────────────────────────
// A guard that opens when it cannot see is not a guard. If the campaign fetch
// fails we return a BLOCK, not a pass — but cache that negative result only
// briefly, so a transient Instantly 5xx delays a tick rather than wedging the
// queue. Messages blocked this way stay queued and retry.

import { validateSenderPool, type SenderPoolVerdict } from "@/lib/sender-pool";

const BASE = "https://api.instantly.ai/api/v2";
const OK_TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;

export type PoolFetch =
  | { ok: true; emailList: unknown[]; name: string | null; status: number | null }
  | { ok: false; error: string };

type Entry = { expiresAt: number; value: Promise<PoolFetch> };

const cache = new Map<string, Entry>();

/** Drop a campaign's cached pool. Call right after mutating it (e.g. a fresh clone). */
export function invalidateCampaignPool(campaignId: string): void {
  cache.delete(campaignId);
}

/** Test seam — never called from product code. */
export function _resetCampaignPoolCache(): void {
  cache.clear();
}

export function campaignPoolCacheSize(): number {
  return cache.size;
}

async function fetchPoolUncached(apiKey: string, campaignId: string): Promise<PoolFetch> {
  try {
    const res = await fetch(`${BASE}/campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") return { ok: false, error: "unparseable campaign response" };
    const body = json as Record<string, unknown>;
    return {
      ok: true,
      emailList: Array.isArray(body.email_list) ? (body.email_list as unknown[]) : [],
      name: typeof body.name === "string" ? body.name : null,
      status: typeof body.status === "number" ? body.status : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/**
 * Read a campaign's sending pool, coalescing concurrent callers and caching the
 * result. `force` bypasses the cache (used by the audit route, which must always
 * report live state).
 */
export function fetchCampaignPool(apiKey: string, campaignId: string, opts?: { force?: boolean }): Promise<PoolFetch> {
  const now = Date.now();
  if (!opts?.force) {
    const hit = cache.get(campaignId);
    if (hit && hit.expiresAt > now) return hit.value;
  }

  const promise = fetchPoolUncached(apiKey, campaignId).then((result) => {
    // Re-stamp the TTL once we know whether it succeeded: a failure should not
    // be remembered for ten minutes.
    const entry = cache.get(campaignId);
    if (entry && entry.value === promise) {
      entry.expiresAt = Date.now() + (result.ok ? OK_TTL_MS : FAIL_TTL_MS);
    }
    return result;
  });

  cache.set(campaignId, { expiresAt: now + FAIL_TTL_MS, value: promise });
  return promise;
}

/**
 * Full dispatch-time check: read the campaign's pool (cached) and compare it to
 * the tenant's declared `email_accounts`.
 *
 * Returns a verdict from the pure guard, or a synthetic BLOCK verdict when the
 * pool could not be read at all.
 */
export async function verifyCampaignSenderPool(input: {
  apiKey: string;
  campaignId: string;
  declared: unknown;
  force?: boolean;
}): Promise<{ verdict: SenderPoolVerdict; campaignName: string | null; fetched: boolean }> {
  const pool = await fetchCampaignPool(input.apiKey, input.campaignId, { force: input.force });
  if (!pool.ok) {
    return {
      fetched: false,
      campaignName: null,
      verdict: {
        status: "block",
        violations: [],
        expectedCount: Array.isArray(input.declared) ? input.declared.length : 0,
        actualCount: 0,
        reason: `could not read the campaign's sending accounts from Instantly (${pool.error}) — blocking rather than sending unverified`,
      },
    };
  }
  return {
    fetched: true,
    campaignName: pool.name,
    verdict: validateSenderPool({ declared: input.declared, actual: pool.emailList }),
  };
}
