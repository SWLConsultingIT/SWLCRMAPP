"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchPrefsCached, clearAllSessionCache } from "@/lib/session-cache";
import { dicts, type Locale } from "@/lib/i18n-dicts";

export type { Locale };


const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}>({ locale: "en", setLocale: () => {}, t: (k) => k });

// Locale lives in user_profiles.locale. Backed by the in-memory session cache
// (lib/session-cache.ts), which is invalidated on every auth state change so a
// tenant switch in the same tab cannot leak the previous user's locale. This
// gives us the no-leak guarantee without paying a fetch on every navigation.
const LEGACY_KEY = "swl-locale";

function clearLegacyLocaleCache() {
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

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    let alive = true;

    async function pullLocaleFromDb() {
      const d = await fetchPrefsCached();
      if (!alive || !d) return;
      // Unauthenticated → server has no opinion. Don't override the locale
      // already seeded from the cookie (same fix pattern as ThemeProvider).
      if ((d as { authenticated?: boolean }).authenticated === false) return;
      const dbLocale: Locale = d.locale === "es" ? "es" : "en";
      setLocaleState(dbLocale);
    }

    // Wipe legacy localStorage cache from older builds.
    clearLegacyLocaleCache();
    pullLocaleFromDb();

    let unsub: (() => void) | null = null;
    try {
      const sb = getSupabaseBrowser();
      const { data } = sb.auth.onAuthStateChange((_event) => {
        // On any session change drop the cache so the next read goes to DB.
        clearAllSessionCache();
        clearLegacyLocaleCache();
        pullLocaleFromDb();
      });
      unsub = () => data.subscription.unsubscribe();
    } catch {}

    return () => { alive = false; unsub?.(); };
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    clearAllSessionCache();
    fetch("/api/settings/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    }).catch(() => {});
  }

  function t(key: string, vars?: Record<string, string | number>) {
    let s = dicts[locale][key] ?? dicts.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);
