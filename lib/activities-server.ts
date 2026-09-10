// Server-only helpers for Activities (kept out of lib/activities.ts so that file
// stays client-safe). Append-only audit trail into activity_events — the base
// for the Activity Drawer's history (block 5).

import { getSupabaseService } from "@/lib/supabase-service";

export type ActivityEventType =
  | "created"
  | "edited"
  | "rescheduled"
  | "completed"
  | "cancelled"
  | "assigned"
  | "reopened";

/**
 * Record one audit event. Best-effort: a failure here must never break the
 * mutation the seller performed, so it swallows errors (the row is the trail,
 * not a transaction guarantee).
 */
export async function logActivityEvent(params: {
  activityId: string;
  companyBioId: string | null;
  actorUserId: string | null;
  event: ActivityEventType;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await getSupabaseService().from("activity_events").insert({
      activity_id: params.activityId,
      company_bio_id: params.companyBioId,
      actor_user_id: params.actorUserId,
      event: params.event,
      detail: params.detail ?? null,
    });
  } catch {
    /* audit is best-effort */
  }
}
