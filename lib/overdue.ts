import { AlertTriangle, AlertOctagon, Clock, CheckCircle2 } from "lucide-react";

export type UrgencyLevel = "on_track" | "due_soon" | "warning" | "critical" | "stuck";

export type UrgencyMeta = {
  level: UrgencyLevel;
  label: string;
  hint: string;
  color: string;
  bg: string;
  border: string;
  icon: typeof Clock;
};

/**
 * Classify an overdue step into an urgency tier.
 * `overdueDays` is signed — negative means "due in N days", 0 means today, positive means overdue.
 */
export function classifyUrgency(overdueDays: number | null | undefined): UrgencyMeta {
  if (overdueDays === null || overdueDays === undefined || overdueDays < 0) {
    return { level: "on_track", label: "Queued",     hint: "Waiting for next orchestrator cycle",
             color: "#6B7280", bg: "color-mix(in srgb, #6B7280 14%, transparent)", border: "color-mix(in srgb, #6B7280 24%, transparent)", icon: Clock };
  }
  if (overdueDays === 0) {
    return { level: "due_soon", label: "Due today",  hint: "Will run in the next orchestrator cycle",
             color: "#0A66C2", bg: "color-mix(in srgb, #2563EB 16%, transparent)", border: "color-mix(in srgb, #2563EB 32%, transparent)", icon: CheckCircle2 };
  }
  if (overdueDays <= 2) {
    return { level: "warning",  label: `Overdue ${overdueDays}d`,  hint: "Slightly delayed — fine to wait 1 more cycle",
             color: "#D97706", bg: "color-mix(in srgb, #D97706 13%, transparent)", border: "color-mix(in srgb, #D97706 34%, transparent)", icon: Clock };
  }
  if (overdueDays <= 5) {
    return { level: "critical", label: `Overdue ${overdueDays}d`,  hint: "Take action: trigger manually or pause",
             color: "#DC2626", bg: "color-mix(in srgb, #DC2626 14%, transparent)", border: "color-mix(in srgb, #DC2626 32%, transparent)", icon: AlertTriangle };
  }
  return   { level: "stuck",    label: `Stuck ${overdueDays}d`,   hint: "Likely blocked — review campaign or unlink lead",
             color: "#EF4444", bg: "color-mix(in srgb, #DC2626 16%, transparent)", border: "color-mix(in srgb, #DC2626 38%, transparent)", icon: AlertOctagon };
}
