// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A · Call reconciler.
//
// The webhook links only the unambiguous case it can see at the instant it
// fires. This sweep sees every candidate at once, so it can apply true
// mutual-best matching and pick up whatever arrived out of order — a webhook
// that landed before its marker, a marker written while the webhook was
// retrying, a link the live path deferred because two candidates were open.
//
// IDEMPOTENT. Running it twice changes nothing: a pair already sharing a
// canonical id is not a candidate. That is what makes reconciliation
// re-runnable instead of one-shot, which was the structural defect.
//
// Read-only outside `calls.canonical_call_id` and the audit log. It never
// deletes, never merges rows, never touches an outcome.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import {
  proposeMatches, highConfidence, type RawCallRow,
} from "@/lib/metrics/calls-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How far back to sweep. Long enough for a delayed webhook, short enough
 *  that the query stays on the partial index. */
const LOOKBACK_HOURS = 48;

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const svc = getSupabaseService();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();

  // Everything recent, both sides. The matcher needs webhooks AND markers to
  // establish mutuality — fetching only orphans would make "best match"
  // unverifiable from the marker's side.
  const { data, error } = await svc
    .from("calls")
    .select("id, canonical_call_id, lead_id, seller_id, dialed_by_user_id, aircall_call_id, direction, status, duration, classification, started_at, phone_number")
    .gte("started_at", since)
    .order("id", { ascending: true })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: `calls read failed: ${error.message}` }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as RawCallRow[];
  const proposals = highConfidence(proposeMatches(rows));
  const byId = new Map(rows.map(r => [r.id, r]));

  let linked = 0, alreadyLinked = 0, failed = 0;

  for (const p of proposals) {
    const marker = byId.get(p.markerRowId);
    const webhook = byId.get(p.webhookRowId);
    if (!marker || !webhook) continue;

    const canonical = marker.canonical_call_id ?? marker.id;
    // Idempotence: nothing to do when they already share an identity.
    if (webhook.canonical_call_id === canonical) { alreadyLinked++; continue; }

    const { error: upErr } = await svc
      .from("calls")
      .update({
        canonical_call_id: canonical,
        // The marker is the reliable source of the lead; the webhook is 95%.
        ...(webhook.lead_id ? {} : { lead_id: marker.lead_id }),
      })
      .eq("id", webhook.id);

    if (upErr) { failed++; continue; }

    await svc.from("calls_recon_log").insert({
      canonical_call_id: canonical,
      row_ids: [marker.id, webhook.id],
      match_method: "high_auto_reconciler",
      confidence: p.confidence,
      time_delta_seconds: p.timeDeltaSeconds,
      phone_match: p.phoneMatch,
      candidates_considered: p.candidatesConsidered,
      reconciled_by: "cron/reconcile-calls",
    });
    linked++;
  }

  return NextResponse.json({
    ok: true,
    window_hours: LOOKBACK_HOURS,
    rows_scanned: rows.length,
    high_confidence_pairs: proposals.length,
    linked,
    already_linked: alreadyLinked,
    failed,
  });
}
