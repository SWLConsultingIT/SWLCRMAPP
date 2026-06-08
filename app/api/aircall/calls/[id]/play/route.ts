// GET /api/aircall/calls/{id}/play — tenant-gated, permanent-URL audio
// playback for an archived call recording.
//
// Behaviour:
//   - If the call has `recording_storage_path` set, mint a short-lived
//     signed URL (1h) and 302-redirect to it. Browser <audio> follows
//     the redirect transparently — to the player it looks like a static
//     mp3 URL.
//   - If the call hasn't been archived yet, kick off `archiveCallRecording`
//     synchronously (it's quick — 1-5s for a 1-min call) and then redirect.
//     This handles the very-first play on a freshly-received call where
//     the webhook archive hasn't run yet, and the backfill for older
//     calls that pre-date the archive flow.
//   - Cross-tenant access returns 404 (not 403) to avoid leaking
//     existence of other tenants' calls.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { archiveCallRecording } from "@/lib/archive-call-recording";

const BUCKET = "call-recordings";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = getSupabaseService();

  // Tenant-scope check via the lead's bio. Super-admin sees everything.
  const { data: call } = await svc
    .from("calls")
    .select("id, recording_storage_path, aircall_call_id, lead_id, started_at, leads!inner(company_bio_id)")
    .eq("id", id)
    .maybeSingle();
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const leadRow = Array.isArray(call.leads) ? call.leads[0] : (call.leads as any);
  if (scope.tier !== "super_admin" && leadRow?.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve which call row actually carries the Aircall recording. A single
  // dial creates up to two rows — a dial-marker (no aircall_call_id) + the
  // Aircall webhook record (has aircall_call_id + recording). If the UI played
  // the marker row, archiving it fails ("no aircall_call_id"). Fall back to the
  // sibling Aircall row for the same lead within ±10 min (boss 2026-06-08:
  // recording not showing). Markers with NO sibling = genuinely no recording.
  let targetId = call.id as string;
  let storagePath = call.recording_storage_path as string | null;
  if (!storagePath && !call.aircall_call_id && call.lead_id && call.started_at) {
    const t = new Date(call.started_at).getTime();
    const { data: siblings } = await svc
      .from("calls")
      .select("id, recording_storage_path, started_at")
      .eq("lead_id", call.lead_id)
      .not("aircall_call_id", "is", null)
      .gte("started_at", new Date(t - 10 * 60_000).toISOString())
      .lte("started_at", new Date(t + 10 * 60_000).toISOString())
      .order("started_at", { ascending: true })
      .limit(1);
    const sib = siblings?.[0];
    if (sib) { targetId = sib.id; storagePath = (sib.recording_storage_path as string | null) ?? null; }
  }

  // Lazy archive on first play. Synchronous because we need the path to
  // mint the signed URL right now. Aircall calls are small (~1-30MB) so
  // this completes within Vercel's serverless timeout.
  if (!storagePath) {
    const result = await archiveCallRecording(targetId);
    if (!result.ok || !result.storage_path) {
      return NextResponse.json({ error: result.reason ?? "Recording unavailable" }, { status: 404 });
    }
    storagePath = result.storage_path;
  }

  // 1-hour signed URL. The browser re-requests this endpoint when the
  // audio element reloads, so a short TTL is fine — and avoids leaking
  // long-lived URLs through copy-paste / shares.
  const { data: signed } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (!signed?.signedUrl) {
    return NextResponse.json({ error: "Couldn't generate URL" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
