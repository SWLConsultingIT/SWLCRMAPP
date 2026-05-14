/**
 * Bounded-parallel async map. Equivalent in shape to `Promise.all(items.map(fn))`
 * but caps concurrency at `limit` so we don't fan out N parallel DB / HTTP
 * calls when N grows.
 *
 * Why we have this: dispatchers (LinkedIn, calls) historically did
 * `Promise.all(activeSellers.map(processSellerBatch))`. At 9 sellers that's
 * ~27 simultaneous Supabase connections; at 30 sellers it's 90, exceeding
 * the 60-direct-conn limit on Micro compute. Reads queue, latency spikes,
 * dispatchers timeout (→ orphaned 'dispatching' rows even with the reaper).
 *
 * Implementation: spawn `min(limit, items.length)` workers that pull from
 * a shared index. Order of results matches the input array. Errors from
 * any worker surface as a rejection of the returned promise — matches
 * `Promise.all` semantics so existing call sites don't need restructuring.
 *
 * If you need `Promise.allSettled` semantics (partial success), wrap each
 * call site in its own try/catch and return a success/failure shape from
 * the mapper. We don't bake that in to keep the helper minimal.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  if (limit < 1) throw new Error("mapLimit: limit must be >= 1");

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
