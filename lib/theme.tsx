"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchPrefsCached, clearAllSessionCache } from "@/lib/session-cache";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "light", setTheme: () => {} });

// Theme persists in two places:
//   1. user_profiles.theme — source of truth, fetched on auth + tenant switch
//   2. swl-theme cookie    — SSR cache so the server can paint <html data-theme="dark">
//                            on the first byte, eliminating the light→dark flash
//
// We deliberately do NOT use localStorage: it caused stale-theme flashes for the
// next user when accounts switched. The cookie is cleared on every auth state
// change so a fresh login pulls the correct theme from the DB.
const THEME_COOKIE = "swl-theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function readThemeCookie(): Theme | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)swl-theme=(light|dark)/);
  return m ? (m[1] as Theme) : null;
}

function writeThemeCookie(t: Theme) {
  try {
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {}
}

// Legacy localStorage key — wiped once on first mount to evict any stale entries
// from older builds. Safe to remove this helper after a few releases.
function purgeLegacyLocalStorage() {
  try {
    localStorage.removeItem("swl-theme");
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("swl-theme-")) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

function applyDom(t: Theme) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initial state mirrors whatever the SSR layout already painted (driven by
  // the cookie). Reading the cookie here keeps React state in sync with the
  // DOM that was sent on the first byte — no flash.
  const [theme, setThemeState] = useState<Theme>(() => readThemeCookie() ?? "light");

  useEffect(() => {
    let alive = true;
    purgeLegacyLocalStorage();

    async function pullThemeFromDb() {
      const d = await fetchPrefsCached();
      if (!alive || !d) return;
      const dbTheme: Theme = d.theme === "dark" ? "dark" : "light";
      // Only touch the DOM if it actually differs — prevents needless attribute
      // mutations and any consequent style recalculation flash.
      const current = readThemeCookie();
      if (current !== dbTheme) {
        applyDom(dbTheme);
        writeThemeCookie(dbTheme);
        setThemeState(dbTheme);
      } else if (theme !== dbTheme) {
        setThemeState(dbTheme);
      }
    }

    pullThemeFromDb();

    // Re-pull on any auth change. We wipe the in-memory prefs cache so the
    // next user's theme is fetched fresh, but we DO NOT clear the cookie or
    // force light — the GET /api/settings/prefs response will overwrite the
    // cookie server-side once the new user's theme resolves, and only then
    // do we mutate the DOM. Forcing light here was the source of the visible
    // light→dark flash users reported on tenant switch / demo exit.
    let unsub: (() => void) | null = null;
    try {
      const sb = getSupabaseBrowser();
      const { data } = sb.auth.onAuthStateChange(() => {
        clearAllSessionCache();
        pullThemeFromDb();
      });
      unsub = () => data.subscription.unsubscribe();
    } catch {}

    return () => { alive = false; unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Belt-and-braces: keep `<html data-theme>` in sync with React state.
  // pullThemeFromDb's "cookie matches DB but state differs" branch updates state
  // without touching the DOM, so the cards could render light while the toggle
  // showed dark. This effect closes that gap on every state change.
  useEffect(() => { applyDom(theme); }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
    applyDom(t);
    writeThemeCookie(t);
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
