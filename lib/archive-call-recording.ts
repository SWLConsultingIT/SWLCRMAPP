// Archive a call's Aircall recording into our own Supabase Storage bucket.
//
// Aircall serves recordings as S3 presigned URLs with a TTL (~hours/days),
// so storing the URL directly on `calls.recording_url` means it expires and
// the in-app audio player breaks. The fix: download the MP3 once, upload to
// our private `call-recordings` bucket, and serve via a tenant-gated
// endpoint that mints fresh signed URLs on demand. After archiving, the
// stored path is permanent — clients can replay months-old calls.
//
// This is safe to call repeatedly (idempotent): when `recording_storage_path`
// is already set we no-op unless `force=true` is passed.

import { getSupabaseService } from "@/lib/supabase-service";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`,
).toString("base64");

const BUCKET = "call-recordings";

export async function archiveCallRecording(callId: string, opts: { force?: boolean } = {}): Promise<{
  ok: boolean;
  reason?: string;
  storage_path?: string;
}> {
  const svc = getSupabaseService();

  // Load the call row with everything we need to scope + fetch.
  const { data: call } = await svc
    .from("calls")
    .select("id, aircall_call_id, lead_id, recording_url, recording_storage_path, leads(company_bio_id)")
    .eq("id", callId)
    .maybeSingle();
  if (!call) return { ok: false, reason: "call not found" };

  if (call.recording_storage_path && !opts.force) {
    return { ok: true, reason: "already archived", storage_path: call.recording_storage_path };
  }
  if (!call.aircall_call_id) {
    return { ok: false, reason: "no aircall_call_id on this call" };
  }

  // Resolve tenant bio id for the storage folder. Fall back to "unscoped" so
  // legacy orphan calls (no lead linkage) still archive.
  const leadRow = Array.isArray(call.leads) ? call.leads[0] : (call.leads as any);
  const tenantBioId: string = leadRow?.company_bio_id ?? "unscoped";

  // 1. Hit Aircall API for a fresh recording URL — the URL on our DB row
  //    might be hours/days old and already expired. The fresh response
  //    contains a newly-signed URL valid for the next ~hour.
  const aircallRes = await fetch(`https://api.aircall.io/v1/calls/${call.aircall_call_id}`, {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    cache: "no-store",
  });
  if (!aircallRes.ok) {
    return { ok: false, reason: `aircall ${aircallRes.status}` };
  }
  const aircallBody = await aircallRes.json().catch(() => ({} as any));
  const freshUrl: string | null =
    aircallBody?.call?.recording ??
    aircallBody?.call?.asset ??
    aircallBody?.call?.voicemail ??
    null;
  if (!freshUrl) {
    return { ok: false, reason: "aircall returned no recording url" };
  }

  // 2. Download the MP3 bytes from Aircall's S3.
  const dlRes = await fetch(freshUrl);
  if (!dlRes.ok) {
    return { ok: false, reason: `s3 download ${dlRes.status}` };
  }
  const buf = Buffer.from(await dlRes.arrayBuffer());
  const contentType = dlRes.headers.get("content-type") ?? "audio/mpeg";

  // 3. Upload to Supabase Storage. Path: <tenant>/<call_id>.mp3 — short,
  //    flat, easy to find. We could partition by month for cold-storage
  //    rules later; not needed today.
  const path = `${tenantBioId}/${call.id}.mp3`;
  const { error: upErr } = await svc.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, upsert: true });
  if (upErr) return { ok: false, reason: `upload: ${upErr.message}` };

  // 4. Persist the storage path so the play endpoint can find it.
  await svc.from("calls").update({ recording_storage_path: path }).eq("id", call.id);

  return { ok: true, storage_path: path };
}
