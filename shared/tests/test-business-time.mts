#!/usr/bin/env npx tsx
// Paridad de las primitivas de business-time extraidas de lib/metric-defs.ts
// en la Fase 2. Puro — sin DB.
//
// Los esperados NO se copian de la implementacion: se derivan de la regla
// documentada (America/Argentina/Buenos_Aires, sin DST desde 2009, offset
// constante UTC−3), asi que el test falla si alguien cambia el calculo aunque
// el codigo siga "compilando igual".
//
// Run: npx tsx shared/tests/test-business-time.mts

import {
  BUSINESS_TZ, BUSINESS_UTC_OFFSET_MINUTES,
  businessDayKey, businessHour, businessWeekday,
  businessDayStartMs, businessDayEndMs, businessToday, businessDayMinus,
} from "@/shared/lib/business-time";
import * as metricDefs from "@/lib/metric-defs";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} — got ${typeof got === "function" ? got.name || "fn" : JSON.stringify(got)}, want ${typeof want === "function" ? want.name || "fn" : JSON.stringify(want)}`); }
}

console.log("\nbusiness-time · la convencion");
eq("timezone", BUSINESS_TZ, "America/Argentina/Buenos_Aires");
eq("offset en minutos", BUSINESS_UTC_OFFSET_MINUTES, -180);

// 2026-08-10 es lunes. 12:00Z = 09:00 en UTC−3.
console.log("\nbusinessDayKey · el dia local de un instante");
eq("mediodia UTC cae el mismo dia", businessDayKey("2026-08-10T12:00:00Z"), "2026-08-10");
eq("02:00Z todavia es el dia anterior", businessDayKey("2026-08-10T02:00:00Z"), "2026-08-09");
eq("medianoche UTC es el dia anterior", businessDayKey("2026-08-10T00:00:00Z"), "2026-08-09");
eq("03:00Z es el primer instante del dia", businessDayKey("2026-08-10T03:00:00Z"), "2026-08-10");
eq("null -> cadena vacia", businessDayKey(null), "");
eq("undefined -> cadena vacia", businessDayKey(undefined), "");
eq("basura -> cadena vacia", businessDayKey("no-es-una-fecha"), "");

console.log("\nbusinessHour · hora local 0-23");
eq("12:00Z -> 9", businessHour("2026-08-10T12:00:00Z"), 9);
eq("02:00Z -> 23 (dia anterior)", businessHour("2026-08-10T02:00:00Z"), 23);
eq("null -> null", businessHour(null), null);
eq("basura -> null", businessHour("x"), null);

console.log("\nbusinessWeekday · 0 = domingo, igual que Date.getDay()");
eq("lunes 12:00Z -> 1", businessWeekday("2026-08-10T12:00:00Z"), 1);
eq("lunes 02:00Z -> 0 (todavia domingo)", businessWeekday("2026-08-10T02:00:00Z"), 0);
eq("null -> null", businessWeekday(null), null);

console.log("\nbusinessDayStartMs / EndMs · los bordes del dia local en UTC");
eq("inicio = 03:00Z", businessDayStartMs("2026-08-10"), Date.parse("2026-08-10T03:00:00.000Z"));
eq("fin = 02:59:59.999Z del dia siguiente", businessDayEndMs("2026-08-10"), Date.parse("2026-08-11T02:59:59.999Z"));
eq("el dia dura exactamente 24h menos 1ms",
   businessDayEndMs("2026-08-10") - businessDayStartMs("2026-08-10"), 86_400_000 - 1);
eq("el fin de un dia y el inicio del siguiente son contiguos",
   businessDayStartMs("2026-08-11") - businessDayEndMs("2026-08-10"), 1);

console.log("\nbusinessToday · hoy local");
eq("02:00Z devuelve el dia anterior", businessToday(new Date("2026-08-10T02:00:00Z")), "2026-08-09");
eq("12:00Z devuelve el mismo dia", businessToday(new Date("2026-08-10T12:00:00Z")), "2026-08-10");

console.log("\nbusinessDayMinus · aritmetica de dias");
eq("3 dias antes", businessDayMinus("2026-08-10", 3), "2026-08-07");
eq("0 dias es el mismo dia", businessDayMinus("2026-08-10", 0), "2026-08-10");
eq("cruza el cambio de mes", businessDayMinus("2026-08-02", 5), "2026-07-28");
eq("cruza el cambio de anio", businessDayMinus("2026-01-02", 3), "2025-12-30");

console.log("\nparidad · metric-defs devuelve lo MISMO que shared para las mismas entradas");
{
  const isoSamples = ["2026-08-10T12:00:00Z", "2026-08-10T02:00:00Z", "2026-01-01T00:00:00Z",
                      "2025-12-31T23:59:59Z", null, undefined, "basura"];
  const daySamples = ["2026-08-10", "2026-01-01", "2025-12-31", "2026-02-28"];
  let drift = 0;
  for (const iso of isoSamples) {
    if (metricDefs.businessDayKey(iso)  !== businessDayKey(iso))  drift++;
    if (metricDefs.businessHour(iso)    !== businessHour(iso))    drift++;
    if (metricDefs.businessWeekday(iso) !== businessWeekday(iso)) drift++;
  }
  for (const day of daySamples) {
    if (metricDefs.businessDayStartMs(day) !== businessDayStartMs(day)) drift++;
    if (metricDefs.businessDayEndMs(day)   !== businessDayEndMs(day))   drift++;
    for (const n of [0, 1, 5, 40]) {
      if (metricDefs.businessDayMinus(day, n) !== businessDayMinus(day, n)) drift++;
    }
  }
  const now = new Date("2026-08-10T02:00:00Z");
  if (metricDefs.businessToday(now) !== businessToday(now)) drift++;
  eq("cero divergencias sobre 45 comparaciones", drift, 0);
}
eq("BUSINESS_TZ es el mismo valor", metricDefs.BUSINESS_TZ, BUSINESS_TZ);
eq("BUSINESS_UTC_OFFSET_MINUTES es el mismo valor", metricDefs.BUSINESS_UTC_OFFSET_MINUTES, BUSINESS_UTC_OFFSET_MINUTES);

console.log(`\nBusiness time: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
