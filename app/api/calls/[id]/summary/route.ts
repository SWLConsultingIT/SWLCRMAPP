// Brief 1-2 sentence call summary using Claude Haiku 4.5.
//
// POST /api/calls/[id]/summary
//   Body: optional { force: boolean } — re-generate even if cached.
//
// Why Haiku 4.5 and not Sonnet/Opus: the task is short summarization where
// quality difference is marginal but cost difference is 5-15×. Haiku also
// returns faster (~2-4s vs ~10-20s for Opus), which matters because this
// endpoint runs auto-magically when a transcript lands — we don't want a
// long blocking call in the webhook chain.

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const MODEL = "claude-haiku-4-5";
const GENERATION_LOCK_MS = 90 * 1000;

const SYSTEM_PROMPT = `You write brutally concise call summaries for B2B sales operators. One or two sentences max. State exactly what happened and whether the call moved the deal forward, was negative, or needs follow-up. Do not add coaching, do not add commentary, do not add disclaimers. If the call has too little signal (under 10 seconds, voicemail, no answer), say so plainly.`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: callId } = await params;
  // Dual-auth: regular user cookie session (manual click in CallCard) OR
  // internal Bearer CRON_SECRET (auto-pipeline kicked off by the transcribe
  // webhook). Same pattern the cron endpoints use.
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const cronOk = !!process.env.CRON_SECRET && presented === process.env.CRON_SECRET;
  const scope = await getUserScope();
  if (!cronOk && !scope.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();

  const { data: call, error: callErr } = await svc
    .from("calls")
    .select(
      "id, lead_id, direction, duration, transcript, summary, summary_generated_at, summary_model, summary_generating_at, leads!inner(primary_first_name, primary_last_name, primary_title_role, company_bio_id, company_bios!inner(company_name))"
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

  // Cached result wins — one generation per call.
  if (call.summary) {
    return NextResponse.json({
      summary: call.summary,
      generatedAt: call.summary_generated_at,
      model: call.summary_model,
      cached: true,
    });
  }

  // Lock check.
  const generatingAt = call.summary_generating_at as string | null;
  if (generatingAt) {
    const ageMs = Date.now() - new Date(generatingAt).getTime();
    if (ageMs < GENERATION_LOCK_MS) {
      return NextResponse.json(
        { error: "Generation already in progress, please wait", inProgress: true },
        { status: 409 }
      );
    }
  }

  if (!call.transcript || call.transcript.trim().length < 10) {
    return NextResponse.json(
      { error: "Transcript too short to summarize" },
      { status: 400 }
    );
  }

  // Atomic lock acquire.
  const lockTime = new Date().toISOString();
  const { data: locked } = await svc
    .from("calls")
    .update({ summary_generating_at: lockTime })
    .eq("id", callId)
    .is("summary", null)
    .or(`summary_generating_at.is.null,summary_generating_at.lt.${new Date(Date.now() - GENERATION_LOCK_MS).toISOString()}`)
    .select("id");

  if (!locked || locked.length === 0) {
    const { data: refreshed } = await svc
      .from("calls")
      .select("summary, summary_generated_at, summary_model")
      .eq("id", callId)
      .maybeSingle();
    if (refreshed?.summary) {
      return NextResponse.json({
        summary: refreshed.summary,
        generatedAt: refreshed.summary_generated_at,
        model: refreshed.summary_model,
        cached: true,
      });
    }
    return NextResponse.json(
      { error: "Generation already in progress, please wait", inProgress: true },
      { status: 409 }
    );
  }

  const durationLabel = call.duration
    ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s`
    : "unknown";
  const userMessage = [
    `COMPANY: ${companyBio?.company_name ?? "Unknown"}`,
    `LEAD: ${`${lead?.primary_first_name ?? ""} ${lead?.primary_last_name ?? ""}`.trim() || "Unknown"}${lead?.primary_title_role ? ` (${lead.primary_title_role})` : ""}`,
    `CALL: ${call.direction ?? "unknown"}, ${durationLabel}`,
    "",
    "TRANSCRIPT:",
    call.transcript,
    "",
    "Write 1-2 sentence summary in the same language as the transcript.",
  ].join("\n");

  const anthropic = new Anthropic();
  let summary: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200, // Hard cap — summary is 1-2 sentences, ~50 tokens.
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }, // Cached across all calls
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });
    summary = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
  } catch (e: any) {
    await svc.from("calls").update({ summary_generating_at: null }).eq("id", callId);
    return NextResponse.json({ error: `Summary failed: ${e?.message ?? "unknown"}` }, { status: 502 });
  }

  if (!summary || summary.length < 5) {
    await svc.from("calls").update({ summary_generating_at: null }).eq("id", callId);
    return NextResponse.json({ error: "Empty summary returned" }, { status: 502 });
  }

  const nowISO = new Date().toISOString();
  await svc
    .from("calls")
    .update({
      summary,
      summary_generated_at: nowISO,
      summary_model: MODEL,
      summary_generating_at: null,
    })
    .eq("id", callId);

  return NextResponse.json({
    summary,
    generatedAt: nowISO,
    model: MODEL,
    cached: false,
  });
}
