"use client";

// ─── AuthContext ──────────────────────────────────────────────────────────
// Single source of truth for the logged-in user payload from /api/auth/me.
// Replaces the prior pattern where Sidebar, TopHeader, DemoBanner, /icp,
// /accounts, /voice etc. each fired their own fetch("/api/auth/me") on mount,
// causing 4-6 duplicate round-trips per navigation (~600-1500ms overhead).
//
// Behavior:
//   - First mount → 1 fetch, cached in context state
//   - Subsequent reads → synchronous, no network
//   - `visibilitychange` (tab refocus) → re-fetch in background to catch any
//     role/tenant change while the tab was idle
//   - Supabase auth events (SIGNED_IN/OUT) → re-fetch immediately
//   - 401 from /api/auth/me → handleAuthFailure() → signOut + redirect
//   - clearAuth() → exposed for demo-mode toggles, but enter/exit demo
//     already does window.location.assign("/") so a manual call is rarely
//     needed in practice
//
// Risk profile vs the prior per-component fetching:
//   - Cookie-based session changes propagate via the visibility listener and
//     Supabase auth events. The hard navigation that happens on enter/exit
//     demo also fully re-mounts the provider, getting a fresh fetch.
//   - We're STRICTLY safer than before: previously each component had its
//     own cached state and could be inconsistent during transitions.

import { createContext, useCallback, useContext, useEffect, useState, useRef } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { handleAuthFailure } from "@/lib/session-cache";

export type AuthUser = {
  id: string;
  email?: string;
  displayName?: string;
  role: "admin" | "client" | string;
  companyBioId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
};

export type DemoMode =
  | { active: false }
  | { active: true; bioId: string; companyName: string | null; logoUrl: string | null };

type AuthState = {
  user: AuthUser | null;
  demoMode: DemoMode;
  loading: boolean;
  /** Force a refetch from /api/auth/me — useful after a mutation that changes role/tenant. */
  refetch: () => Promise<void>;
  /** Drop the in-memory cache. Caller is responsible for triggering a re-render
   *  after (a refetch or a hard nav). */
  clearAuth: () => void;
};

const AuthContext = createContext<AuthState>({
  user: null,
  demoMode: { active: false },
  loading: true,
  refetch: async () => {},
  clearAuth: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [demoMode, setDemoMode] = useState<DemoMode>({ active: false });
  const [loading, setLoading] = useState(true);
  // Track in-flight fetch so concurrent triggers (mount + visibilitychange)
  // don't fire two requests at once.
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchAuth = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.status === 401) {
          setUser(null);
          setDemoMode({ active: false });
          handleAuthFailure();
          return;
        }
        if (!res.ok) {
          setUser(null);
          setDemoMode({ active: false });
          return;
        }
        const data = await res.json();
        setUser(data.user ?? null);
        setDemoMode(data.demoMode ?? { active: false });
      } catch {
        // Network errors — keep last-known user, don't blow up the UI.
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, []);

  // Initial load.
  useEffect(() => { fetchAuth(); }, [fetchAuth]);

  // Refetch when the tab becomes visible again — catches role/tenant changes
  // that happened in another tab or while idle.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchAuth();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fetchAuth]);

  // React to Supabase auth events (sign-in/out, token refresh) so the context
  // updates the moment auth state changes, not on the next navigation.
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setDemoMode({ active: false });
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        fetchAuth();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchAuth]);

  const clearAuth = useCallback(() => {
    setUser(null);
    setDemoMode({ active: false });
  }, []);

  return (
    <AuthContext.Provider value={{ user, demoMode, loading, refetch: fetchAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Convenience: returns just the user (or null when loading). Equivalent to
 *  the per-component pattern of `const [user, setUser] = useState(null)
 *  + fetch /api/auth/me on mount`. */
export function useAuthUser(): AuthUser | null {
  return useContext(AuthContext).user;
}
