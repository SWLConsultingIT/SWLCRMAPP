// Server-side companion to lib/i18n.tsx. Reads the user's locale from
// `user_profiles.locale` (the same row that drives the client LocaleProvider)
// so server components can render with the user's chosen language without
// shipping the dict bundle to the client.
//
// Falls back to "en" when:
//   - no session (auth.getUser returns null)
//   - profile has no locale set
//   - any unexpected error
//
// Wrapped in React.cache so multiple server components calling
// getServerLocale() in the same request share one DB lookup.

import { cache } from "react";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getOrFetchProfile } from "@/lib/user-profile-cache";
import { dicts, type Locale } from "@/lib/i18n-dicts";

export const getServerLocale = cache(async function getServerLocale(): Promise<Locale> {
  try {
    const supabase = await getSupabaseServer();
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return "en";
    // Use the shared profile cache — same source the rest of the app reads
    // for locale/theme. Avoids a duplicate user_profiles round-trip and
    // guarantees we see the column name everyone else uses (user_id, not id).
    const profile = await getOrFetchProfile(userId, getSupabaseService());
    const l = profile?.locale;
    return l === "es" ? "es" : "en";
  } catch {
    return "en";
  }
});

/** Translate a key in a known locale. Falls back to EN then to the key itself.
 * Supports {n} / {kind} / {x} placeholder substitution. */
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let s = dicts[locale][key] ?? dicts.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

/** Returns a bound `t` curried with the user's resolved locale.
 * Server pages call: const t = await getT(); then t("dashx.kpi.contacted"). */
export async function getT(): Promise<(key: string, vars?: Record<string, string | number>) => string> {
  const locale = await getServerLocale();
  return (key, vars) => t(locale, key, vars);
}
