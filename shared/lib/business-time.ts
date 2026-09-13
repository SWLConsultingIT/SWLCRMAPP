// ─────────────────────────────────────────────────────────────────────────
// BUSINESS TIME — primitivas de calendario de negocio.
//
// Extraidas de lib/metric-defs.ts en la Fase 2. No son metricas: no responden
// "que cuenta como X", responden "que dia/hora de negocio es este instante".
// Vivian ahi por historia (el audit Block 6 las creo para el dashboard), y eso
// obligaba a features/activities a importar del dominio Dashboard solo para
// saber que dia es hoy.
//
// Cero cambios de calculo respecto de metric-defs: mismo offset constante,
// mismas firmas, mismos resultados. scripts/test-business-time.mts fija la
// paridad.
// ─────────────────────────────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════════════
   BUSINESS TIMEZONE  (audit Block 6)

   The dashboard had four conventions at once: `T00:00:00Z` date presets,
   a `toArgDay` helper at UTC−3, raw `new Date(iso)` day buckets, and
   client-side `toISOString().slice(0,10)`. 95 sent messages landed in a
   different period depending on which one ran.

   One convention now: America/Argentina/Buenos_Aires. Argentina has not
   observed DST since 2009, so the offset is a constant −180 minutes and we
   can do the arithmetic without Intl on every row (this runs over ~30k
   rows per dashboard load). `BUSINESS_TZ` is exported for display code.
   ═══════════════════════════════════════════════════════════════════════ */

export const BUSINESS_TZ = "America/Argentina/Buenos_Aires";
export const BUSINESS_UTC_OFFSET_MINUTES = -180;
const OFFSET_MS = BUSINESS_UTC_OFFSET_MINUTES * 60_000;

/** The business-local calendar day an instant falls on, as `YYYY-MM-DD`. */
export function businessDayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + OFFSET_MS).toISOString().slice(0, 10);
}

/** Hour of day (0–23) in business time. Used by the reply-timing heatmap. */
export function businessHour(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + OFFSET_MS).getUTCHours();
}

/** Day of week in business time, 0 = Sunday — same convention as
 *  `Date.getDay()`, so existing day-indexed arrays keep their meaning. */
export function businessWeekday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + OFFSET_MS).getUTCDay();
}

/** Epoch ms of 00:00:00.000 business-local on `YYYY-MM-DD`. */
export function businessDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - OFFSET_MS;
}

/** Epoch ms of 23:59:59.999 business-local on `YYYY-MM-DD`. */
export function businessDayEndMs(day: string): number {
  return Date.parse(`${day}T23:59:59.999Z`) - OFFSET_MS;
}

/** Today's business-local date as `YYYY-MM-DD`. */
export function businessToday(now: Date = new Date()): string {
  return businessDayKey(now.toISOString());
}

/** `YYYY-MM-DD` n days before the given business day. */
export function businessDayMinus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - days * 86_400_000).toISOString().slice(0, 10);
}
