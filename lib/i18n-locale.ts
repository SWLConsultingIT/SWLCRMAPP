// The locale registry — deliberately free of dictionary data.
//
// `lib/i18n-dicts.ts` carries ~240 KB of strings. Route handlers that only
// need to validate a locale used to import that module and, in one case, the
// extra type surface pushed TypeScript past its instantiation limit in an
// unrelated Supabase call (TS2589 in /api/settings/prefs). Keeping the type,
// the registry and the normalizer here means "what is a valid locale" costs
// nothing to import. `i18n-dicts` re-exports all of it, so existing imports
// keep working.

export type Locale = "en" | "es" | "it";

/** The locales the UI offers, in display order. `intlTag` is for
 *  `Intl.NumberFormat` / `toLocaleString`, which need a BCP-47 tag rather
 *  than our short code. */
export const LOCALES: { id: Locale; label: string; flag: string; intlTag: string }[] = [
  { id: "en", label: "English",  flag: "🇺🇸", intlTag: "en-US" },
  { id: "es", label: "Español",  flag: "🇦🇷", intlTag: "es-AR" },
  { id: "it", label: "Italiano", flag: "🇮🇹", intlTag: "it-IT" },
];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "es" || v === "it";
}

/**
 * The ONE place a stored/incoming locale value becomes a `Locale`.
 *
 * Every reader used to inline `x === "es" ? "es" : "en"`, which silently
 * collapsed any third language back to English — so a user who picked
 * Italiano got an English UI and no error. Route every read through this.
 */
export function normalizeLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** BCP-47 tag for number/date formatting in a locale. */
export function intlTag(locale: Locale): string {
  return LOCALES.find(l => l.id === locale)?.intlTag ?? "en-US";
}
