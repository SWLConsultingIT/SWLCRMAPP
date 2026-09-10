// Lightweight callback context for a lead. Resolves the lead's timezone
// SERVER-SIDE (lead/company country → fallback) so the callback scheduler
// defaults to the LEAD's local time, and returns the most recent call so the UI
// can show "From call · <when>". One small, reusable fetch (also feeds the
// callback-context display in Lead Detail) — not a redundant round-trip.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { resolveDueTimezone } from "@/lib/prospect-time";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: leadId } = await params;
  const svc = getSupabaseService();

  const { data: lead } = await svc
    .from("leads")
    .select("id, company_bio_id, company_country")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (scope.isScoped && scope.companyBioId && (lead as { company_bio_id: string }).company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const timezone = resolveDueTimezone((lead as { company_country: string | null }).company_country, null);

  const { data: calls } = await svc
    .from("calls")
    .select("id, started_at, dialed_by_user_id")
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false })
    .limit(1);
  const lc = calls?.[0] as { id: string; started_at: string | null; dialed_by_user_id: string | null } | undefined;

  return NextResponse.json({
    timezone,
    lastCall: lc ? { id: lc.id, at: lc.started_at, callerId: lc.dialed_by_user_id } : null,
  });
}
