// Activities domain — the single source of truth for the per-lead activity /
// task system (P0). Canonical tokens live here; the UI translates them per
// locale (we never persist a translated label). Bucket derivation (Overdue /
// Today / Upcoming) is pure and computed from due_at — never persisted.
//
// Tenant isolation + ownership are enforced by the API routes that call these
// helpers (service-role writes); this module is deliberately UI/route-agnostic
// so it can be unit-tested without a DB.

import { businessToday, businessDayStartMs, businessDayEndMs } from "@/lib/metric-defs";

export const ACTIVITY_TYPES = [
  "call",
  "email",
  "follow_up",
  "prepare_proposal",
  "meeting",
  "task",
  "other",
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
  "id, company_bio_id, lead_id, type, title, description, assigned_to, created_by, due_at, completed_at, status, priority, source, source_reference_id, reminder_sent_at, created_at, updated_at";

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
  priority: ActivityPriority | null;
  lead_id: string | null;
  source: ActivitySource;
  source_reference_id: string | null;
};

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

  return {
    ok: true,
    value: {
      type,
      title,
      description: typeof input.description === "string" ? input.description.trim() || null : null,
      assigned_to: typeof input.assigned_to === "string" && input.assigned_to ? input.assigned_to : null,
      due_at: due,
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
