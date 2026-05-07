import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

// Transcribes an Aircall recording with OpenAI Whisper. Idempotent — if the
// call already has a transcript stored, returns ok without re-spending API
// credits. Used in two places:
//   - Inline from /api/aircall/webhook right after the recording_url lands
//     (so transcripts appear within seconds of the call ending).
//   - Manually from the calls UI for past calls that were never transcribed
//     (Aircall recordings expire ~24h after the call so this only works on
//     recent calls).
//
// Why we run our own transcription instead of Aircall's: Aircall's
// Conversational Intelligence is a paid add-on and not all tenants will
// have it. Whisper is reliable, multi-language (handles ES/EN auto-detect),
// and the cost is ~$0.006/min — negligible for outbound volume.

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { callId } = await req.json().catch(() => ({}));
  if (!callId) return NextResponse.json({ error: "callId required" }, { status: 400 });

  const svc = getSupabaseService();
  const { data: call, error: fetchErr } = await svc
    .from("calls")
    .select("id, recording_url, transcript, aircall_call_id")
    .eq("id", callId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });
  if (!call.aircall_call_id) {
    return NextResponse.json({ error: "no aircall_call_id — cannot fetch recording" }, { status: 400 });
  }
  if (call.transcript && call.transcript.length > 0) {
    return NextResponse.json({ ok: true, alreadyTranscribed: true, transcriptLength: call.transcript.length });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

  // The recording_url stored in our DB is a presigned S3 URL with a short
  // expiry (~36 min). For older calls the saved URL is dead. Always pull a
  // fresh URL from Aircall at transcription time. GET /v1/calls/{id} returns
  // the call resource with a freshly-signed `recording` field on every read.
  const aircallAuth = Buffer.from(
    `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`,
  ).toString("base64");
  const callRes = await fetch(`https://api.aircall.io/v1/calls/${call.aircall_call_id}`, {
    headers: { Authorization: `Basic ${aircallAuth}` },
  });
  if (!callRes.ok) {
    return NextResponse.json({
      error: `Aircall call lookup failed (${callRes.status})`,
    }, { status: 502 });
  }
  const callData = await callRes.json() as { call?: { recording?: string | null; asset?: string | null } };
  const freshRecordingUrl = callData?.call?.recording ?? callData?.call?.asset ?? null;
  if (!freshRecordingUrl) {
    return NextResponse.json({
      error: "Aircall returned no recording URL — the recording may have been deleted or never produced",
    }, { status: 502 });
  }

  // The fresh URL is presigned S3 — it self-authenticates via X-Amz-* query
  // params. Do NOT add a Basic auth header here; S3 rejects it with 400.
  const audioRes = await fetch(freshRecordingUrl);
  if (!audioRes.ok) {
    return NextResponse.json({
      error: `Failed to fetch recording from S3 (${audioRes.status})`,
    }, { status: 502 });
  }
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append("file", audioBlob, "recording.mp3");
  form.append("model", "whisper-1");
  // No language hint — Whisper auto-detects, which matters for SWL since
  // some prospects respond in EN even when the seller opens in ES.

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!whisperRes.ok) {
    const errText = await whisperRes.text();
    return NextResponse.json({ error: `Whisper failed: ${errText}` }, { status: 502 });
  }
  const { text } = await whisperRes.json() as { text?: string };
  const transcript = text?.trim() ?? "";

  await svc.from("calls").update({ transcript }).eq("id", call.id);
  return NextResponse.json({ ok: true, transcriptLength: transcript.length });
}
