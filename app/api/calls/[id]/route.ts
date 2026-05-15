// Single-call read + delete.
//
// GET — lightweight projection used by CallSummary + CallCoachAnalysis when
//   they're polling for auto-pipeline results (transcribe webhook fired but
//   summary/coach hasn't landed yet). Returns just the fields those two
//   components care about so the polling stays cheap.
//
// DELETE — soft-removes a row from the CRM. Aircall is still source of
//   truth; the user can re-sync if they remove the wrong row. Auth: at
//   least manager (sellers can't hide their own missed-call history).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("calls")
    .select("id, transcript, summary, summary_generated_at, summary_model, coach_analysis, coach_score, coach_generated_at, coach_model, leads!inner(company_bio_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (scope.isScoped) {
    type LeadJoin = { company_bio_id?: string | null };
    const leadJoin = (data as { leads?: LeadJoin | LeadJoin[] | null }).leads;
    const bio = (Array.isArray(leadJoin) ? leadJoin[0]?.company_bio_id : leadJoin?.company_bio_id) ?? null;
    if (!bio || bio !== scope.companyBioId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({
    id: data.id,
    transcript: data.transcript,
    summary: data.summary,
    summary_generated_at: data.summary_generated_at,
    summary_model: data.summary_model,
    coach_analysis: data.coach_analysis,
    coach_score: data.coach_score,
    coach_generated_at: data.coach_generated_at,
    coach_model: data.coach_model,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!canViewAllTenantData(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const svc = getSupabaseService();
  const { error } = await svc.from("calls").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
