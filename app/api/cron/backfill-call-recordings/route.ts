// Safety net: archive into Supabase Storage any call recording the webhook
// didn't get to. Runs on the Orquestador's daily schedule.
//
// Two sets of calls need picking up, and the second one used to be invisible:
//
//   A. `recording_url` is set but never archived — the webhook saw the
//      recording and the archive didn't complete.
//   B. Aircall assigned a call id but `recording_url` is still null — the
//      `call.ended` event arrived before the recording was ready, so we
//      stored nothing and no later event corrects it. This query used to
//      filter on `recording_url IS NOT NULL`, which meant these calls could
//      never be recovered by anything. archiveCallRecording re-asks Aircall
//      for a fresh URL, so it finds the recording and backfills the column.
//
// Set B is capped to a recent window: a call the prospect never answered has
// no recording and never will (Aircall reports `answered_at: null` and no
// asset), and without the cap those rows would be retried forever. Aircall
// publishes recordings within minutes, so anything still empty after the
// window is empty for good.
//
// Idempotent. Safe to re-run. Skips rows that already have a storage path.
// Auth via CRON_SECRET. `?limit=` (default 10, max 50) bounds one invocation.
//
// One-off catch-up: curl with Authorization: Bearer <CRON_SECRET> until
// `remaining: 0`.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { archiveCallRecording } from "@/lib/archive-call-recording";

export const maxDuration = 60;

/** How far back set B looks. Generous against Aircall's publish delay, short
 *  enough that never-answered calls stop being re-checked. */
const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10)));

  const svc = getSupabaseService();

  // Set A — a recording we know about that never made it to Storage.
  const { data: known } = await svc
    .from("calls")
    .select("id")
    .not("recording_url", "is", null)
    .is("recording_storage_path", null)
    .order("started_at", { ascending: false })
    .limit(limit);

  // Set B — recent calls Aircall numbered but whose recording we never saw.
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const remainingSlots = Math.max(0, limit - (known?.length ?? 0));
  const { data: recent } = remainingSlots > 0
    ? await svc
        .from("calls")
        .select("id")
        .not("aircall_call_id", "is", null)
        .is("recording_url", null)
        .is("recording_storage_path", null)
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(remainingSlots)
    : { data: [] as { id: string }[] };

  const rows = [...(known ?? []), ...(recent ?? [])];

  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  for (const r of rows) {
    const out = await archiveCallRecording(r.id);
    results.push({ id: r.id, ok: out.ok, reason: out.reason });
  }

  // Re-count set A so a one-off catch-up run knows when to stop. Set B is
  // excluded on purpose: most of it is calls with no recording to find, so it
  // never reaches zero and would make `remaining` a useless stop signal.
  const { count } = await svc
    .from("calls")
    .select("id", { count: "exact", head: true })
    .not("recording_url", "is", null)
    .is("recording_storage_path", null);

  return NextResponse.json({
    processed: results.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok),
    remaining: count ?? 0,
  });
}
