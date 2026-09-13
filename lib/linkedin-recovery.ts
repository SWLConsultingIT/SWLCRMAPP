// LinkedIn Recovery / Second Attempt — core domain logic.
//
// PURE where it matters: cooldown math, per-seller cap math, and the withdraw /
// reinvite guard evaluators are all side-effect-free so they're unit-tested
// (scripts/test-linkedin-recovery.mts). The cron/route/script wire the DB +
// Unipile around these decisions. Nothing here sends or writes.
//
// Invariants baked in:
//   • max 2 connection attempts total (original + one recovery).
//   • cooldown is anchored ONLY on withdrawn_at (+21d), never on completion.
//   • withdraw only after completed_at + 5d (historical w/o completed_at ⇒ never
//     auto-acted; they enroll as SHADOW for manual review).
//   • fail closed: anything ambiguous → MANUAL_REVIEW, never a blind send.

export const RECOVERY_STATES = {
  SHADOW: "SHADOW",
  WAITING_WITHDRAWAL: "WAITING_WITHDRAWAL",
  WITHDRAWING: "WITHDRAWING",
  WAITING_REINVITE: "WAITING_REINVITE",
  SECOND_INVITE_SENDING: "SECOND_INVITE_SENDING",
  SECOND_INVITE_SENT: "SECOND_INVITE_SENT",
  SECOND_MESSAGE_SENDING: "SECOND_MESSAGE_SENDING",
  DONE: "DONE",
  STOPPED_UNACCEPTED: "STOPPED_UNACCEPTED",
  CANCELLED_ACCEPTED: "CANCELLED_ACCEPTED",
  CANCELLED_TERMINAL: "CANCELLED_TERMINAL",
  CANCELLED_SUPPRESSED: "CANCELLED_SUPPRESSED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  FAILED: "FAILED",
} as const;
export type RecoveryState = (typeof RECOVERY_STATES)[keyof typeof RECOVERY_STATES];

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WAIT_DAYS_BEFORE_WITHDRAW = 5;
export const COOLDOWN_DAYS = 21;
export const MAX_ATTEMPTS = 2;
export const SECOND_ACCEPT_TTL_DAYS = 21; // second invite unaccepted after this ⇒ STOPPED_UNACCEPTED
export const DEFAULT_DAILY_INVITE_LIMIT = 20; // parity with dispatch-queue fallback

// ── timers ──────────────────────────────────────────────────────────────────

/** completed_at + 5d, or null when completion date is unknown (historical). */
export function computeEligibleWithdrawAt(completedAt: string | null): string | null {
  if (!completedAt) return null;
  const t = Date.parse(completedAt);
  if (Number.isNaN(t)) return null;
  return new Date(t + WAIT_DAYS_BEFORE_WITHDRAW * DAY_MS).toISOString();
}

/** withdrawn_at + 21d — the ONLY cooldown anchor. */
export function computeReinviteAfter(withdrawnAt: string): string {
  const t = Date.parse(withdrawnAt);
  if (Number.isNaN(t)) throw new Error("computeReinviteAfter: invalid withdrawnAt");
  return new Date(t + COOLDOWN_DAYS * DAY_MS).toISOString();
}

/** second invite unaccepted deadline. */
export function computeSecondAcceptDeadline(secondInviteSentAt: string): string {
  const t = Date.parse(secondInviteSentAt);
  if (Number.isNaN(t)) throw new Error("computeSecondAcceptDeadline: invalid secondInviteSentAt");
  return new Date(t + SECOND_ACCEPT_TTL_DAYS * DAY_MS).toISOString();
}

// ── per-seller daily invite cap (SHARED resource with dispatch-queue) ─────────
// The recovery second invite consumes the SAME LinkedIn daily connection-request
// cap as a normal CR. Callers pass BOTH the normal step-0 sends and the recovery
// second invites in the trailing 24h.
export function capRemaining(
  dailyLimit: number | null,
  campaignInvites24h: number,
  recoveryInvites24h: number,
): number {
  const limit = dailyLimit ?? DEFAULT_DAILY_INVITE_LIMIT;
  return Math.max(0, limit - campaignInvites24h - recoveryInvites24h);
}

// ── guard evaluators ─────────────────────────────────────────────────────────

export type GuardDecision =
  | { action: "proceed" }
  | { action: "cancel"; state: RecoveryState; reason: string }
  | { action: "review"; reason: string }
  | { action: "wait"; reason: string };

export type LiveState = { networkDistance: string | null; invitationStatus: string | null; providerId: string | null };

function isFirst(nd: string | null): boolean {
  return nd === "FIRST_DEGREE" || nd === "DISTANCE_1";
}

export type WithdrawCtx = {
  nowMs: number;
  eligibleWithdrawAtMs: number | null;
  leadConnected: boolean;
  leadTerminal: boolean;
  leadArchived: boolean;
  suppressed: boolean;
  laterEngagement: boolean;
  sellerActive: boolean;
  accountAvailable: boolean;
  originalInvitationId: string | null;
  storedProviderId: string | null;
  /** live Unipile preflight; null ⇒ could not verify (no creds / GET failed). */
  live: LiveState | null;
};

