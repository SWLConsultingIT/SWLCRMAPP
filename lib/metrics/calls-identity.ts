// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A · Canonical call identity — the single authority on
//   "which technical rows are the same physical call, and what is true
//    about that call".
//
// Nothing else in the app may decide this. The matcher, the merge and the
// connected semantics all live here so there is exactly one answer.
//
// THE EVIDENCE THESE RULES COME FROM (production, 2026-09-09):
//
//   · 82% of marker↔webhook deltas are under 15 SECONDS; 69% under 5.
//     Beyond 60s the whole remaining tail is 34 pairs, while the number of
//     ambiguous candidates doubles. Hence the 15s high-confidence gate.
//   · 318 pairs of genuinely DISTINCT real calls to the same lead are less
//     than a minute apart. A minutes-wide window merges real calls.
//   · Aircall `answered + duration > 0` disagrees with the human's own
//     outcome 52% of the time — 286 of 632 such calls were logged
//     voicemail, mean duration 37s. Median conversation is 50s against 34s
//     for voicemail, so duration does not separate them either. That is why
//     there is no inferred-connection fallback anywhere below.
// ─────────────────────────────────────────────────────────────────────────

/* ═══ rows ══════════════════════════════════════════════════════════════ */

export type RawCallRow = {
  id: string;
  canonical_call_id?: string | null;
  lead_id: string | null;
  seller_id: string | null;
  dialed_by_user_id: string | null;
  aircall_call_id: number | string | null;
  direction: string | null;
  status: string | null;
  duration: number | null;
  classification: string | null;
  started_at: string | null;
  ended_at?: string | null;
  phone_number: string | null;
  recording_url?: string | null;
  recording_storage_path?: string | null;
  transcript?: string | null;
  notes?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

/** A row Aircall confirmed. Carries duration, status, recording. */
export const isWebhookRow = (r: RawCallRow) => r.aircall_call_id != null;
/** A row the app wrote before dialling. Carries lead and dialler. */
export const isMarkerRow = (r: RawCallRow) => r.aircall_call_id == null;

/**
 * The canonical real-call predicate: Aircall logged it, or a human
 * classified it. A bare click-to-dial marker is not a call.
 */
export function isRealCallRow(r: RawCallRow): boolean {
  return r.aircall_call_id != null || (r.classification != null && r.classification !== "");
}

/* ═══ phone ═════════════════════════════════════════════════════════════ */

/** Digits only. Formats differ per source ("+44 115 …" vs "+44115…"). */
export function phoneDigits(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "");
}

export type PhoneMatch = "exact" | "suffix" | "none";

/**
 * Two numbers refer to the same subscriber. `suffix` compares the last 9
 * digits, which is what survives every formatting variant we have seen
 * while still being long enough not to collide.
 */
export function phoneMatchKind(a: string | null | undefined, b: string | null | undefined): PhoneMatch {
  const da = phoneDigits(a), db = phoneDigits(b);
  if (!da || !db || da.length < 9 || db.length < 9) return "none";
  if (da === db) return "exact";
  return da.slice(-9) === db.slice(-9) ? "suffix" : "none";
}

/* ═══ matcher — Mutual Unique Best Match ════════════════════════════════ */

export const HIGH_CONFIDENCE_MAX_SECONDS = 15;
export const MEDIUM_CONFIDENCE_MAX_SECONDS = 120;

export type Confidence = "high" | "medium" | "low";

