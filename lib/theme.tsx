"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchPrefsCached, clearAllSessionCache } from "@/lib/session-cache";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "light", setTheme: () => {} });

// Theme lives in user_profiles.theme. We deliberately do NOT cache in
// localStorage — caching across account switches caused stale theme to flash
// for the next user. Instead we read through an in-memory cache (lib/session-
// cache.ts) with a short TTL that is cleared on every auth state change. This
// preserves the no-leak invariant while avoiding the per-navigation API
// round-trip that was causing the post-c99d344 navigation lag.
const LEGACY_KEY = "swl-theme";

function clearLegacyThemeCache() {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_KEY + "-")) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    let alive = true;

    function applyDom(t: Theme) {
      if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
    }

    async function pullThemeFromDb() {
      const d = await fetchPrefsCached();
      if (!alive || !d) return;
      const dbTheme: Theme = d.theme === "dark" ? "dark" : "light";
      setThemeState(dbTheme);
      applyDom(dbTheme);
    }

    // Reset on mount: clear legacy localStorage cache + DOM, refetch from DB
    // (or from in-memory cache if fresh).
    clearLegacyThemeCache();
    applyDom("light");
    pullThemeFromDb();

    // Re-pull on any auth change. We also wipe the shared session cache so a
    // tenant switch in the same tab cannot leak previous values.
    let unsub: (() => void) | null = null;
    try {
      const sb = getSupabaseBrowser();
      const { data } = sb.auth.onAuthStateChange((_event) => {
        clearAllSessionCache();
        clearLegacyThemeCache();
        applyDom("light");
        pullThemeFromDb();
      });
      unsub = () => data.subscription.unsubscribe();
    } catch {}

    return () => { alive = false; unsub?.(); };
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    // Optimistic local update + invalidate cache so the next pull reflects it.
    clearAllSessionCache();
    fetch("/api/settings/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: t }),
    }).catch(() => {});
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