// Decide whether to withdraw the original invite. Fail-closed: any unverifiable
// or contradictory signal routes to MANUAL_REVIEW, never a blind DELETE.
export function evaluateWithdrawGuards(ctx: WithdrawCtx): GuardDecision {
  if (ctx.leadConnected) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_ACCEPTED, reason: "connected_before_withdraw" };
  if (ctx.leadTerminal || ctx.leadArchived) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_TERMINAL, reason: "lead_terminal_or_archived" };
  if (ctx.suppressed) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_SUPPRESSED, reason: "active_linkedin_suppression" };
  if (ctx.laterEngagement) return { action: "review", reason: "later_linkedin_engagement" };
  if (!ctx.sellerActive || !ctx.accountAvailable) return { action: "review", reason: "seller_or_account_unavailable" };
  if (!ctx.originalInvitationId) return { action: "review", reason: "missing_original_invitation_id" };
  if (ctx.eligibleWithdrawAtMs === null) return { action: "review", reason: "no_completion_anchor" };
  if (ctx.nowMs < ctx.eligibleWithdrawAtMs) return { action: "wait", reason: "within_5d_wait" };
  if (!ctx.live) return { action: "review", reason: "unipile_preflight_unavailable" };
  if (isFirst(ctx.live.networkDistance)) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_ACCEPTED, reason: "connected_live" };
  if (ctx.live.invitationStatus !== "PENDING") return { action: "review", reason: "original_invite_not_pending" };
  if (ctx.storedProviderId && ctx.live.providerId && ctx.storedProviderId !== ctx.live.providerId) {
    return { action: "review", reason: "provider_mismatch" };
  }
  return { action: "proceed" };
}

export type ReinviteCtx = {
  nowMs: number;
  reinviteAfterMs: number | null;
  attemptCount: number;
  copyApproved: boolean;
  capRemaining: number;
  leadConnected: boolean;
  leadTerminal: boolean;
  leadArchived: boolean;
  suppressed: boolean;
  laterEngagement: boolean;
  sellerActive: boolean;
  accountAvailable: boolean;
  live: LiveState | null;
};

// Decide whether to send the SECOND connection request.
export function evaluateReinviteGuards(ctx: ReinviteCtx): GuardDecision {
  if (ctx.attemptCount >= MAX_ATTEMPTS) return { action: "review", reason: "max_attempts_reached" };
  if (ctx.leadConnected) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_ACCEPTED, reason: "connected_during_cooldown" };
  if (ctx.leadTerminal || ctx.leadArchived) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_TERMINAL, reason: "lead_terminal_or_archived" };
  if (ctx.suppressed) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_SUPPRESSED, reason: "active_linkedin_suppression" };
  if (ctx.laterEngagement) return { action: "review", reason: "later_linkedin_engagement" };
  if (!ctx.sellerActive || !ctx.accountAvailable) return { action: "review", reason: "seller_or_account_unavailable" };
  if (!ctx.copyApproved) return { action: "wait", reason: "awaiting_copy_approval" };
  if (ctx.reinviteAfterMs === null) return { action: "review", reason: "no_cooldown_anchor" };
  if (ctx.nowMs < ctx.reinviteAfterMs) return { action: "wait", reason: "within_cooldown" };
  if (ctx.capRemaining <= 0) return { action: "wait", reason: "daily_cap_reached" };
  if (!ctx.live) return { action: "review", reason: "unipile_preflight_unavailable" };
  if (isFirst(ctx.live.networkDistance)) return { action: "cancel", state: RECOVERY_STATES.CANCELLED_ACCEPTED, reason: "connected_live" };
  if (ctx.live.invitationStatus === "PENDING") return { action: "review", reason: "unexpected_pending_invite" };
  return { action: "proceed" };
}

// ── discovery classification ─────────────────────────────────────────────────
// Given a candidate snapshot (already filtered by the discovery SQL to the
// CASE-1 cohort), decide the initial enrollment state. Historical rows with no
// completion date enroll as SHADOW (manual review) — we never invent a date.
export type CandidateSnapshot = {
  completedAt: string | null;
  leadConnected: boolean;
  leadTerminal: boolean;
  leadArchived: boolean;
  suppressed: boolean;
  laterEngagement: boolean;
  originalInvitationId: string | null;
  linkedinInternalId: string | null;
  sellerId: string | null;
  accountAvailable: boolean;
  sellerActive: boolean;
  stopReason: string | null;
};

export type EnrollDecision =
  | { enroll: false; reason: string }
  | { enroll: true; state: RecoveryState; eligibleWithdrawAt: string | null; reason: string };

export function classifyCandidate(c: CandidateSnapshot): EnrollDecision {
  if (c.stopReason === "invite_expired") return { enroll: false, reason: "already_expire_invited" };
  if (c.leadConnected) return { enroll: false, reason: "already_connected" };
  if (c.leadTerminal || c.leadArchived) return { enroll: false, reason: "terminal_or_archived" };
  if (c.suppressed) return { enroll: false, reason: "suppressed" };
  if (c.laterEngagement) return { enroll: false, reason: "later_engagement" };
  if (!c.originalInvitationId) return { enroll: false, reason: "missing_invitation_id" };
  if (!c.linkedinInternalId) return { enroll: false, reason: "missing_linkedin_internal_id" };
  if (!c.sellerId || !c.accountAvailable || !c.sellerActive) return { enroll: false, reason: "invalid_seller_or_account" };

  const eligibleWithdrawAt = computeEligibleWithdrawAt(c.completedAt);
  if (!eligibleWithdrawAt) {
    // Historical: no reliable completion date → hold for manual review, never auto-act.
    return { enroll: true, state: RECOVERY_STATES.SHADOW, eligibleWithdrawAt: null, reason: "no_completion_anchor" };
  }
  return { enroll: true, state: RECOVERY_STATES.WAITING_WITHDRAWAL, eligibleWithdrawAt, reason: "eligible" };
}

// A seller is usable as a sender only when active and not restricted.
export function sellerUsable(linkedinStatus: string | null, unipileAccountId: string | null): boolean {
  if (!unipileAccountId) return false;
  if (linkedinStatus === "restricted") return false;
  return true;
}
