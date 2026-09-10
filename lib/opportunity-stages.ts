// Canonical opportunity-pipeline stages, shared by the Results kanban
// (components/ResultsPipeline) and the lead-detail stage panel
// (components/OpportunityStagePanel) so the two never drift.
//
// Stored in leads.opportunity_stage (free text). "Sent to Odoo" is NOT a stored
// stage — it's derived from leads.transferred_to_odoo_at, so it stays the
// terminal, system-owned column/badge (set by the Send-to-Odoo action, never by
// a manual drag).

/** `labelKey` resolves through the i18n dictionaries. The stage previously
 *  carried an inline `es` string, which had no room for a third language. */
export type OppStage = { id: string; label: string; labelKey: string; color: string };

export const OPP_STAGES: OppStage[] = [
  { id: "interested",     label: "Interested",     labelKey: "oppStage.interested",     color: "#2563EB" },
  { id: "second_contact", label: "Follow up",      labelKey: "oppStage.second_contact", color: "#7C3AED" },
  { id: "meeting_booked", label: "Meeting booked", labelKey: "oppStage.meeting_booked", color: "#0EA5E9" },
];

// Terminal, derived column — a lead lands here once it's pushed to Odoo.
export const SENT_TO_ODOO: OppStage = { id: "sent_to_odoo", label: "Sent to Odoo", labelKey: "oppStage.sent_to_odoo", color: "#059669" };

// Locale-aware label for a stage. Takes the caller's bound `t` so this module
// stays free of dictionary imports and works from both client and server.
export function stageLabel(stage: OppStage, t: (key: string) => string): string {
  return t(stage.labelKey);
}

// Map any legacy / unknown stored value onto a current working stage so old rows
// (e.g. the pre-2026 "response_received" / "meeting_scheduled" / "negotiating")
// still bucket somewhere sensible instead of vanishing.
const LEGACY: Record<string, string> = {
  response_received: "interested",
  meeting_scheduled: "meeting_booked",
  // proposal_sent was removed (R-1) — fold it and the old late-stage values
  // into meeting_booked, the closest surviving stage, so those leads stay put
  // instead of snapping back to "interested".
  proposal_sent: "meeting_booked",
  negotiating: "meeting_booked",
  won: "meeting_booked",
};

export function normalizeStage(raw: string | null | undefined): string {
  if (!raw) return "interested";
  if (OPP_STAGES.some(s => s.id === raw)) return raw;
  return LEGACY[raw] ?? "interested";
}
