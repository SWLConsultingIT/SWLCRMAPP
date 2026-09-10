// Activities domain — the single source of truth for the per-lead activity /
// task system (P0). Canonical tokens live here; the UI translates them per
// locale (we never persist a translated label). Bucket derivation (Overdue /
// Today / Upcoming) is pure and computed from due_at — never persisted.
//
// Tenant isolation + ownership are enforced by the API routes that call these
// helpers (service-role writes); this module is deliberately UI/route-agnostic
// so it can be unit-tested without a DB.

import { businessToday, businessDayStartMs, businessDayEndMs } from "@/lib/metric-defs";

// Canonical activity types (boss-approved 2026-09-10), aligned to the app's
// channels (call / email / chat) + commercial actions (meeting, proposal).
// `message` = a LinkedIn/WhatsApp chat touch. `task` is the catch-all.
export const ACTIVITY_TYPES = [
  "call",
  "follow_up",
  "email",
  "message",
  "meeting",
  "send_proposal",
  "task",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_STATUSES = ["pending", "completed", "cancelled"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_PRIORITIES = ["low", "normal", "high"] as const;
export type ActivityPriority = (typeof ACTIVITY_PRIORITIES)[number];

// Provenance of an activity. `call_callback` is created automatically from a
// call's "Call back" outcome (P0-2); `inbox`/`manual` cover the other entry
// points. Extend as new sources appear — free text in DB, validated here.
export const ACTIVITY_SOURCES = ["manual", "call_callback", "inbox", "system"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export type Activity = {
  id: string;
  company_bio_id: string;
  lead_id: string | null;
  type: ActivityType;
  title: string;
  description: string | null;
  assigned_to: string | null;
  created_by: string | null;
  due_at: string | null;
  completed_at: string | null;
  status: ActivityStatus;
  priority: ActivityPriority | null;
  source: ActivitySource;
  source_reference_id: string | null;
  reminder_sent_at: string | null;
  /** IANA tz the due time was scheduled in (due_at stays absolute). */
  due_tz: string | null;
  /** Fire the reminder this many minutes before due_at (null = at due_at). */
  reminder_offset_minutes: number | null;
  created_at: string;
  updated_at: string;
};

// Derived, never stored. `no_date` = a pending activity with no due_at.
export type ActivityBucket =
  | "overdue"
  | "today"
  | "upcoming"
  | "no_date"
  | "completed"
  | "cancelled";

export function isActivityType(v: unknown): v is ActivityType {
  return typeof v === "string" && (ACTIVITY_TYPES as readonly string[]).includes(v);
}
export function isActivityStatus(v: unknown): v is ActivityStatus {
  return typeof v === "string" && (ACTIVITY_STATUSES as readonly string[]).includes(v);
}
export function isActivityPriority(v: unknown): v is ActivityPriority {
  return typeof v === "string" && (ACTIVITY_PRIORITIES as readonly string[]).includes(v);
}
export function isActivitySource(v: unknown): v is ActivitySource {
  return typeof v === "string" && (ACTIVITY_SOURCES as readonly string[]).includes(v);
}

/**
 * Bucket a pending activity by its due date relative to "today" in the team's
 * business timezone (BUSINESS_TZ, currently America/Argentina/Buenos_Aires —
 * the same convention the dashboard uses). Terminal statuses map straight to
 * their own bucket. Pure — pass `nowMs` in tests to pin the clock.
 *
 * NOTE: timezone is the team tz for now; per-workspace tz generalization is a
 * later phase (time-filters). Keeping one convention avoids drift meanwhile.
 */
export function bucketActivity(
  a: Pick<Activity, "due_at" | "status">,
  nowMs: number = Date.now(),
): ActivityBucket {
  if (a.status === "completed") return "completed";
  if (a.status === "cancelled") return "cancelled";
  if (!a.due_at) return "no_date";
  const dueMs = Date.parse(a.due_at);
  if (Number.isNaN(dueMs)) return "no_date";
  const todayKey = businessToday(new Date(nowMs));
  const startToday = businessDayStartMs(todayKey);
  const endToday = businessDayEndMs(todayKey);
  if (dueMs < startToday) return "overdue";
  if (dueMs <= endToday) return "today";
  return "upcoming";
}

export const OPEN_STATUSES: ReadonlySet<ActivityStatus> = new Set(["pending"]);

/** Columns selected for every activity read — keep in sync with the table. */
export const ACTIVITY_SELECT =
  "id, company_bio_id, lead_id, type, title, description, assigned_to, created_by, due_at, completed_at, status, priority, source, source_reference_id, reminder_sent_at, due_tz, reminder_offset_minutes, created_at, updated_at";

/**
 * Validate + normalize a create/update payload into the DB-writable shape.
 * Returns `{ ok: false, error }` on the first problem so routes can 400 with a
 * clear message. Only whitelisted, known fields survive — never spread raw body.
 */
export type ActivityWriteInput = {
  type?: unknown;
  title?: unknown;
  description?: unknown;
  assigned_to?: unknown;
  due_at?: unknown;
  due_tz?: unknown;
  reminder_offset_minutes?: unknown;
  priority?: unknown;
  status?: unknown;
  lead_id?: unknown;
  source?: unknown;
  source_reference_id?: unknown;
};

export type NormalizedActivityWrite = {
  type: ActivityType;
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_at: string | null;
  due_tz: string | null;
  reminder_offset_minutes: number | null;
  priority: ActivityPriority | null;
  lead_id: string | null;
  source: ActivitySource;
  source_reference_id: string | null;
};

// ── Timezone helpers (pure, DST-correct, no external lib) ──────────────────
// due_at is the absolute instant; due_tz is the human's intended zone. When a
// seller schedules "tomorrow 15:30 Europe/Berlin", we must store the instant
// that IS 15:30 in Berlin on that date (14:30Z in winter, 13:30Z in summer).

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (tz − UTC) in ms at a given absolute instant, for an IANA zone. */
export function tzOffsetMsAt(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) if (part.type !== "literal") p[part.type] = part.value;
  // 24:00 → 00:00 guard (some engines emit hour "24").
  const hour = p.hour === "24" ? "00" : p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock date+time in `tz` to an absolute UTC ISO string.
 * Two-pass so DST transitions resolve correctly. Returns null on bad input.
 * `dateStr` = "YYYY-MM-DD", `timeStr` = "HH:MM" (24h).
 */
export function wallTimeToUtcIso(dateStr: string, timeStr: string, tz: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr || "09:00");
  if (!dm || !tm || !isValidTimeZone(tz)) return null;
  const [, y, mo, d] = dm.map(Number) as unknown as number[];
  const [, h, mi] = tm.map(Number) as unknown as number[];
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off1 = tzOffsetMsAt(new Date(guess), tz);
  let utc = guess - off1;
  const off2 = tzOffsetMsAt(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2; // crossed a DST boundary → re-correct
  return new Date(utc).toISOString();
}

/** Format an absolute instant as the wall-clock date+time in an IANA zone.
 *  Inverse of wallTimeToUtcIso — used by the quick presets (in 30m / tomorrow…)
 *  to express a target instant as the seller's local date/time. */
export function wallPartsInTz(instant: Date, tz: string): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) if (part.type !== "literal") p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

/** Curated IANA zones for the scheduler dropdown (label + value). */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (ART)" },
  { value: "America/Montevideo", label: "Montevideo" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "America/Santiago", label: "Santiago" },
  { value: "America/Bogota", label: "Bogotá / Lima" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/Denver", label: "Denver (MT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Rome", label: "Rome" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Australia/Sydney", label: "Sydney" },
];

/** The seller's own browser tz (client) — used as the last-resort default. */
export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Argentina/Buenos_Aires"; }
  catch { return "America/Argentina/Buenos_Aires"; }
}

function coerceIsoOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return undefined;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

export function normalizeActivityCreate(
  input: ActivityWriteInput,
): { ok: true; value: NormalizedActivityWrite } | { ok: false; error: string } {
  const type = isActivityType(input.type) ? input.type : "task";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > 200) return { ok: false, error: "title too long (max 200)" };

  const due = coerceIsoOrNull(input.due_at);
  if (due === undefined) return { ok: false, error: "due_at must be a valid date or null" };

  let priority: ActivityPriority | null = null;
  if (input.priority != null && input.priority !== "") {
    if (!isActivityPriority(input.priority)) return { ok: false, error: "invalid priority" };
    priority = input.priority;
  }

  const source = isActivitySource(input.source) ? input.source : "manual";

  // due_tz must be a real IANA zone (validated via Intl); reject junk/offsets.
  let dueTz: string | null = null;
  if (typeof input.due_tz === "string" && input.due_tz.trim()) {
    if (!isValidTimeZone(input.due_tz.trim())) return { ok: false, error: "invalid due_tz (use an IANA zone)" };
    dueTz = input.due_tz.trim();
  }

  let reminderOffset: number | null = null;
  if (input.reminder_offset_minutes != null && input.reminder_offset_minutes !== "") {
    const n = Number(input.reminder_offset_minutes);
    if (!Number.isFinite(n) || n < 0 || n > 10080) return { ok: false, error: "invalid reminder offset" };
    reminderOffset = Math.round(n);
  }

  return {
    ok: true,
    value: {
      type,
      title,
      description: typeof input.description === "string" ? input.description.trim() || null : null,
      assigned_to: typeof input.assigned_to === "string" && input.assigned_to ? input.assigned_to : null,
      due_at: due,
      due_tz: dueTz,
      reminder_offset_minutes: reminderOffset,
      priority,
      lead_id: typeof input.lead_id === "string" && input.lead_id ? input.lead_id : null,
      source,
      source_reference_id:
        typeof input.source_reference_id === "string" && input.source_reference_id
          ? input.source_reference_id
          : null,
    },
  };
}