export type MatchProposal = {
  webhookRowId: string;
  markerRowId: string;
  confidence: Confidence;
  timeDeltaSeconds: number;
  phoneMatch: PhoneMatch;
  /** Rivals evaluated on the webhook side. 1 means it was unambiguous. */
  candidatesConsidered: number;
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** A marker is eligible for a webhook at all. Cheap gate before scoring. */
function compatible(w: RawCallRow, m: RawCallRow, maxSeconds: number): { ok: boolean; delta: number; phone: PhoneMatch } {
  const phone = phoneMatchKind(w.phone_number, m.phone_number);
  const tw = ms(w.started_at), tm = ms(m.started_at);
  const delta = Number.isNaN(tw) || Number.isNaN(tm) ? Infinity : Math.abs(tw - tm) / 1000;
  const ok =
    !!w.lead_id && w.lead_id === m.lead_id &&      // same lead
    phone !== "none" &&                             // same subscriber
    (!w.direction || !m.direction || w.direction === m.direction) && // compatible direction
    delta <= maxSeconds;
  return { ok, delta, phone };
}

/**
 * MUTUAL UNIQUE BEST MATCH.
 *
 * A pair is proposed only when the webhook's closest eligible marker is that
 * marker, AND that marker's closest eligible webhook is that webhook. The
 * rule is symmetric by construction: there is no "webhook picks nearest but
 * marker doesn't" asymmetry, and a tie on either side blocks the link.
 *
 * Deterministic: evaluated over the whole set, never incrementally, and the
 * candidate lists are sorted (delta, then row id) so input order cannot
 * change the outcome. A false merge is worse than two unreconciled rows, so
 * anything unclear degrades to "not linked".
 *
 * @param rows every candidate row in scope (one tenant)
 */
export function proposeMatches(rows: RawCallRow[]): MatchProposal[] {
  const webhooks = rows.filter(isWebhookRow);
  const markers = rows.filter(isMarkerRow);

  const byLead = <T extends RawCallRow>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) {
      if (!r.lead_id) continue;
      const l = m.get(r.lead_id) ?? [];
      l.push(r);
      m.set(r.lead_id, l);
    }
    return m;
  };
  const markersByLead = byLead(markers);
  const webhooksByLead = byLead(webhooks);

  const out: MatchProposal[] = [];
  const claimedMarkers = new Set<string>();
  const claimedWebhooks = new Set<string>();

  /** Eligible, unclaimed partners, closest first. */
  const eligible = (a: RawCallRow, pool: RawCallRow[], claimed: Set<string>, maxSeconds: number) =>
    pool
      .filter(b => !claimed.has(b.id))
      .map(b => ({ b, ...compatible(a, b, maxSeconds) }))
      .filter(x => x.ok)
      .sort((x, y) => x.delta - y.delta || x.b.id.localeCompare(y.b.id));

  // Two tiers, and inside each, ROUNDS until nothing new is found.
  //
  // The round loop only recovers cases where a rival is removed by a link
  // made elsewhere — typically a marker claimed at HIGH that stops competing
  // at MEDIUM. It does NOT unlock a dense cluster: if every webhook sees two
  // markers and every marker sees two webhooks, uniqueness fails everywhere
  // and no round can make progress. That cluster stays unlinked, which is
  // the intended outcome — a false merge is worse than two rows waiting.
  for (const maxSeconds of [HIGH_CONFIDENCE_MAX_SECONDS, MEDIUM_CONFIDENCE_MAX_SECONDS]) {
    const confidence: Confidence = maxSeconds === HIGH_CONFIDENCE_MAX_SECONDS ? "high" : "medium";

    for (;;) {
      const pending: MatchProposal[] = [];

      for (const w of [...webhooks].sort((x, y) => x.id.localeCompare(y.id))) {
        if (claimedWebhooks.has(w.id)) continue;
        const forward = eligible(w, markersByLead.get(w.lead_id ?? "") ?? [], claimedMarkers, maxSeconds);
        // UNIQUE CANDIDATE — required by the contract. Two open markers is
        // two plausible calls, and we do not pick the nearer one.
        if (forward.length !== 1) continue;
        const m = forward[0].b;

        // MUTUAL — and unique from the marker's side too, so the rule is
        // symmetric rather than webhook-driven.
        const backward = eligible(m, webhooksByLead.get(m.lead_id ?? "") ?? [], claimedWebhooks, maxSeconds);
        if (backward.length !== 1 || backward[0].b.id !== w.id) continue;

        pending.push({
          webhookRowId: w.id,
          markerRowId: m.id,
          confidence,
          timeDeltaSeconds: Math.round(forward[0].delta * 1000) / 1000,
          phoneMatch: forward[0].phone,
          candidatesConsidered: 1,
        });
      }

      if (pending.length === 0) break;
      // Commit the whole round at once so order within it cannot matter.
      for (const p of pending) {
        claimedMarkers.add(p.markerRowId);
        claimedWebhooks.add(p.webhookRowId);
        out.push(p);
      }
    }
  }

  return out.sort((a, b) => a.webhookRowId.localeCompare(b.webhookRowId));
}

/* ═══ diagnostics ═══════════════════════════════════════════════════════ */

export type UnmatchedReason =
  /** no marker for this lead within the tier at all */
  | "no_candidate"
  /** two or more plausible markers — we refuse to pick the nearer one */
  | "ambiguous"
  /** its unique marker preferred another webhook, or was already claimed */
  | "not_mutual";

/**
 * Why each unlinked webhook row stayed unlinked, at the MEDIUM horizon (the
 * widest we ever consider). This is the number that says whether the matcher
 * is too strict or the data is genuinely ambiguous — without it, "611
 * unmatched" is unreadable.
 */
export function explainUnmatched(
  rows: RawCallRow[],
  proposals: MatchProposal[],
): Record<UnmatchedReason, number> {
  const linked = new Set(proposals.map(p => p.webhookRowId));
  const markers = rows.filter(isMarkerRow);
  const out: Record<UnmatchedReason, number> = { no_candidate: 0, ambiguous: 0, not_mutual: 0 };

  for (const w of rows.filter(isWebhookRow)) {
    if (linked.has(w.id)) continue;
    const cands = markers.filter(m => compatible(w, m, MEDIUM_CONFIDENCE_MAX_SECONDS).ok);
    if (cands.length === 0) out.no_candidate++;
    else if (cands.length > 1) out.ambiguous++;
    else out.not_mutual++;
  }
  return out;
}

