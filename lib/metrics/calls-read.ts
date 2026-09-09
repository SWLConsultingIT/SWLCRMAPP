// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A.3 · THE canonical read path for Calls.
//
// One implementation, five surfaces: Overview, Sellers, Campaigns, ICPs and
// Channels all derive from `canonicalCallGroups()`. If Lucia has 244 calls in
// Last 30 Days, every equivalent scope says 244, because there is only one
// place the number is produced.
//
// Closed definitions — these are the whole contract:
//
//   Attempted              distinct canonical_call_id in the window that is
//                          a REAL call (Aircall confirmed it, or a human
//                          classified it). A bare dial marker is not a call.
//   Confirmed Connected    the human logged a conversational outcome.
//   Confirmed Not Conn.    the human logged an explicitly non-conversational
//                          outcome: voicemail, wrong number, no answer…
//   Unknown                nobody logged an outcome. NOT a failure — an
//                          absence of evidence, and it is always shown.
//   Confirmed Connect Rate connected / (connected + not connected).
//                          Unknown is NEVER in the denominator.
//
// `status = 'answered'` and `duration > 0` are NOT evidence of a connection
// and appear nowhere below. On 632 audited calls they disagreed with the
// human outcome 52% of the time — 286 were voicemail, mean 37 s.
// ─────────────────────────────────────────────────────────────────────────

import {
  toPhysicalCalls, callTotals, resolveCallSeller,
  type RawCallRow, type PhysicalCall, type ConnectionState, type CallTotals,
} from "./calls-identity";
import { businessHour, inWindow, type Window } from "../metric-defs";

export type { CallTotals };

/**
 * One physical call, shaped for the dashboard. Deliberately the same shape
 * the legacy `CallGroup` had, so every consumer downstream — the seller
 * table, the hour-of-day heatmap, the channel counts — is unchanged and the
 * two paths can be compared field by field.
 */
export type CallGroupView = {
  canonicalCallId: string;
  leadId: string | null;
  /**
   * THE owner of this physical call: a `sellers.id`, or null for
   * Unattributed. Resolved ONCE, here, after the merge — never per row and
   * never again downstream.
   */
  sellerId: string | null;
  /** auth user id of whoever dialled, when known. Never called `sellerId`. */
  userId: string | null;
  /** @deprecated alias of userId, kept for the legacy heatmap consumers. */
  dialer: string | null;
  campaignId: string | null;
  icpId: string | null;
  classification: string | null;
  connection: ConnectionState;
  /**
   * Legacy field name kept for the existing UI. Under the canonical path it
   * means Confirmed Connected — never "Aircall said answered".
   */
  answered: boolean;
  day: string;
  hour: number;
  phone: string | null;
  campaignName: string | null;
  duration: number;
  coachScore: number | null;
  startedAt: string | null;
};

export type CallsReadContext = {
  win: Window;
  /** lead id → campaign name, for the campaign dimension. */
  leadToCampaignName: Map<string, string | null>;
  leadToCampaignId: Map<string, string>;
  leadToIcpId: Map<string, string>;
  /** auth user id → sellers.id, tenant-scoped by the caller. */
  sellerOfUser: Map<string, string>;
  /** lead id → campaigns.assigned_user_id (an auth user id). */
  leadAssignedUser: Map<string, string>;
  /** business-day key, injected so this module owns no timezone policy. */
  toDayKey: (iso: string | null) => string;
};

/**
 * Rows → physical calls → the view every surface reads.
 *
 * Deterministic: grouping is by canonical_call_id and every "pick one"
 * inside mergePhysicalCall resolves by an explicit order with row id as the
 * final tiebreak. Shuffling the input cannot change the output.
 */
export function canonicalCallGroups(rows: RawCallRow[], ctx: CallsReadContext): CallGroupView[] {
  const out: CallGroupView[] = [];
  for (const p of toPhysicalCalls(rows)) {
    // A marker nobody ever dialled through is not an attempt.
    if (!p.isReal) continue;
    if (!inWindow(p.startedAt, ctx.win)) continue;
    // Attribution AFTER the merge, over every row of the physical call.
    // The marker carries the dialler and the webhook carries the outcome;
    // resolving per row is what made one call belong to two people.
    const sellerId = resolveCallSeller(p, {
      sellerOfUser: ctx.sellerOfUser, leadAssignedUser: ctx.leadAssignedUser,
    });
    out.push({
      canonicalCallId: p.canonicalCallId,
      leadId: p.leadId,
      sellerId,
      userId: p.dialedByUserId,
      dialer: p.dialedByUserId,
      campaignId: p.leadId ? ctx.leadToCampaignId.get(p.leadId) ?? null : null,
      icpId: p.leadId ? ctx.leadToIcpId.get(p.leadId) ?? null : null,
      classification: p.outcome,
      connection: p.connection,
      answered: p.connection === "confirmed_connected",
      day: ctx.toDayKey(p.startedAt),
      hour: businessHour(p.startedAt) ?? 0,
      phone: p.phone,
      campaignName: p.leadId ? ctx.leadToCampaignName.get(p.leadId) ?? null : null,
      duration: p.durationSeconds ?? 0,
      coachScore: p.coachScore,
      startedAt: p.startedAt,
    });
  }
  // Stable order so any consumer that slices gets the same slice.
  return out.sort((a, b) =>
    (a.startedAt ?? "").localeCompare(b.startedAt ?? "") || a.canonicalCallId.localeCompare(b.canonicalCallId));
}

