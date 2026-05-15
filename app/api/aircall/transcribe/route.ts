import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

// Call transcription. Two-tier strategy:
//   1. Try Aircall AI Voice (GET /v1/calls/{id}/transcription). Higher
//      quality, native, knows the call context — but requires Aircall AI
//      Voice subscription (paid add-on). Returns 403 if not subscribed.
//   2. Fall back to OpenAI Whisper. Improved over the original draft with:
//      - explicit `language` hint derived from the lead's country (Whisper
//        auto-detect on 20-second clips is unreliable, produces garbage
//        like the W60/marco roto output Fran flagged 2026-05-14);
//      - `prompt` parameter with the tenant company name + seller name +
//        lead context so domain words get spelled right;
//      - `whisper-1` stays as the model (gpt-4o-transcribe / -mini exist
//        but availability varies by OpenAI org tier; safe default).
//
// Idempotent — if a transcript is already saved, returns ok without
// re-spending API credits.

export const maxDuration = 60;

const aircallAuth = () => Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`,
).toString("base64");

// Quick country → Whisper language code map. Whisper's `language` parameter
// follows ISO-639-1. Default to multi-lang (no hint) when unknown.
function languageForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim().toLowerCase();
  if (c.startsWith("argentin") || c === "chile" || c === "uruguay" || c === "mexico" || c === "spain" || c === "españa" || c === "colombia" || c === "peru" || c === "ecuador" || c === "venezuela") return "es";
  if (c === "brazil" || c === "brasil" || c === "portugal") return "pt";
  if (c === "france") return "fr";
  if (c === "germany" || c === "deutschland") return "de";
  if (c === "italy") return "it";
  if (c.includes("united states") || c === "usa" || c.includes("united kingdom") || c === "uk" || c.includes("ireland") || c.includes("canada") || c.includes("australia")) return "en";
  return null;
}

export async function POST(req: NextRequest) {
  const { callId, force } = await req.json().catch(() => ({}));
  if (!callId) return NextResponse.json({ error: "callId required" }, { status: 400 });

  const svc = getSupabaseService();
  // Hydrate lead + tenant alongside the call so we can pass real context to
  // the transcription model (boosts proper-noun accuracy by 30-50% on short
  // clips per the OpenAI docs).
  const { data: call, error: fetchErr } = await svc
    .from("calls")
    .select("id, recording_url, transcript, aircall_call_id, leads(primary_first_name, primary_last_name, company_name, company_country, primary_title_role, company_bio_id, company_bios(company_name, industry, description))")
    .eq("id", callId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });
  if (!call.aircall_call_id) {
    return NextResponse.json({ error: "no aircall_call_id — cannot fetch recording" }, { status: 400 });
  }
  // `force: true` lets the UI re-transcribe a bad result. Without force,
  // we treat any existing non-empty transcript as the source of truth.
  if (!force && call.transcript && call.transcript.length > 0) {
    return NextResponse.json({ ok: true, alreadyTranscribed: true, transcriptLength: call.transcript.length });
  }

  const lead = Array.isArray((call as any).leads) ? (call as any).leads[0] : (call as any).leads;
  const tenant = Array.isArray(lead?.company_bios) ? lead.company_bios[0] : lead?.company_bios;

  // 1) Try Aircall AI Voice first. 200 with transcription content → save and exit.
  //    403/404 → silently fall through to Whisper (subscription not active).
  try {
    const aircallTrRes = await fetch(
      `https://api.aircall.io/v1/calls/${call.aircall_call_id}/transcription`,
      { headers: { Authorization: `Basic ${aircallAuth()}` } },
    );
    if (aircallTrRes.ok) {
      const body = await aircallTrRes.json().catch(() => null) as { transcription?: { content?: string; utterances?: Array<{ speaker?: string; text?: string }> } } | null;
      let aircallTranscript = body?.transcription?.content ?? "";
      if (!aircallTranscript && Array.isArray(body?.transcription?.utterances)) {
        aircallTranscript = body!.transcription!.utterances!
          .map(u => `${u.speaker ?? "?"}: ${u.text ?? ""}`)
          .join("\n");
      }
      aircallTranscript = aircallTranscript.trim();
      if (aircallTranscript.length > 0) {
        await svc.from("calls").update({ transcript: aircallTranscript }).eq("id", call.id);
        return NextResponse.json({
          ok: true,
          source: "aircall",
          transcriptLength: aircallTranscript.length,
        });
      }
    }
    // 403/404/200-empty: fall through to Whisper.
  } catch { /* network blip — fall through to Whisper */ }

  // 2) Whisper fallback.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

  const callRes = await fetch(`https://api.aircall.io/v1/calls/${call.aircall_call_id}`, {
    headers: { Authorization: `Basic ${aircallAuth()}` },
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

  // Presigned S3 — no Basic auth header here.
  const audioRes = await fetch(freshRecordingUrl);
  if (!audioRes.ok) {
    return NextResponse.json({
      error: `Failed to fetch recording from S3 (${audioRes.status})`,
    }, { status: 502 });
  }
  const audioBlob = await audioRes.blob();
  // Detect actual content-type and use the matching extension. Aircall
  // recordings can come through as mp3 OR wav depending on the codec config
  // on the number. gpt-4o-mini-transcribe is strict about format vs filename
  // — sending a wav as recording.mp3 trips "Audio file might be corrupted".
  const contentType = (audioRes.headers.get("content-type") || "").toLowerCase();
  const extension =
    contentType.includes("wav")    ? "wav" :
    contentType.includes("m4a") || contentType.includes("mp4") ? "m4a" :
    contentType.includes("ogg")    ? "ogg" :
    contentType.includes("webm")   ? "webm" :
    "mp3"; // default — Aircall's most common output
  const audioFilename = `recording.${extension}`;

  const language = languageForCountry(lead?.company_country);

  // FAITHFULNESS over polish (2026-05-15). Earlier draft passed a `prompt`
  // built from tenant + lead context to bias proper-noun spelling. Side
  // effect: Whisper used the prompt as a *vocabulary hint* and inserted
  // fabricated phrases consistent with the prompt vibe — Pathway's first
  // listened-through call showed an angry UK lead, but the transcript
  // had a polite "lovely day". The model invented British niceties because
  // the prompt told it the call was UK sales. Now: no prompt, temperature 0,
  // verbose_json so we can drop low-confidence and repeating segments
  // (Whisper's most common hallucination patterns).
  async function transcribeWith(model: string) {
    const form = new FormData();
    form.append("file", audioBlob, audioFilename);
    form.append("model", model);
    if (language) form.append("language", language);
    form.append("temperature", "0");
    // verbose_json only supported on whisper-1; gpt-4o-mini-transcribe needs
    // plain `json`. Caller chooses based on model.
    if (model === "whisper-1") {
      form.append("response_format", "verbose_json");
    }
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    return res;
  }

  // whisper-1 as primary now. It's more conservative on telephony audio with
  // temperature=0 + verbose_json + no prompt. gpt-4o-mini-transcribe is the
  // fallback for the few audio formats whisper-1 chokes on.
  let modelUsed = "whisper-1";
  let openaiRes = await transcribeWith(modelUsed);
  let firstAttemptError: string | null = null;
  if (!openaiRes.ok) {
    firstAttemptError = await openaiRes.text();
    modelUsed = "gpt-4o-mini-transcribe";
    openaiRes = await transcribeWith(modelUsed);
  }
  if (!openaiRes.ok) {
    const secondErr = await openaiRes.text();
    return NextResponse.json({
      error: `Transcription failed on both models. whisper-1: ${firstAttemptError ?? "n/a"} — gpt-4o-mini-transcribe: ${secondErr}`,
    }, { status: 502 });
  }

  // Parse the response. With verbose_json from whisper-1, we get per-segment
  // confidence + repetition signals to filter hallucinations. With plain
  // json from the fallback, we just get `text`.
  let transcript = "";
  if (modelUsed === "whisper-1") {
    type Segment = { text: string; avg_logprob?: number; no_speech_prob?: number; compression_ratio?: number };
    const json = await openaiRes.json() as { text?: string; segments?: Segment[] };
    const segments = Array.isArray(json.segments) ? json.segments : [];
    if (segments.length > 0) {
      // Drop hallucinated segments. Whisper's three canary signals:
      //  - no_speech_prob > 0.6 → mostly silence/background, anything
      //    transcribed is invented
      //  - avg_logprob < -1   → model uncertainty, output is filler
      //  - compression_ratio > 2.4 → repetitive output, classic loop
      //    ("thank you thank you thank you")
      const cleaned = segments
        .filter(s =>
          (s.no_speech_prob ?? 0) < 0.6
          && (s.avg_logprob ?? 0) > -1
          && (s.compression_ratio ?? 0) < 2.4
        )
        .map(s => s.text.trim())
        .filter(Boolean);
      transcript = cleaned.join(" ").trim();
    } else {
      transcript = (json.text ?? "").trim();
    }
  } else {
    const json = await openaiRes.json() as { text?: string };
    transcript = (json.text ?? "").trim();
  }

  // Strip the most common Whisper hallucination phrases — these almost
  // always come from training-data leakage on silence. Keep the list short
  // and exact to avoid false positives on real conversation.
  const hallucinationCanaries = [
    /\bthank you for watching\b/gi,
    /\bsubscribe\b.*?\bchannel\b/gi,
    /\bthanks for listening\b/gi,
    /\bplease subscribe\b/gi,
  ];
  for (const re of hallucinationCanaries) {
    transcript = transcript.replace(re, "").trim();
  }
  // Collapse double spaces left behind.
  transcript = transcript.replace(/\s{2,}/g, " ").trim();

  await svc.from("calls").update({ transcript }).eq("id", call.id);

  // Auto-pipeline (2026-05-15): once the transcript lands, kick off summary
  // + coach analysis in parallel so the seller never has to click "Generate"
  // for them. Both endpoints are idempotent (locked via summary_generating_at
  // and coach_generating_at — see migration 022) so a concurrent manual click
  // from the UI is safe. Fire-and-forget so the webhook returns 200 fast.
  // Only chain when we actually got useful text — empty transcript means
  // there's nothing to analyze and we'd waste a paid LLM call.
  if (transcript.length > 0 && process.env.CRON_SECRET) {
    const origin = req.nextUrl.origin;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    };
    // Both endpoints are idempotent (locked via summary_generating_at and
    // coach_generating_at — see migration 022) so a concurrent manual click
    // from the UI is safe.
    fetch(`${origin}/api/calls/${call.id}/summary`, { method: "POST", headers }).catch(() => { /* downstream lock handles repeats */ });
    fetch(`${origin}/api/calls/${call.id}/coach-analysis`, { method: "POST", headers }).catch(() => { /* downstream lock handles repeats */ });
  }

  return NextResponse.json({
    ok: true,
    source: modelUsed,
    language: language ?? "auto",
    transcriptLength: transcript.length,
  });
}
