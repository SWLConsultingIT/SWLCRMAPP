// POST /api/campaigns/wizard-signal-stats
//
// For the wizard Step 3 "Signal Coverage" banner in tailored mode.
// Given a set of lead ids, returns how many of them have each of the
// enrichment signals the tailor prompt cares about populated. The
// seller uses this to gauge how personalized the batch will be before
// paying for the per-lead AI run.
//
// Body: { leadIds: string[] }
// Returns: { total, signals: { recent_linkedin_post, recent_website_news, industry_trends, organization_technologies, website_summary, company_mission, call_talking_points } }

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[] };
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter(s => typeof s === "string" && s.length > 0) : [];
  if (leadIds.length === 0) return NextResponse.json({ total: 0, signals: emptySignals() });

  const svc = getSupabaseService();
  // Single SELECT — we count non-null in JS rather than 7 separate COUNTs.
  let q = svc.from("leads")
    .select("id, company_bio_id, recent_linkedin_post, recent_website_news, industry_trends, organization_technologies, website_summary, company_mission, call_talking_points")
    .in("id", leadIds);
  // Tenant guard — non-admins can only count their own leads.
  if (scope.isScoped && scope.companyBioId) q = q.eq("company_bio_id", scope.companyBioId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{
    recent_linkedin_post?: string | null;
    recent_website_news?: string | null;
    industry_trends?: string | null;
    organization_technologies?: string | null;
    website_summary?: string | null;
    company_mission?: string | null;
    call_talking_points?: string | null;
  }>;

  const signals = emptySignals();
  const hasText = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;
  for (const r of rows) {
    if (hasText(r.recent_linkedin_post)) signals.recent_linkedin_post++;
    if (hasText(r.recent_website_news)) signals.recent_website_news++;
    if (hasText(r.industry_trends)) signals.industry_trends++;
    if (hasText(r.organization_technologies)) signals.organization_technologies++;
    if (hasText(r.website_summary)) signals.website_summary++;
    if (hasText(r.company_mission)) signals.company_mission++;
    if (hasText(r.call_talking_points)) signals.call_talking_points++;
  }

  return NextResponse.json({ total: rows.length, signals });
}

function emptySignals() {
  return {
    recent_linkedin_post: 0,
    recent_website_news: 0,
    industry_trends: 0,
    organization_technologies: 0,
    website_summary: 0,
    company_mission: 0,
    call_talking_points: 0,
  };
}