/** The proposals safe to apply without a human looking at them. */
export const highConfidence = (p: MatchProposal[]) => p.filter(x => x.confidence === "high");
export const mediumConfidence = (p: MatchProposal[]) => p.filter(x => x.confidence === "medium");

/* ═══ connected semantics ═══════════════════════════════════════════════ */

/** Human outcomes that mean a person was actually spoken to. */
export const CONVERSATIONAL_OUTCOMES = new Set([
  "positive", "interested", "meeting_booked", "meeting_intent",
  "follow_up", "needs_info", "callback", "negative", "not_interested",
  "other_person",
]);

/** Human outcomes that explicitly mean nobody was reached. */
export const NON_CONVERSATIONAL_OUTCOMES = new Set([
  "voicemail", "wrong_number", "no_answer",
]);

export type ConnectionState = "confirmed_connected" | "confirmed_not_connected" | "unknown";

/**
 * Whether a human conversation happened.
 *
 * The ONLY evidence accepted is a human outcome. Aircall's `answered` +
 * `duration > 0` is not used and must never be added back: measured against
 * the humans' own classifications it is wrong 52% of the time, and duration
 * does not separate the cases (median 50s conversation vs 34s voicemail).
 *
 * A call nobody classified is `unknown`. Unknown is a real answer.
 */
export function connectionState(outcome: string | null | undefined): ConnectionState {
  const c = (outcome ?? "").toLowerCase().trim();
  if (!c) return "unknown";
  if (CONVERSATIONAL_OUTCOMES.has(c)) return "confirmed_connected";
  if (NON_CONVERSATIONAL_OUTCOMES.has(c)) return "confirmed_not_connected";
  return "unknown"; // an outcome we do not recognise decides nothing
}

/* ═══ merge ═════════════════════════════════════════════════════════════ */

export type PhysicalCall = {
  canonicalCallId: string;
  rowIds: string[];
  aircallCallId: number | string | null;
  leadId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: string | null;
  durationSeconds: number | null;
  /** The human's outcome. null when nobody classified the call. */
  outcome: string | null;
  connection: ConnectionState;
  phone: string | null;
  recordingUrl: string | null;
  recordingStoragePath: string | null;
  transcript: string | null;
  notes: string | null;
  /** Raw attribution inputs; resolve with resolveCallSeller(). */
  dialedByUserId: string | null;
  sellerId: string | null;
  /** True when Aircall confirmed this call, i.e. it is not a bare marker. */
  isReal: boolean;
};

const latestFirst = (a: RawCallRow, b: RawCallRow) => {
  const ta = Date.parse(a.updated_at ?? a.created_at ?? a.started_at ?? "") || 0;
  const tb = Date.parse(b.updated_at ?? b.created_at ?? b.started_at ?? "") || 0;
  return tb - ta || a.id.localeCompare(b.id); // id breaks ties → deterministic
};

/**
 * Collapse every technical row of one physical call into the single truth.
 *
 * Field precedence — the whole policy in one place:
 *   identity      canonical_call_id, then the webhook's aircall_call_id
 *   started_at    webhook if present, else the marker
 *   status /
 *   duration /
 *   ended_at      webhook (the marker never has them)
 *   recording /
 *   transcript    webhook
 *   outcome       THE HUMAN ALWAYS. Two humans → the most recently updated.
 *   lead_id       the marker first (100% populated vs 95% on webhooks)
 *   phone         first non-empty, normalised to digits by the caller
 *   attribution   dialler → calls.seller_id → flow's assigned caller
 *
 * Deterministic: every "pick one" is resolved by an explicit order with row
 * id as the final tiebreak, so a shuffled input yields an identical result.
 */
