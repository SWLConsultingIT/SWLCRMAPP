// ─────────────────────────────────────────────────────────────────────────
// Flow Metrics — central rules + thresholds (single source of truth).
//
// These are framework-free and side-effect-free so the aggregations that
// depend on them can be validated against real flows (see
// scripts/validate-flow-metrics.mjs). Keeping the call-connected / outcome-
// grouping logic HERE (not duplicated per component) is a hard requirement:
// connect-rate, positive-outcomes and unreachable must never diverge.
// ─────────────────────────────────────────────────────────────────────────

export type CallRow = {
  lead_id: string;
  seller_id: string | null;
  status: string | null;          // initiated | answered | missed | voicemail | initial
  duration: number | null;
  classification: string | null;  // positive | negative | follow_up | needs_info | voicemail | wrong_number | other_person | null
  aircall_call_id: number | string | null;
  started_at?: string | null;
};

// A `calls` row is a REAL call attempt only if Aircall logged it OR a human
// classified it. Pure dial-markers (status=initiated, no aircall id, no
// classification) are click-to-dial stubs — they must never count as calls.
export function isRealCall(c: CallRow): boolean {
  return c.aircall_call_id != null || (c.classification != null && c.classification !== "");
}

export const CALL_GROUPS = ["positive", "followup", "negative", "unreachable", "other"] as const;
export type CallGroup = (typeof CALL_GROUPS)[number];

// Outcome → group. ONE mapping for how raw `calls.classification` values roll
// up. Accepts current values + the extended labels the outcome prompt may add
// later (meeting_booked / interested / not_interested / callback).
export function callOutcomeGroup(c: CallRow): CallGroup {
  const cls = (c.classification ?? "").toLowerCase();
  if (cls === "positive" || cls === "meeting_booked" || cls === "interested") return "positive";
  if (cls === "follow_up" || cls === "needs_info" || cls === "callback") return "followup";
  if (cls === "negative" || cls === "not_interested") return "negative";
  if (cls === "voicemail" || cls === "wrong_number" || cls === "no_answer") return "unreachable";
  if (!cls && (c.status === "missed" || c.status === "voicemail")) return "unreachable";
  return "other";
}

// "Connected" = a human conversation actually happened. Voicemail / wrong
// number / missed / no-answer do NOT count — otherwise they inflate connect
// rate. Denominator for connect rate is `calls made` (all real calls).
export function isConnected(c: CallRow): boolean {
  if (!isRealCall(c)) return false;
  const g = callOutcomeGroup(c);
  if (g === "positive" || g === "followup" || g === "negative") return true;
  // Unclassified real call (historical, pre-mandatory-outcome): fall back to
  // Aircall's own answered signal so we don't lose genuine conversations.
  if (g === "other") return c.status === "answered" && (c.duration ?? 0) > 0;
  return false; // unreachable
}

export function isPositiveOutcome(c: CallRow): boolean {
  return isRealCall(c) && callOutcomeGroup(c) === "positive";
}

// ── Thresholds ────────────────────────────────────────────────────────────
// Simple, centralized healthy/warning/critical bands. `dir: "high"` means a
// HIGHER value is better (reply rate); `dir: "low"` means LOWER is better
// (bounce rate). Not over-engineered — one flat table, easy to tune.
export type Health = "healthy" | "warning" | "critical";
type Band = { warning: number; critical: number; dir: "high" | "low" };

export const THRESHOLDS: Record<string, Band> = {
  bounceRate:        { warning: 3,  critical: 5,  dir: "low"  },
  replyRate:         { warning: 8,  critical: 4,  dir: "high" },
  positiveReplyRate: { warning: 20, critical: 10, dir: "high" }, // % of replies
  connectRate:       { warning: 40, critical: 25, dir: "high" },
  meetingConversion: { warning: 6,  critical: 3,  dir: "high" }, // % of connected
};

export function healthOf(metric: keyof typeof THRESHOLDS, value: number | null | undefined): Health {
  const band = THRESHOLDS[metric];
  if (!band || value == null) return "healthy";
  if (band.dir === "low") {
    if (value >= band.critical) return "critical";
    if (value >= band.warning) return "warning";
    return "healthy";
  }
  if (value <= band.critical) return "critical";
  if (value <= band.warning) return "warning";
  return "healthy";
}

// Safe percentage — clamped to [0,100], 0 when denominator is 0. Every rate in
// the dashboard must go through this so a stale numerator can't render >100%.
export function pctOf(num: number, den: number): number {
  return den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0;
}
