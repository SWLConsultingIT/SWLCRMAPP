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
             color: "#6B7280", bg: "#F3F4F6", border: "#E5E7EB", icon: Clock };
  }
  if (overdueDays === 0) {
    return { level: "due_soon", label: "Due today",  hint: "Will run in the next orchestrator cycle",
             color: "#0A66C2", bg: "#DBEAFE", border: "#93C5FD", icon: CheckCircle2 };
  }
  if (overdueDays <= 2) {
    return { level: "warning",  label: `Overdue ${overdueDays}d`,  hint: "Slightly delayed — fine to wait 1 more cycle",
             color: "#D97706", bg: "#FFFBEB", border: "#FCD34D", icon: Clock };
  }
  if (overdueDays <= 5) {
    return { level: "critical", label: `Overdue ${overdueDays}d`,  hint: "Take action: trigger manually or pause",
             color: "#DC2626", bg: "#FEE2E2", border: "#FCA5A5", icon: AlertTriangle };
  }
  return   { level: "stuck",    label: `Stuck ${overdueDays}d`,   hint: "Likely blocked — review campaign or unlink lead",
             color: "#7F1D1D", bg: "#FEE2E2", border: "#F87171", icon: AlertOctagon };
}
