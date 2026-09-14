// Campaign wizard — campaign_requests INSERT, relocated from the direct browser
// write in app/campaigns/new/[profileId] so the View-As read-only block
// (proxy.ts) covers it server-side. Uses the RLS server client (user JWT), so
// the same tenant-isolation policy on campaign_requests applies as before; the
// server resolves company_bio_id from scope and never trusts it from the body.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/integrations/supabase/server";
import { getUserScope, canCreateCampaigns } from "@/shared/auth/scope";

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ error: "No tenant" }, { status: 403 });
  if (!canCreateCampaigns(scope.tier)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { request?: Record<string, unknown> };
  const request = body.request;
  if (!request) return NextResponse.json({ error: "Missing request" }, { status: 400 });

  const sb = await getSupabaseServer();
  const { data, error } = await sb
    .from("campaign_requests")
    // company_bio_id is pinned to the caller's tenant, never taken from the body.
    .insert({ ...request, company_bio_id: scope.companyBioId, status: "pending_review" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id });
}
