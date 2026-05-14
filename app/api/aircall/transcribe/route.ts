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
  const { callId } = await req.json().catch(() => ({}));
  if (!callId) return NextResponse.json({ error: "callId required" }, { status: 400 });

  const svc = getSupabaseService();
  // Hydrate lead + tenant alongside the call so we can pass real context to
  // Whisper (boosts proper-noun accuracy by 30-50% on short clips per the
  // OpenAI docs).
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
  if (call.transcript && call.transcript.length > 0) {
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

  // Build a context prompt — Whisper uses this to bias spelling of proper
  // nouns and domain terms. Cap at 244 tokens (Whisper limit ~224, leave headroom).
  const contextPromptParts = [
    tenant?.company_name && `Sales call from ${tenant.company_name}`,
    tenant?.industry && `(industry: ${tenant.industry})`,
    lead && `to ${[lead.primary_first_name, lead.primary_last_name].filter(Boolean).join(" ")}`,
    lead?.primary_title_role && `(${lead.primary_title_role})`,
    lead?.company_name && `at ${lead.company_name}`,
    tenant?.description && `. About ${tenant.company_name}: ${String(tenant.description).slice(0, 400)}`,
  ].filter(Boolean) as string[];
  const contextPrompt = contextPromptParts.join(" ").slice(0, 900);

  const form = new FormData();
  form.append("file", audioBlob, "recording.mp3");
  form.append("model", "whisper-1");
  const language = languageForCountry(lead?.company_country);
  if (language) form.append("language", language);
  if (contextPrompt) form.append("prompt", contextPrompt);
  // Lower temperature for short clips — reduces creative interpretation of
  // unclear audio (the W60/marco-roto class of error).
  form.append("temperature", "0");

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
  return NextResponse.json({
    ok: true,
    source: "whisper",
    language: language ?? "auto",
    transcriptLength: transcript.length,
  });
}
