// Maps a prospect's country (English or Spanish names, as they arrive from the
// various import sources) to an IANA timezone, so we can show the prospect's
// *local* time on the lead — the single most useful fact when deciding whether
// it's a sane hour to call. Best-effort: returns null when we can't resolve it,
// and the UI simply hides the clock.

const COUNTRY_TZ: Record<string, string> = {
  // LatAm
  "argentina": "America/Argentina/Buenos_Aires",
  "chile": "America/Santiago",
  "colombia": "America/Bogota",
  "peru": "America/Lima",
  "perú": "America/Lima",
  "mexico": "America/Mexico_City",
  "méxico": "America/Mexico_City",
  "uruguay": "America/Montevideo",
  "paraguay": "America/Asuncion",
  "bolivia": "America/La_Paz",
  "ecuador": "America/Guayaquil",
  "venezuela": "America/Caracas",
  "brazil": "America/Sao_Paulo",
  "brasil": "America/Sao_Paulo",
  "panama": "America/Panama",
  "panamá": "America/Panama",
  "costa rica": "America/Costa_Rica",
  "guatemala": "America/Guatemala",
  "dominican republic": "America/Santo_Domingo",
  "república dominicana": "America/Santo_Domingo",
  "republica dominicana": "America/Santo_Domingo",
  // North America
  "united states": "America/New_York",
  "usa": "America/New_York",
  "us": "America/New_York",
  "estados unidos": "America/New_York",
  "canada": "America/Toronto",
  "canadá": "America/Toronto",
  // Europe
  "spain": "Europe/Madrid",
  "españa": "Europe/Madrid",
  "espana": "Europe/Madrid",
  "united kingdom": "Europe/London",
  "uk": "Europe/London",
  "england": "Europe/London",
  "reino unido": "Europe/London",
  "ireland": "Europe/Dublin",
  "irlanda": "Europe/Dublin",
  "france": "Europe/Paris",
  "francia": "Europe/Paris",
  "germany": "Europe/Berlin",
  "alemania": "Europe/Berlin",
  "italy": "Europe/Rome",
  "italia": "Europe/Rome",
  "portugal": "Europe/Lisbon",
  "netherlands": "Europe/Amsterdam",
  "switzerland": "Europe/Zurich",
  "suiza": "Europe/Zurich",
  "belgium": "Europe/Brussels",
  "sweden": "Europe/Stockholm",
  "poland": "Europe/Warsaw",
  // Other common
  "australia": "Australia/Sydney",
  "india": "Asia/Kolkata",
  "united arab emirates": "Asia/Dubai",
  "uae": "Asia/Dubai",
  "singapore": "Asia/Singapore",
};

export function countryToTimeZone(country?: string | null): string | null {
  if (!country) return null;
  const key = country.trim().toLowerCase();
  if (COUNTRY_TZ[key]) return COUNTRY_TZ[key];
  // Loose contains-match for values like "United States of America".
  for (const [name, tz] of Object.entries(COUNTRY_TZ)) {
    if (key.includes(name)) return tz;
  }
  return null;
}
