// Sweep stale outbound dials.
//
// Symptom this cron fixes: Aircall accepts a dial POST (returns 204) but the
// call never connects to the seller's device because their Aircall Phone
// app isn't actually running. The webhook never fires (Aircall internally
// cancels the queued call). Our row stays at `status='initiated'` with
// `aircall_call_id=null` forever, polluting the UI and the queue.
//
// Selection rule:
//   - status = 'initiated'
//   - aircall_call_id IS NULL  (webhook never reconciled)
//   - direction = 'outbound'
//   - started_at < now() - 60 seconds  (gives the webhook a reasonable
//     window to fire on legitimate slow calls)
//   - started_at > now() - 7 days     (don't churn through ancient rows
//     on every run; old ones get cleaned manually if at all)
//
// Action: flip status to 'failed' with a note pointing at the most likely
// cause so the seller knows what to do.
//
// Safety: DRY-RUN by default. Add `?execute=1` to actually update.
// Authenticated via CRON_SECRET like every other cron in this app.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

export const maxDuration = 30;

const STALE_AFTER_SECONDS = 60;
const NOT_OLDER_THAN_DAYS = 7;
const NOTE = "Auto-flagged: Aircall accepted the dial but the call never connected — likely the Aircall Phone app was not running on the seller's device.";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) return unauthorized();

  const url = new URL(req.url);
  const execute = url.searchParams.get("execute") === "1";

  const svc = getSupabaseService();
  const cutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const floor = new Date(Date.now() - NOT_OLDER_THAN_DAYS * 86400_000).toISOString();

  const { data: stale, error } = await svc
    .from("calls")
    .select("id, lead_id, phone_number, started_at")
    .eq("status", "initiated")
    .is("aircall_call_id", null)
    .eq("direction", "outbound")
    .lt("started_at", cutoff)
    .gt("started_at", floor)
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!execute) {
    return NextResponse.json({
      dry_run: true,
      stale_count: stale?.length ?? 0,
      sample: (stale ?? []).slice(0, 10),
      hint: "Add ?execute=1 to flip these to status=failed.",
    });
  }

  let flagged = 0;
  for (const row of stale ?? []) {
    const { error: upErr } = await svc
      .from("calls")
      .update({ status: "failed", notes: NOTE })
      .eq("id", row.id)
      .eq("status", "initiated")        // race-safe — don't overwrite if webhook just fired
      .is("aircall_call_id", null);
    if (!upErr) flagged++;
  }

  return NextResponse.json({ dry_run: false, flagged, scanned: stale?.length ?? 0 });
}
