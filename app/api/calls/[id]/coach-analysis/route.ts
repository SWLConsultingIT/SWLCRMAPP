// AI Sales Coach analysis for a single call.
//
// POST /api/calls/{id}/coach-analysis
//   Body: optional { force: boolean } — if true, re-generate even if cached.
//
// Returns the markdown analysis + extracted 0-10 score. First call for a
// given call_id costs ~$0.05 (Opus 4.7 with adaptive thinking + effort=high
// + prompt caching on the static system prompt). Subsequent reads hit the
// cached column for free.
//
// Tenant isolation: the call's lead.company_bio_id must equal the caller's
// scoped tenant. Super-admins are scoped to their own bio on operational
// pages per lib/scope.ts — see feedback_trust_central_scope.md.

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import {
  CALL_COACH_SYSTEM_PROMPT,
  buildCoachUserMessage,
  extractCoachScore,
} from "@/lib/prompts/call-coach";

const MODEL = "claude-opus-4-7";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: callId } = await params;

  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { force } = await req.json().catch(() => ({ force: false }));

  const svc = getSupabaseService();

  // Fetch the call + lead + tenant in one round-trip. Inner join on leads
  // ensures we only return rows whose lead exists; we then enforce tenant
  // scope manually below (service-role bypasses RLS).
  const { data: call, error: callErr } = await svc
    .from("calls")
    .select(
      "id, lead_id, direction, duration, transcript, coach_analysis, coach_score, coach_generated_at, coach_model, leads!inner(primary_first_name, primary_last_name, primary_title_role, company_bio_id, company_bios!inner(name))"
    )
    .eq("id", callId)
    .maybeSingle();

  if (callErr || !call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Tenant gate. The leads + company_bios join returned a nested object —
  // PostgREST shapes it as an array unless we asked for a single row, so
  // we normalize both shapes.
  const lead = Array.isArray((call as any).leads) ? (call as any).leads[0] : (call as any).leads;
  const companyBio = Array.isArray(lead?.company_bios) ? lead.company_bios[0] : lead?.company_bios;
  const leadBioId = lead?.company_bio_id as string | null | undefined;

  if (scope.isScoped && leadBioId && leadBioId !== scope.companyBioId) {
    return NextResponse.json({ error: "Forbidden (cross-tenant)" }, { status: 403 });
  }

  // Return cached unless force=1.
  if (!force && call.coach_analysis) {
    return NextResponse.json({
      analysis: call.coach_analysis,
      score: call.coach_score,
      generatedAt: call.coach_generated_at,
      model: call.coach_model,
      cached: true,
    });
  }

  if (!call.transcript || call.transcript.trim().length < 20) {
    return NextResponse.json(
      { error: "Transcript is empty or too short to analyze" },
      { status: 400 }
    );
  }

  const userMessage = buildCoachUserMessage({
    companyName: companyBio?.name ?? "Unknown Company",
    leadName: `${lead?.primary_first_name ?? ""} ${lead?.primary_last_name ?? ""}`.trim() || "Unknown Lead",
    leadRole: lead?.primary_title_role ?? null,
    campaignName: null, // not in the select for now; can enrich later
    callDirection: call.direction ?? null,
    callDuration: call.duration ?? null,
    transcript: call.transcript,
  });

  const anthropic = new Anthropic();

  // Stream with adaptive thinking — long outputs from Opus 4.7 risk HTTP
  // timeouts on non-streaming calls. We collect into a final message so the
  // caller still gets a single JSON response.
  let analysis: string;
  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 16000,
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
    const msg = e?.message ?? String(e);
    return NextResponse.json({ error: `Coach generation failed: ${msg}` }, { status: 502 });
  }

  if (!analysis || analysis.length < 50) {
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
