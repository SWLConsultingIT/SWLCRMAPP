// Canonical lead-outcome classifier — the single source of truth for how a
// lead maps to a business outcome bucket, shared by /leads and /results so they
// can never drift again (they had: /leads auto-sent no-reply → Re-nurture while
// /results sent the same lead → Lost).
//
// REVISED lifecycle (boss 2026-09-09): "Completed = finished the sequence, NOT
// Won / Lost / Re-nurture." A completed lead with no human decision is OUTCOME
// PENDING and stays in Funnel/Completed — it is NOT auto-classified. Re-nurture
// and Lost require an explicit signal. This reverses the old
// feedback_no_reply_goes_to_renurture rule at Fran's explicit request.
//
// Reply SENTIMENT (positive/negative) is kept distinct from business OUTCOME:
// a positive reply is a Won *signal*, not the same thing as a human marking Won.

export type OutcomeSignals = {
  /** A positive/meeting_intent reply exists. */
  hasPositive: boolean;
  /** Business status already says won/qualified. */
  statusWon: boolean;
  /** Already transferred to Odoo (a de-facto won). */
  transferredToOdoo: boolean;
  /** A negative reply exists. */
  hasNegativeReply: boolean;
  /** lead.status === 'closed_lost' (explicit human decision). */
  statusLost: boolean;
  /** lead.status === 'nurturing' (explicit human decision). */
  statusNurturing: boolean;
  /** The seller already started a follow-up flow (active/paused campaign or a
   *  pending campaign request) — a real re-engagement signal. */
  hasActiveFollowup: boolean;
};

export type LeadOutcome = "won" | "lost" | "renurture" | "pending";

/**
 * Classify a lead into exactly one outcome bucket. Precedence:
 *   won  → any positive signal (reply / status / Odoo transfer)
 *   renurture → explicit nurturing status OR an active follow-up flow
 *   lost → a negative reply OR explicit closed_lost status
 *   pending → none of the above (finished the sequence, awaiting a human
 *             decision) → belongs in Funnel/Completed, NOT in Won/Lost/Re-nurture
 *
 * Re-nurture is checked before Lost so a negative lead the seller is already
 * re-engaging counts as Re-nurture, not Lost (preserves prior behavior).
 */
export function classifyLeadOutcome(s: OutcomeSignals): LeadOutcome {
  if (s.hasPositive || s.statusWon || s.transferredToOdoo) return "won";
  if (s.statusNurturing || s.hasActiveFollowup) return "renurture";
  if (s.hasNegativeReply || s.statusLost) return "lost";
  return "pending";
}

/** True when the lead has finished but has no decision yet — stays in Funnel/
 *  Completed and must be skipped by the Won/Lost/Re-nurture surfaces. */
export function isOutcomePending(s: OutcomeSignals): boolean {
  return classifyLeadOutcome(s) === "pending";
}
