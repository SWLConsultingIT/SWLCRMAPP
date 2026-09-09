// ─────────────────────────────────────────────────────────────────────────
// PHASE 3A · Call reconciler (scheduled entry point).
//
// The webhook links only the unambiguous case it can see at the instant it
// fires. This sweep sees every candidate at once, so it picks up whatever
// arrived out of order — a webhook that landed before its marker, a marker
// written while the webhook was retrying, a link the live path deferred
// because two candidates were open.
//
// IDEMPOTENT. Running it twice changes nothing: a pair already sharing a
// canonical id is not a candidate. That is what makes reconciliation
// re-runnable instead of one-shot, which was the structural defect.
//
// The logic lives in lib/metrics/reconcile-sweep so the operational script
// and the cron cannot drift apart.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { runReconcileSweep, DEFAULT_LOOKBACK_HOURS } from "@/lib/metrics/reconcile-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** An admin session, or the cron secret. Never open: an earlier draft fell
 *  through to "allowed" when CRON_SECRET was unset, which is how a write
 *  endpoint ends up public. */
async function authorized(req: NextRequest): Promise<boolean> {
  const scope = await getUserScope().catch(() => ({ role: null as string | null }));
  if (scope.role === "admin") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const r = await runReconcileSweep(getSupabaseService(), {
      lookbackHours: Number(req.nextUrl.searchParams.get("hours")) || DEFAULT_LOOKBACK_HOURS,
      reconciledBy: "cron/reconcile-calls",
    });
    return NextResponse.json({
      ok: true,
      window_hours: r.windowHours,
      rows_scanned: r.rowsScanned,
      high_confidence_pairs: r.highConfidencePairs,
      linked: r.linked,
      already_linked: r.alreadyLinked,
      failed: r.failed,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
