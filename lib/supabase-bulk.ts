// Reading more rows than PostgREST will hand over in one response, and
// filtering by more ids than fit in a URL.
//
// Two limits keep producing the same silent wrong answer in this codebase:
//
//   1. A response is capped at 1000 rows (max_rows). Asking for more doesn't
//      error — it truncates. `.range(0, 49999)` does NOT lift it. The only
//      way through is pages of ≤1000 WITH an ORDER BY; without an order,
//      page boundaries can repeat and drop rows.
//
//   2. `.in("col", ids)` puts the whole list in the query string. Measured
//      against this project: 1000 uuids is a ~36 KB filter and Supabase
//      answers 400; 300 (~10 KB) is fine. A 400 leaves `data` null, and
//      every call site so far treated null as "no matches" — so the page
//      rendered zeros instead of failing.
//
// Between them they have produced: duplicate leads on import, a truncated
// /results, 241 invites stuck unexpired, skip-stale-calls timing out, the
// flow wizard reading 1000 of 1166 leads, approve enrolling 1000 and
// dropping 166, the picker offering 500, and the Lead Miner profile showing
// "1000 leads · 0 in a flow" for an ICP where all 1166 are in one.
//
// Use these instead of hand-rolling the loop again.

/** Anything shaped like a PostgREST filter builder we can page over. */
type Pageable<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
};

export const PAGE_SIZE = 1000;
/** Ids per `.in()` filter. 300 uuids ≈ 10 KB of query string. */
export const ID_CHUNK = 300;

export class BulkReadError extends Error {
  constructor(public table: string, public cause: unknown) {
    super(`bulk read of "${table}" failed: ${describe(cause)}`);
    this.name = "BulkReadError";
  }
}

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/**
 * Read every row a query matches, in pages.
 *
 * `makeQuery` must apply an ORDER BY — pass a stable, unique-ish column (`id`
 * works) or pages can overlap. It's a factory rather than a builder because a
 * PostgREST builder can only be awaited once.
 *
 * Throws on a failed page rather than returning what it managed to read: a
 * short list here becomes a wrong number on screen, which is the failure mode
 * this module exists to stop.
 */
export async function selectAllPages<T>(
  table: string,
  makeQuery: () => Pageable<T>,
  opts?: { maxRows?: number },
): Promise<T[]> {
  const maxRows = opts?.maxRows ?? 100_000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new BulkReadError(table, error);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Read every row whose `column` is one of `ids`, chunking the filter so the
 * URL stays short and paging each chunk so a chunk can't be truncated.
 *
 * `makeQuery(chunk)` should apply the `.in()` and any extra filters, and an
 * ORDER BY for the same reason as above.
 */
export async function selectByIds<T>(
  table: string,
  ids: string[],
  makeQuery: (chunk: string[]) => Pageable<T>,
  opts?: { chunkSize?: number },
): Promise<T[]> {
  const size = opts?.chunkSize ?? ID_CHUNK;
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += size) {
    const chunk = unique.slice(i, i + size);
    out.push(...(await selectAllPages<T>(table, () => makeQuery(chunk))));
  }
  return out;
}
