// Client-side mirror of the SERVER-VALIDATED `viewAs.active` flag.
//
// The authoritative read-only enforcement is server-side: proxy.ts refuses
// every mutating /api/* call while the view-as cookie is set. But a handful of
// pages write to Supabase DIRECTLY from the browser (bypassing /api entirely),
// so those need a client-side block too. Rather than re-parse a cookie (the
// view-as cookie is HttpOnly and unreadable here), we mirror the flag off the
// exact same /api/auth/me payload that drives the banner and control — set once
// by AuthProvider whenever it (re)fetches auth. getSupabaseBrowser() reads it
// to refuse table mutations during a seller preview.
//
// This is a UX/read-only guard for the admin's own session, NOT a security
// boundary — the server /api block + RLS are the real boundaries, and a forged
// value only ever affects the actor's own writes (never an escalation).

let active = false;

/** Called by AuthProvider on every auth (re)fetch with viewAs.active. */
export function setViewAsActive(v: boolean): void {
  active = v;
}

/** True while this browser session is previewing the app as a seller. */
export function isViewAsActive(): boolean {
  return active;
}
