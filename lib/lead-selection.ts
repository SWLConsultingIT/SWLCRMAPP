// Hand a lead selection from a picker to the flow wizard.
//
// WHY THIS EXISTS
// Every entry point into /campaigns/new/[profileId] used to pass the selection
// as `?leads=<uuid>,<uuid>,…`. At 37 bytes per UUID that URL grows fast, and
// Vercel rejects a request URL over ~14 KB with **414 URI_TOO_LONG** — a blank
// error page, before the app ever runs. The ceiling lands at ~385 leads.
//
// It went from theoretical to blocking on 2026-08-25, when an import took the
// SWL "Private Equity & VC Firms — USA" ICP from 201 to 1 166 leads: one click
// on "Select all" built a 42 KB URL and a seller got the 414. Three other ICPs
// were already over the line (Pathway 1 349, De Vera 1 260, SWL Spanish
// Speaking 398) and Grupo IEB sits at 314, i.e. 71 leads away.
//
// So: small selections stay in the URL exactly as before — refreshes, shared
// links and back/forward all keep working. Large ones go through sessionStorage
// and the URL only carries a sentinel plus the count.
//
// The write and the URL are split into two functions on purpose. Two call
// sites build a `<Link href>` during render, where touching sessionStorage
// would be a render side effect and would differ between the server and client
// renders (hydration mismatch). Those stash from a useEffect and use the pure
// `leadSelectionQuery` for the href.

/** Selections at or below this many ids stay inline in the URL.
 *  200 × 37 B ≈ 7.4 KB, comfortably under the 14 KB ceiling even with the rest
 *  of the query string, and it keeps the shareable-link behaviour at the sizes
 *  people actually share. */
export const INLINE_LEAD_LIMIT = 200;

/** Marks `?leads=` as "the ids are in sessionStorage, not here". */
export const STASH_SENTINEL = "stashed";

function storageKey(profileId: string): string {
  return `swl-flow-leads:${profileId}`;
}

/** True when this selection is too big to travel in the URL. */
export function needsStash(ids: string[]): boolean {
  return ids.length > INLINE_LEAD_LIMIT;
}

/**
 * The query string (no leading `?`) for a selection. PURE — safe to call
 * during render and on the server. When the selection is large this returns
 * the sentinel, so the caller MUST have stashed the ids (see stashLeadSelection).
 */
export function leadSelectionQuery(ids: string[]): string {
  if (ids.length === 0) return "";
  if (!needsStash(ids)) return `leads=${ids.join(",")}`;
  // `n` is display-only (the wizard shows "N leads to assign" before it reads
  // the ids) and it makes the URL self-describing in logs.
  return `leads=${STASH_SENTINEL}&n=${ids.length}`;
}

/** Persists a large selection so `leadSelectionQuery`'s sentinel can resolve.
 *  No-op for small selections. Client-only. */
export function stashLeadSelection(profileId: string, ids: string[]): void {
  if (!needsStash(ids)) return;
  try {
    window.sessionStorage.setItem(storageKey(profileId), JSON.stringify(ids));
  } catch {
    // Private mode / storage disabled / quota. The wizard will report the
    // selection as lost and send the user back to the picker, which beats
    // silently creating a flow with no leads.
  }
}

/**
 * Reads the selection back inside the wizard. `param` is the raw `?leads=`
 * value. Returns [] when a stashed selection can't be found — callers must
 * treat that as "selection lost", NOT "no leads chosen" (see
 * `isLeadSelectionLost`), or they would silently create an empty flow.
 */
export function readLeadSelection(profileId: string, param: string | null): string[] {
  if (!param) return [];
  if (param !== STASH_SENTINEL) return param.split(",").filter(Boolean);
  try {
    const raw = window.sessionStorage.getItem(storageKey(profileId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && !!x)
      : [];
  } catch {
    return [];
  }
}

/** True when the URL says a stashed selection exists but we can't read it —
 *  a new tab, a shared link, or cleared storage. */
export function isLeadSelectionLost(profileId: string, param: string | null): boolean {
  return param === STASH_SENTINEL && readLeadSelection(profileId, param).length === 0;
}

/** Drop the stash once the flow request is submitted, so a later visit to the
 *  wizard doesn't resurrect a stale selection. */
export function clearLeadSelection(profileId: string): void {
  try { window.sessionStorage.removeItem(storageKey(profileId)); } catch { /* ignore */ }
}
