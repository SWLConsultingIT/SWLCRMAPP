"use client";

// Shared in-memory cache + auth-failure handler used by ThemeProvider,
// LocaleProvider, and BrandProvider. Replaces the per-mount fetch pattern
// introduced in commit c99d344 that traded a tenant-leak fix for a navigation
// perf regression (3 sequential API calls fired on every pathname change).
//
// Behavior:
//   - GET /api/settings/prefs and /api/settings/branding are cached in memory
//     for TTL_MS milliseconds (default 60s). Subsequent reads within the TTL
//     hit the cache and return synchronously after the first await tick.
//   - On 401 from either endpoint, we call handleAuthFailure() exactly ONCE
//     across the page lifecycle: signOut + redirect to /login?reason=
//     session-expired. Replaces the previous silent .catch(() => {}) which
//     left users in a "ghost-logged-in" state until their next navigation.
//   - clearAllSessionCache() must be called on every auth state change so a
//     tenant switch in the same browser tab can't read the previous user's
//     theme / locale / brand from the cache. This preserves the c99d344
//     anti-leak invariant while restoring the perf cache.

import { getSupabaseBrowser } from "@/lib/supabase-browser";

const TTL_MS = 60_000;

type Cache<T> = { value: T | null; fetchedAt: number };

let prefsCache: Cache<{ theme?: string; locale?: string }> = { value: null, fetchedAt: 0 };
let brandCache: Cache<{ primary_color?: string; use_brand_colors?: boolean }> = { value: null, fetchedAt: 0 };

let signingOut = false;

/**
 * Triggered when any cached fetch returns a 401. Signs the user out and
 * redirects to /login with a query param so the login page can show a toast.
 * Guarded by a module-level flag so concurrent 401s from multiple providers
 * don't fire signOut three times in parallel.
 */
export async function handleAuthFailure(): Promise<void> {
  if (signingOut || typeof window === "undefined") return;
  signingOut = true;
  try {
    await getSupabaseBrowser().auth.signOut();
  } catch {
    /* ignore — we still redirect below */
  }
  window.location.href = "/login?reason=session-expired";
}

export function clearAllSessionCache(): void {
  prefsCache = { value: null, fetchedAt: 0 };
  brandCache = { value: null, fetchedAt: 0 };
}

export async function fetchPrefsCached(): Promise<{ theme?: string; locale?: string } | null> {
  if (prefsCache.value && Date.now() - prefsCache.fetchedAt < TTL_MS) {
    return prefsCache.value;
  }
  try {
    const res = await fetch("/api/settings/prefs", { cache: "no-store" });
    if (res.status === 401) {
      handleAuthFailure();
      return null;
    }
    if (!res.ok) return null;
    const d = await res.json();
    prefsCache = { value: d, fetchedAt: Date.now() };
    return d;
  } catch {
    return null;
  }
}

export async function fetchBrandingCached(): Promise<{ primary_color?: string; use_brand_colors?: boolean } | null> {
  if (brandCache.value && Date.now() - brandCache.fetchedAt < TTL_MS) {
    return brandCache.value;
  }
  try {
    const res = await fetch("/api/settings/branding", { cache: "no-store" });
    if (res.status === 401) {
      handleAuthFailure();
      return null;
    }
    if (!res.ok) return null;
    const d = await res.json();
    brandCache = { value: d, fetchedAt: Date.now() };
    return d;
  } catch {
    return null;
  }
}
