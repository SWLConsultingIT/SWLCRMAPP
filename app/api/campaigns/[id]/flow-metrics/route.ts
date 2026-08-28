import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import { parseFilters, resolveFlowMetricsLite } from "@/lib/flow-metrics-compute";

// Dedicated Flow-Metrics endpoint (perf refactor 2026-08-28). The flow page's
// Metrics tab calls this on every filter change so the section recomputes
// WITHOUT re-running the whole flow page (getSiblingCampaigns + decrypt of
// every lead). Decrypt-free: it computes over lead_ids and reads names from
// plaintext columns. Same metric definitions as the initial server render.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Tenant scope — the route uses the service key (bypasses RLS), so a scoped
  // user must not read a flow outside their own company bio.
  if (scope.isScoped) {
    const svc = getSupabaseService();
    const { data: c } = await svc.from("campaigns").select("leads(company_bio_id)").eq("id", id).maybeSingle();
    const bio = (c as { leads?: { company_bio_id?: string | null } } | null)?.leads?.company_bio_id ?? null;
    if (bio && bio !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filters = parseFilters((k) => sp.get(k));
  const t0 = Date.now();
  const res = await resolveFlowMetricsLite(id, filters);
  const ms = Date.now() - t0;
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  // `ms` = server compute time (perf target: <700ms ideal, <1s ok). Visible in
  // the Network tab response so we can profile the PE&VC USA (~1166) case.
  return NextResponse.json({ ...res, range: filters.range, ms }, { headers: { "Cache-Control": "no-store" } });
}
