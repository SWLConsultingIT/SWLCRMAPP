// Universal scheduling presets for the Activity Composer (phase 1). ONE source
// for every module (Calls / Inbox / Lead Detail / Results). Pure + tz-aware:
// each preset resolves to a wall-clock {date,time} IN the given IANA zone, which
// the composer then converts to an absolute due_at via wallTimeToUtcIso — so the
// human's intended local time is always preserved, DST included.

import { wallPartsInTz } from "@/lib/activities";

export type PresetKey =
  | "in_30m"
  | "in_1h"
  | "later_today"
  | "tomorrow"
  | "next_business_day"
  | "pick";

export const PRESET_KEYS: PresetKey[] = ["in_30m", "in_1h", "later_today", "tomorrow", "next_business_day", "pick"];

// Default useful hour for day-based presets (Tomorrow / Next business day) — we
// never assume midnight; the seller can still edit the time afterwards.
export const DEFAULT_HOUR = "09:00";

function addCalendarDays(dateStr: string, n: number): string {
  // Treat the date as a plain calendar date (noon UTC avoids any tz/DST edge).
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Day-of-week (0=Sun..6=Sat) of a plain YYYY-MM-DD calendar date. */
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/**
 * Resolve a preset to a wall-clock {date,time} in `tz`. Returns null for "pick"
 * (caller shows manual date/time inputs). Semantics:
 *   in_30m / in_1h     → now + delta, expressed in the seller's zone.
 *   later_today        → today, (local hour + 3) capped at 20:00, on the hour.
 *   tomorrow           → next calendar day at DEFAULT_HOUR (editable).
 *   next_business_day  → next Mon–Fri calendar day at DEFAULT_HOUR.
 */
export function presetToWall(
  preset: PresetKey,
  tz: string,
  now: Date = new Date(),
): { date: string; time: string } | null {
  if (preset === "pick") return null;
  if (preset === "in_30m") return wallPartsInTz(new Date(now.getTime() + 30 * 60000), tz);
  if (preset === "in_1h") return wallPartsInTz(new Date(now.getTime() + 60 * 60000), tz);

  const today = wallPartsInTz(now, tz);
  if (preset === "later_today") {
    const h = parseInt(today.time.slice(0, 2), 10);
    const target = Math.min(h + 3, 20);
    return { date: today.date, time: `${String(target).padStart(2, "0")}:00` };
  }
  if (preset === "tomorrow") {
    return { date: addCalendarDays(today.date, 1), time: DEFAULT_HOUR };
  }
  if (preset === "next_business_day") {
    let d = addCalendarDays(today.date, 1);
    for (let i = 0; i < 7; i++) {
      const dow = weekdayOf(d);
      if (dow !== 0 && dow !== 6) break; // skip Sun(0) / Sat(6)
      d = addCalendarDays(d, 1);
    }
    return { date: d, time: DEFAULT_HOUR };
  }
  return null;
}
