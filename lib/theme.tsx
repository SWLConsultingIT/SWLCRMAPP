"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "light", setTheme: () => {} });

// Theme lives in user_profiles.theme. We deliberately do NOT cache in
// localStorage — caching across account switches caused stale theme to
// flash for the next user. We re-pull on every mount and on every auth
// state change. The 200ms FOUC is preferable to theme bleed across accounts.
const LEGACY_KEY = "swl-theme";

function clearAllThemeCache() {
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
      try {
        const res = await fetch("/api/settings/prefs", { cache: "no-store" });
        if (!res.ok) return;
        const d = await res.json();
        if (!alive) return;
        const dbTheme: Theme = d.theme === "dark" ? "dark" : "light";
        setThemeState(dbTheme);
        applyDom(dbTheme);
      } catch {}
    }

    // Reset on mount: clear cache + DOM, refetch from DB.
    clearAllThemeCache();
    applyDom("light");
    pullThemeFromDb();

    // Re-pull on any auth change (sign-in, sign-out, token refresh, user switch).
    let unsub: (() => void) | null = null;
    try {
      const sb = getSupabaseBrowser();
      const { data } = sb.auth.onAuthStateChange((_event) => {
        clearAllThemeCache();
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
