"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "light", setTheme: () => {} });

// User-keyed storage so account A's theme never bleeds into account B on the
// same browser. The legacy global key was unsafe across accounts and is
// dropped on mount.
const LEGACY_KEY = "swl-theme";
const cacheKey = (userId: string) => `${LEGACY_KEY}-${userId}`;

let currentUserId: string | null = null;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    let alive = true;
    (async () => {
      // Drop the unsafe legacy global key.
      try { localStorage.removeItem(LEGACY_KEY); } catch {}

      // Pull user_id from supabase session (sync, no network).
      let userId: string | null = null;
      try {
        const sb = getSupabaseBrowser();
        const { data: { session } } = await sb.auth.getSession();
        userId = session?.user?.id ?? null;
      } catch {}
      currentUserId = userId;

      // Anti-FOUC: read THIS user's cached theme only.
      if (userId && alive) {
        try {
          const cached = localStorage.getItem(cacheKey(userId)) as Theme | null;
          if (cached === "dark") apply("dark", { persist: false, cache: false });
        } catch {}
      }

      // Source of truth: DB (per-user via auth cookie).
      try {
        const res = await fetch("/api/settings/prefs");
        if (!res.ok) return;
        const d = await res.json();
        if (!alive) return;
        const dbTheme: Theme = d.theme === "dark" ? "dark" : "light";
        const id = (d.userId as string | undefined) ?? userId;
        currentUserId = id ?? currentUserId;
        apply(dbTheme, { persist: false, cache: true });
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  function apply(t: Theme, opts: { persist?: boolean; cache?: boolean } = { persist: true, cache: true }) {
    setThemeState(t);
    if (t === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    // Cache only under the user-keyed bucket. Never write the legacy global key.
    if (opts.cache !== false && currentUserId) {
      try { localStorage.setItem(cacheKey(currentUserId), t); } catch {}
    }
    if (opts.persist !== false) {
      fetch("/api/settings/prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: t }),
      }).catch(() => {});
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme: (t) => apply(t) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
