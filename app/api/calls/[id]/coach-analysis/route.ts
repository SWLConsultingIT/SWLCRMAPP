// AI Sales Coach analysis for a single call.
//
// POST /api/calls/{id}/coach-analysis
//
// One generation per call by design (Fran 2026-05-14: "una vez por
// llamada"). Once `coach_analysis` is set we always return cached — no
// `force` knob exposed publicly. To prevent double-spend on rapid
// clicks before the cache write lands, we stamp `coach_generating_at`
// at the start of the run and gate new requests on it within a 90-second
// window. On failure we clear the lock so the user can retry.
//
// Model: Sonnet 4.6 (downgraded from Opus 4.7 — same structure quality
// for this task, ~60% cheaper, ~2x faster). Cost ~$0.02 per call,
// shared across the prompt-cached system text.

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import {
  CALL_COACH_SYSTEM_PROMPT,
  buildCoachUserMessage,
  extractCoachScore,
} from "@/lib/prompts/call-coach";

const MODEL = "claude-sonnet-4-6";
const GENERATION_LOCK_MS = 90 * 1000;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: callId } = await params;

  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();

  const { data: call, error: callErr } = await svc
    .from("calls")
    .select(
      "id, lead_id, direction, duration, transcript, coach_analysis, coach_score, coach_generated_at, coach_model, coach_generating_at, leads!inner(primary_first_name, primary_last_name, primary_title_role, company_bio_id, company_bios!inner(company_name))"
    )
    .eq("id", callId)
    .maybeSingle();

  if (callErr || !call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const lead = Array.isArray((call as any).leads) ? (call as any).leads[0] : (call as any).leads;
  const companyBio = Array.isArray(lead?.company_bios) ? lead.company_bios[0] : lead?.company_bios;
  const leadBioId = lead?.company_bio_id as string | null | undefined;

  if (scope.isScoped && leadBioId && leadBioId !== scope.companyBioId) {
    return NextResponse.json({ error: "Forbidden (cross-tenant)" }, { status: 403 });
  }

  // Cached result wins — no public force knob.
  if (call.coach_analysis) {
    return NextResponse.json({
      analysis: call.coach_analysis,
      score: call.coach_score,
      generatedAt: call.coach_generated_at,
      model: call.coach_model,
      cached: true,
    });
  }

  // Generation lock — protects against rapid double-click double-spend.
  const generatingAt = call.coach_generating_at as string | null;
  if (generatingAt) {
    const ageMs = Date.now() - new Date(generatingAt).getTime();
    if (ageMs < GENERATION_LOCK_MS) {
      return NextResponse.json(
        { error: "Generation already in progress, please wait", inProgress: true },
        { status: 409 }
      );
    }
    // Lock is stale (>90s) — assume the previous attempt died; allow new run.
  }

  if (!call.transcript || call.transcript.trim().length < 20) {
    return NextResponse.json(
      { error: "Transcript is empty or too short to analyze" },
      { status: 400 }
    );
  }

  // Acquire the lock atomically — re-check no analysis exists in the same
  // UPDATE so a winning concurrent request's cache write isn't stomped.
  const lockTime = new Date().toISOString();
  const { data: locked } = await svc
    .from("calls")
    .update({ coach_generating_at: lockTime })
    .eq("id", callId)
    .is("coach_analysis", null)
    .or(`coach_generating_at.is.null,coach_generating_at.lt.${new Date(Date.now() - GENERATION_LOCK_MS).toISOString()}`)
    .select("id");

  if (!locked || locked.length === 0) {
    // Either coach_analysis got populated between our SELECT and UPDATE,
    // or another request took the lock first. Re-read and return current state.
    const { data: refreshed } = await svc
      .from("calls")
      .select("coach_analysis, coach_score, coach_generated_at, coach_model")
      .eq("id", callId)
      .maybeSingle();
    if (refreshed?.coach_analysis) {
      return NextResponse.json({
        analysis: refreshed.coach_analysis,
        score: refreshed.coach_score,
        generatedAt: refreshed.coach_generated_at,
        model: refreshed.coach_model,
        cached: true,
      });
    }
    return NextResponse.json(
      { error: "Generation already in progress, please wait", inProgress: true },
      { status: 409 }
    );
  }

  const userMessage = buildCoachUserMessage({
    companyName: companyBio?.company_name ?? "Unknown Company",
    leadName: `${lead?.primary_first_name ?? ""} ${lead?.primary_last_name ?? ""}`.trim() || "Unknown Lead",
    leadRole: lead?.primary_title_role ?? null,
    campaignName: null,
    callDirection: call.direction ?? null,
    callDuration: call.duration ?? null,
    transcript: call.transcript,
  });

  const anthropic = new Anthropic();

  let analysis: string;
  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 4000, // Sonnet 4.6 doesn't need 16k for this structured output
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [
        {
          type: "text",
          text: CALL_COACH_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });
    const finalMessage = await stream.finalMessage();
    analysis = finalMessage.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } catch (e: any) {
    // Release the lock so the user can retry.
    await svc.from("calls").update({ coach_generating_at: null }).eq("id", callId);
    const msg = e?.message ?? String(e);
    return NextResponse.json({ error: `Coach generation failed: ${msg}` }, { status: 502 });
  }

  if (!analysis || analysis.length < 50) {
    await svc.from("calls").update({ coach_generating_at: null }).eq("id", callId);
    return NextResponse.json(
      { error: "Coach returned empty analysis — try again" },
      { status: 502 }
    );
  }

  const score = extractCoachScore(analysis);
  const nowISO = new Date().toISOString();

  await svc
    .from("calls")
    .update({
      coach_analysis: analysis,
      coach_score: score,
      coach_generated_at: nowISO,
      coach_model: MODEL,
      coach_generating_at: null,
    })
    .eq("id", callId);

  return NextResponse.json({
    analysis,
    score,
    generatedAt: nowISO,
    model: MODEL,
    cached: false,
  });
}
