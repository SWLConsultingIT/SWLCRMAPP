// Single source of truth for campaign lifecycle status buckets, so every flow
// view (board, funnel, counts) treats a campaign the same way.
//
// TERMINAL = the campaign has LEFT the outreach flow abnormally (won/lost/
// cancelled). These leads live in Results / Lost — they must NOT appear as
// active cards sitting in a step column, nor be counted as "pending" at a step.
// (Fran 2026-07-22: a closed_lost lead was showing at Step 3 of the flow board
// because views filtered only by reply classification, never by campaign status.)
//
// `completed` is deliberately NOT terminal here: it means the sequence finished
// normally, so those leads belong in the board's "Completed" column / count as
// having passed every step — not removed.

export const TERMINAL_CAMPAIGN_STATUSES: ReadonlySet<string> = new Set([
  "closed_lost",
  "closed_won",
  "won",
  "cancelled",
]);

export function isTerminalCampaign(status?: string | null): boolean {
  return TERMINAL_CAMPAIGN_STATUSES.has((status ?? "").toLowerCase());
}