/** The five headline numbers, from groups. */
export function callMetrics(groups: CallGroupView[]): CallTotals {
  let connected = 0, notConnected = 0, unknown = 0;
  for (const g of groups) {
    if (g.connection === "confirmed_connected") connected++;
    else if (g.connection === "confirmed_not_connected") notConnected++;
    else unknown++;
  }
  const den = connected + notConnected;
  return {
    attempted: groups.length,
    confirmedConnected: connected,
    confirmedNotConnected: notConnected,
    unknown,
    // null, not 0. "Nothing was classified" and "nobody connected" are
    // different facts and must not render the same.
    confirmedConnectRate: den > 0 ? (connected / den) * 100 : null,
  };
}

/** Split by any dimension. Σ buckets always equals the whole, by construction. */
export function callMetricsBy(
  groups: CallGroupView[],
  keyOf: (g: CallGroupView) => string,
): Map<string, CallTotals> {
  const buckets = new Map<string, CallGroupView[]>();
  for (const g of groups) {
    const k = keyOf(g);
    const l = buckets.get(k) ?? [];
    l.push(g);
    buckets.set(k, l);
  }
  const out = new Map<string, CallTotals>();
  for (const [k, l] of buckets) out.set(k, callMetrics(l));
  return out;
}

/* ═══ scope ═════════════════════════════════════════════════════════════ */

export type PhysicalCallScope = {
  /** sellers.id values. null = dimension inactive. */
  sellerIds: Set<string> | null;
  campaignIds: Set<string> | null;
  /** The dashboard filters campaigns by NAME (the wizard groups by name). */
  campaignNames: Set<string> | null;
  icpIds: Set<string> | null;
  /** Seller-tier scope: lead ids this human is allowed to see. */
  assignedLeadIds: Set<string> | null;
};

export const emptyPhysicalCallScope = (): PhysicalCallScope => ({
  sellerIds: null, campaignIds: null, campaignNames: null, icpIds: null, assignedLeadIds: null,
});

/**
 * THE scope rule for calls. One function, five surfaces.
 *
 * Applied to a PHYSICAL call, never to a technical row: the identity has to
 * exist before anyone asks whose it is. Every active dimension must pass —
 * intersection, never union. A call whose seller cannot be attributed is
 * EXCLUDED by an active seller filter rather than admitted into it.
 */
export function callMatchesScope(g: CallGroupView, scope: PhysicalCallScope): boolean {
  if (scope.assignedLeadIds && (!g.leadId || !scope.assignedLeadIds.has(g.leadId))) return false;
  if (scope.campaignIds && (!g.campaignId || !scope.campaignIds.has(g.campaignId))) return false;
  if (scope.campaignNames && (!g.campaignName || !scope.campaignNames.has(g.campaignName))) return false;
  if (scope.icpIds && (!g.icpId || !scope.icpIds.has(g.icpId))) return false;
  if (scope.sellerIds && (!g.sellerId || !scope.sellerIds.has(g.sellerId))) return false;
  return true;
}

/* ═══ shadow comparison ═════════════════════════════════════════════════ */

export type ShadowDiff = {
  scope: string;
  legacy: { attempted: number; connected: number };
  canonical: CallTotals;
  /** canonical.attempted − legacy.attempted */
  attemptedDelta: number;
  connectedDelta: number;
};

/**
 * Runs both paths and reports the difference WITHOUT changing what renders.
 * The point is to see the migration before taking it, per scope, so a
 * surprise shows up here and not on somebody's screen.
 */
export function shadowCompare(
  scope: string,
  legacyAttempted: number,
  legacyConnected: number,
  canonical: CallTotals,
): ShadowDiff {
  return {
    scope,
    legacy: { attempted: legacyAttempted, connected: legacyConnected },
    canonical,
    attemptedDelta: canonical.attempted - legacyAttempted,
    connectedDelta: canonical.confirmedConnected - legacyConnected,
  };
}
