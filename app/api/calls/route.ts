import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser } from "@/lib/require-scope";

export async function GET(req: NextRequest) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const leadIds = searchParams.get("leadIds");
  if (!leadIds) return NextResponse.json({ calls: [] });

  const ids = leadIds.split(",").map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ calls: [] });

  const svc = getSupabaseService();
  // Join the owning lead's company_bio_id so we can drop any call whose lead is
  // outside the caller's tenant (transcripts/recordings are the most sensitive
  // artifacts — they must never leak cross-tenant via ?leadIds= enumeration).
  const { data, error } = await svc
    .from("calls")
    .select("id, aircall_call_id, lead_id, direction, status, duration, phone_number, recording_url, recording_storage_path, transcript, notes, started_at, ended_at, classification, ai_confidence, ai_summary, coach_analysis, coach_score, coach_generated_at, coach_model, summary, summary_generated_at, leads!inner(company_bio_id)")
    .in("lead_id", ids)
    .order("started_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = (data ?? []) as Array<Record<string, unknown> & { leads?: { company_bio_id?: string | null } | Array<{ company_bio_id?: string | null }> | null }>;
  if (g.scope?.isScoped) {
    rows = rows.filter((r) => {
      const lj = r.leads;
      const bio = Array.isArray(lj) ? lj[0]?.company_bio_id : lj?.company_bio_id;
      return bio === g.scope!.companyBioId;
    });
  }
  // Strip the join so the response shape matches the pre-guard contract.
  const calls = rows.map(({ leads: _leads, ...rest }) => rest);
  return NextResponse.json({ calls });
}