export function mergePhysicalCall(rows: RawCallRow[]): PhysicalCall {
  if (rows.length === 0) throw new Error("mergePhysicalCall: no rows");

  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const webhooks = sorted.filter(isWebhookRow).sort(latestFirst);
  const markers = sorted.filter(isMarkerRow).sort(latestFirst);
  const w = webhooks[0] ?? null;
  const m = markers[0] ?? null;

  // The human's outcome, from whichever row carries it. This single rule is
  // what repairs the 212 calls whose outcome sits on the marker while the
  // audio sits on the webhook.
  const classified = sorted.filter(r => r.classification && r.classification.trim() !== "").sort(latestFirst);
  const outcome = classified[0]?.classification?.toLowerCase().trim() ?? null;

  const firstOf = <K extends keyof RawCallRow>(k: K, order: RawCallRow[]): RawCallRow[K] | null => {
    for (const r of order) {
      const v = r[k];
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return null;
  };

  const webhookFirst = [...webhooks, ...markers];
  const markerFirst = [...markers, ...webhooks];

  return {
    canonicalCallId: sorted.find(r => r.canonical_call_id)?.canonical_call_id ?? sorted[0].id,
    rowIds: sorted.map(r => r.id),
    aircallCallId: w?.aircall_call_id ?? null,
    leadId: (firstOf("lead_id", markerFirst) as string | null) ?? null,
    startedAt: (firstOf("started_at", webhookFirst) as string | null) ?? null,
    endedAt: (firstOf("ended_at", webhookFirst) as string | null) ?? null,
    status: w?.status ?? m?.status ?? null,
    durationSeconds: w?.duration ?? null,
    outcome,
    connection: connectionState(outcome),
    phone: (firstOf("phone_number", markerFirst) as string | null) ?? null,
    recordingUrl: (firstOf("recording_url", webhookFirst) as string | null) ?? null,
    recordingStoragePath: (firstOf("recording_storage_path", webhookFirst) as string | null) ?? null,
    transcript: (firstOf("transcript", webhookFirst) as string | null) ?? null,
    notes: (firstOf("notes", webhookFirst) as string | null) ?? null,
    dialedByUserId: (firstOf("dialed_by_user_id", markerFirst) as string | null) ?? null,
    sellerId: (firstOf("seller_id", markerFirst) as string | null) ?? null,
    isReal: sorted.some(isRealCallRow),
  };
}

/** Group raw rows into physical calls. The one way to count calls. */
export function toPhysicalCalls(rows: RawCallRow[]): PhysicalCall[] {
  const groups = new Map<string, RawCallRow[]>();
  for (const r of rows) {
    const k = r.canonical_call_id ?? r.id;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  return [...groups.values()]
    .map(mergePhysicalCall)
    .sort((a, b) => a.canonicalCallId.localeCompare(b.canonicalCallId));
}

/* ═══ attribution ═══════════════════════════════════════════════════════ */

export type AttributionContext = {
  /** auth user id → sellers.id */
  sellerOfUser: Map<string, string>;
  /** lead id → campaigns.assigned_user_id */
  leadAssignedUser: Map<string, string>;
};

/**
 * Who made this call: the dialler, then calls.seller_id, then the flow's
 * assigned caller. Never the flow's LinkedIn sender — everyone shares one
 * Aircall seat, so the dialler field is the only thing that separates them.
 * null means Unattributed and must be reported as such, never spread.
 */
export function resolveCallSeller(call: PhysicalCall, ctx: AttributionContext): string | null {
  if (call.dialedByUserId) {
    const s = ctx.sellerOfUser.get(call.dialedByUserId);
    if (s) return s;
  }
  if (call.sellerId) return call.sellerId;
  if (call.leadId) {
    const u = ctx.leadAssignedUser.get(call.leadId);
    if (u) {
      const s = ctx.sellerOfUser.get(u);
      if (s) return s;
    }
  }
  return null;
}

/* ═══ metrics ═══════════════════════════════════════════════════════════ */

export type CallTotals = {
  /** Distinct physical calls that are real. The only "attempted". */
  attempted: number;
  confirmedConnected: number;
  confirmedNotConnected: number;
  unknown: number;
  /**
   * Confirmed Connected ÷ (Confirmed Connected + Confirmed Not Connected).
   * Unknown is NEVER in the denominator and must be rendered beside it.
   * null when nothing was classified — that is not 0%.
   */
  confirmedConnectRate: number | null;
};

export function callTotals(calls: PhysicalCall[]): CallTotals {
  const real = calls.filter(c => c.isReal);
  let connected = 0, notConnected = 0, unknown = 0;
  for (const c of real) {
    if (c.connection === "confirmed_connected") connected++;
    else if (c.connection === "confirmed_not_connected") notConnected++;
    else unknown++;
  }
  const den = connected + notConnected;
  return {
    attempted: real.length,
    confirmedConnected: connected,
    confirmedNotConnected: notConnected,
    unknown,
    confirmedConnectRate: den > 0 ? (connected / den) * 100 : null,
  };
}

/**
 * READ switch — deliberately OPT-IN, and deliberately separate from writing.
 *
 * Phase 3A.1 rolls out the WRITE side only: ingestion stores canonical
 * identity on every new row. Nothing reads it yet, so no visible number
 * moves. Reading is Phase 3D and flips this flag on purpose.
 *
 * Defaulting to ON would mean a forgotten env var silently changes every
 * call metric on the dashboard, which is precisely the failure this split
 * exists to prevent. Absent or "0" → surfaces keep the legacy lead+minute
 * dedup, exactly as today.
 */
export const CALLS_CANONICAL_IDENTITY =
  process.env.CALLS_CANONICAL_IDENTITY === "1";
