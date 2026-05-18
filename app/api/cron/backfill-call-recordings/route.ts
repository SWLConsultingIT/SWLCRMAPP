// Backfill: archive call recordings into Supabase Storage for calls that
// pre-date the auto-archive infrastructure (commits before c5b5c9e).
//
// Idempotent. Safe to re-run. Skips rows where `recording_storage_path` is
// already set. Auth via CRON_SECRET. Paginated via `?limit=` (default 10,
// max 50) so a single Vercel invocation doesn't time out on a long backlog.
//
// One-off use: curl with Authorization: Bearer <CRON_SECRET> until
// `remaining: 0`.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { archiveCallRecording } from "@/lib/archive-call-recording";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10)));

  const svc = getSupabaseService();
  const { data: rows } = await svc
    .from("calls")
    .select("id")
    .not("recording_url", "is", null)
    .is("recording_storage_path", null)
    .order("started_at", { ascending: false })
    .limit(limit);

  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  for (const r of rows ?? []) {
    const out = await archiveCallRecording(r.id);
    results.push({ id: r.id, ok: out.ok, reason: out.reason });
  }

  // Re-count remaining so the caller knows when to stop.
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
