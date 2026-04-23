"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "light", setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  // Load theme from DB (per-user) on mount. Falls back to localStorage for unauthenticated
  // or offline scenarios. localStorage is only a cache for anti-FOUC; DB is source of truth.
  useEffect(() => {
    // Anti-FOUC — apply cached value immediately if present
    const cached = localStorage.getItem("swl-theme") as Theme | null;
    if (cached === "dark") apply("dark", { persist: false });

    // Fetch authoritative value from DB
    fetch("/api/settings/prefs")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const dbTheme: Theme = d.theme === "dark" ? "dark" : "light";
        apply(dbTheme, { persist: false });
      })
      .catch(() => {});
  }, []);

  function apply(t: Theme, opts: { persist?: boolean } = { persist: true }) {
    setThemeState(t);
    if (t === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    // Cache for anti-FOUC on next reload. This is session-local.
    try { localStorage.setItem("swl-theme", t); } catch {}
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
