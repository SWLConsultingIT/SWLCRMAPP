// Reaper cron — recovers `campaign_messages` rows orphaned in `status =
// 'dispatching'` state. Without this, the dispatch pipeline silently loses
// messages whenever a Vercel function times out (or crashes) between the
// claim ('queued' → 'dispatching') and the final 'sent' / 'failed' write.
//
// Why 15 min: Vercel function max is 60s on Pro. Anything stuck > 15 min is
// definitely dead. We leave a wide buffer so we never race a legitimately
// still-running dispatcher.
//
// Safe-by-design:
//   - Only acts on rows where `dispatching_since IS NOT NULL` AND it's older
//     than the threshold. Rows missing the column (legacy / never-claimed
//     via the new path) are ignored — they were never owned by this system.
//   - Atomic UPDATE...WHERE status='dispatching' filter so if a dispatcher
//     manages to flip status to 'sent' between our SELECT and UPDATE, we
//     don't double-process.
//   - Returns the IDs reaped so Orquestador / observability can alert on
//     non-empty payloads (we WANT to know how often this fires).
//
// Auth: same Bearer CRON_SECRET pattern as the other crons. Wire it into
// the n8n Orquestador on the same 15-min cadence as dispatch-queue (or its
// own slightly offset schedule). Roadmap #2 from scale audit 2026-05-14.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const CRON_SECRET = process.env.CRON_SECRET;
const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 min

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const cutoffISO = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
  const nowISO = new Date().toISOString();

  // 1. Find stuck rows so we can read their existing metadata and merge our
  //    forensics field without clobbering anything (eligible_at, queued_by,
  //    rate_limit history, etc).
  const { data: stuck, error: fetchErr } = await svc
    .from("campaign_messages")
    .select("id, campaign_id, lead_id, channel, dispatching_since, metadata")
    .eq("status", "dispatching")
    .lt("dispatching_since", cutoffISO);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  // 2. Reset each row individually. The .eq("status", "dispatching") guard
  //    re-checks atomically — if a still-alive dispatcher manages to flip
  //    the row to 'sent' or 'failed' between our SELECT and this UPDATE,
  //    our update matches 0 rows and we leave it alone. Same logic also
  //    means concurrent reaper invocations don't double-process.
  //
  //    N+1 is fine here: stuck rows should be zero in normal operation,
  //    and the reaper runs every 15 min. We'd much rather pay N+1 than
  //    risk a `metadata = {...}` overwrite.
  const reaped: Array<{ id: string; campaign_id: string; lead_id: string; channel: string; dispatching_since: string }> = [];
  for (const row of stuck ?? []) {
    const mergedMetadata = {
      ...((row.metadata as Record<string, unknown> | null) ?? {}),
      reaper_recovered_at: nowISO,
      reaper_threshold_min: 15,
    };
    const { data: updated } = await svc
      .from("campaign_messages")
      .update({ status: "queued", dispatching_since: null, metadata: mergedMetadata })
      .eq("id", row.id)
      .eq("status", "dispatching")
      .select("id");
    if (updated && updated.length > 0) {
      reaped.push(row as typeof reaped[number]);
    }
  }

  return NextResponse.json({
    ok: true,
    reaped: reaped.length,
    cutoff: cutoffISO,
    rows: reaped.map((r) => ({
      msgId: r.id,
      campaignId: r.campaign_id,
      leadId: r.lead_id,
      channel: r.channel,
      stuckSince: r.dispatching_since,
    })),
  });
}
