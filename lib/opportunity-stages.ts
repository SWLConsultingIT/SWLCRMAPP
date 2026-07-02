// Canonical opportunity-pipeline stages, shared by the Results kanban
// (components/ResultsPipeline) and the lead-detail stage panel
// (components/OpportunityStagePanel) so the two never drift.
//
// Stored in leads.opportunity_stage (free text). "Sent to Odoo" is NOT a stored
// stage — it's derived from leads.transferred_to_odoo_at, so it stays the
// terminal, system-owned column/badge (set by the Send-to-Odoo action, never by
// a manual drag).

export type OppStage = { id: string; label: string; color: string };

export const OPP_STAGES: OppStage[] = [
  { id: "interested",     label: "Interested",     color: "#2563EB" },
  { id: "second_contact", label: "2nd contact",    color: "#7C3AED" },
  { id: "meeting_booked", label: "Meeting booked", color: "#0EA5E9" },
  { id: "proposal_sent",  label: "Proposal sent",  color: "#D97706" },
];

// Terminal, derived column — a lead lands here once it's pushed to Odoo.
export const SENT_TO_ODOO: OppStage = { id: "sent_to_odoo", label: "Sent to Odoo", color: "#059669" };

// Map any legacy / unknown stored value onto a current working stage so old rows
// (e.g. the pre-2026 "response_received" / "meeting_scheduled" / "negotiating")
// still bucket somewhere sensible instead of vanishing.
const LEGACY: Record<string, string> = {
  response_received: "interested",
  meeting_scheduled: "meeting_booked",
  negotiating: "proposal_sent",
  won: "proposal_sent",
};

export function normalizeStage(raw: string | null | undefined): string {
  if (!raw) return "interested";
  if (OPP_STAGES.some(s => s.id === raw)) return raw;
  return LEGACY[raw] ?? "interested";
}
