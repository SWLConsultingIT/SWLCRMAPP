// Unit tests for the universal scheduling presets (phase 1). Pure + tz-aware.
// Run: npx tsx scripts/test-activity-presets.mts

import { presetToWall } from "../lib/activity-presets.ts";
import { wallTimeToUtcIso } from "../lib/activities.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) { eq(name, cond, true); }

// Pinned now: Wed 2026-07-15 12:00:00Z. Local: NY 08:00 (EDT), Berlin 14:00
// (CEST), Buenos Aires 09:00 (ART).
const NOW = new Date("2026-07-15T12:00:00Z");
const NY = "America/New_York", BER = "Europe/Berlin", BA = "America/Argentina/Buenos_Aires";

console.log("\npresetToWall — day-based keep a useful hour (never midnight)");
eq("tomorrow NY", presetToWall("tomorrow", NY, NOW), { date: "2026-07-16", time: "09:00" });
eq("tomorrow Berlin", presetToWall("tomorrow", BER, NOW), { date: "2026-07-16", time: "09:00" });
eq("tomorrow BA", presetToWall("tomorrow", BA, NOW), { date: "2026-07-16", time: "09:00" });

console.log("\npresetToWall — later_today (local hour + 3, capped 20)");
eq("later_today BA (09→12)", presetToWall("later_today", BA, NOW), { date: "2026-07-15", time: "12:00" });
eq("later_today Berlin (14→17)", presetToWall("later_today", BER, NOW), { date: "2026-07-15", time: "17:00" });

console.log("\npresetToWall — next_business_day skips Sat/Sun");
// Wed → Thu (still a weekday)
eq("nbd from Wed → Thu", presetToWall("next_business_day", BA, NOW), { date: "2026-07-16", time: "09:00" });
// Fri 2026-07-17 → skip Sat/Sun → Mon 2026-07-20
const FRI = new Date("2026-07-17T12:00:00Z");
eq("nbd from Fri → Mon", presetToWall("next_business_day", BA, FRI), { date: "2026-07-20", time: "09:00" });
{
  const r = presetToWall("next_business_day", BA, FRI)!;
  const dow = new Date(`${r.date}T12:00:00Z`).getUTCDay();
  ok("nbd result is a weekday (not 0/6)", dow !== 0 && dow !== 6);
}

console.log("\npresetToWall — relative presets are exact instants across zones");
// in_30m / in_1h resolve to the same absolute instant regardless of tz.
for (const tz of [NY, BER, BA]) {
  const w30 = presetToWall("in_30m", tz, NOW)!;
  eq(`in_30m round-trips to now+30m (${tz})`, wallTimeToUtcIso(w30.date, w30.time, tz), "2026-07-15T12:30:00.000Z");
  const w60 = presetToWall("in_1h", tz, NOW)!;
  eq(`in_1h round-trips to now+1h (${tz})`, wallTimeToUtcIso(w60.date, w60.time, tz), "2026-07-15T13:00:00.000Z");
}

console.log("\ndue_at represents the chosen LOCAL time (DST-correct)");
{
  const w = presetToWall("tomorrow", BER, NOW)!; // 2026-07-16 09:00 Berlin (CEST = UTC+2)
  eq("tomorrow 09:00 Berlin → 07:00Z", wallTimeToUtcIso(w.date, w.time, BER), "2026-07-16T07:00:00.000Z");
  const wny = presetToWall("tomorrow", NY, NOW)!; // 09:00 NY (EDT = UTC-4)
  eq("tomorrow 09:00 NY → 13:00Z", wallTimeToUtcIso(wny.date, wny.time, NY), "2026-07-16T13:00:00.000Z");
}

eq("pick → null (manual inputs)", presetToWall("pick", BA, NOW), null);

console.log(`\nActivity presets: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("FAILURES:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
