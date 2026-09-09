// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A · The reconciliation sweep, as one implementation.
//
// Two entry points use it: the cron route (scheduled) and
// scripts/run-reconciler.mts (operational runs and reporting). They must not
// drift — a sweep that behaves differently when measured than when deployed
// proves nothing.
//
// Writes EXACTLY ONE column, `calls.canonical_call_id`, plus the audit log.
// Never deletes, never merges rows, never touches an outcome, a lead, a
// seller or a classification.
// ─────────────────────────────────────────────────────────────────────────

import { proposeMatches, highConfidence, type RawCallRow } from "./calls-identity";

/** Minimal surface of the Supabase client this sweep needs. */
export type SweepClient = {
  from: (table: string) => any;
};

export type SweepResult = {
  windowHours: number;
  rowsScanned: number;
  highConfidencePairs: number;
  linked: number;
  alreadyLinked: number;
  failed: number;
  /** Row ids touched, so a run can be audited or reverted. */
  linkedRowIds: string[];
};

export const DEFAULT_LOOKBACK_HOURS = 48;

const CALL_COLUMNS =
  "id, canonical_call_id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, " +
  "direction, status, duration, classification, started_at, phone_number";

export async function runReconcileSweep(
  svc: SweepClient,
  opts: { lookbackHours?: number; reconciledBy: string; limit?: number } ,
): Promise<SweepResult> {
  const lookbackHours = opts.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();

  // Both sides, not just orphans: the matcher needs markers AND webhooks to
  // establish mutuality, and "best match" is unverifiable from half the set.
  const { data, error } = await svc
    .from("calls")
    .select(CALL_COLUMNS)
    .gte("started_at", since)
    .order("id", { ascending: true })
    .limit(opts.limit ?? 5000);
  if (error) throw new Error(`calls read failed: ${error.message}`);

  const rows = (data ?? []) as RawCallRow[];
  const proposals = highConfidence(proposeMatches(rows));
  const byId = new Map(rows.map(r => [r.id, r] as [string, RawCallRow]));

  const res: SweepResult = {
    windowHours: lookbackHours, rowsScanned: rows.length,
    highConfidencePairs: proposals.length,
    linked: 0, alreadyLinked: 0, failed: 0, linkedRowIds: [],
  };

  for (const p of proposals) {
    const marker = byId.get(p.markerRowId);
    const webhook = byId.get(p.webhookRowId);
    if (!marker || !webhook) continue;

    const canonical = marker.canonical_call_id ?? marker.id;
    // Idempotence: nothing to do when the pair already shares an identity.
    if (webhook.canonical_call_id === canonical) { res.alreadyLinked++; continue; }

    const { error: upErr } = await svc
      .from("calls")
      .update({ canonical_call_id: canonical })
      .eq("id", webhook.id);
    if (upErr) { res.failed++; continue; }

    await svc.from("calls_recon_log").insert({
      canonical_call_id: canonical,
      row_ids: [marker.id, webhook.id],
      match_method: "high_auto_reconciler",
      confidence: p.confidence,
      time_delta_seconds: p.timeDeltaSeconds,
      phone_match: p.phoneMatch,
      candidates_considered: p.candidatesConsidered,
      reconciled_by: opts.reconciledBy,
    });
    res.linked++;
    res.linkedRowIds.push(webhook.id);
  }

  return res;
}
