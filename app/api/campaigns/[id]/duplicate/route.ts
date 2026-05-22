import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Duplicate a campaign — clones the campaign_request that originally spawned
// it. The new request lands as 'pending_review' so the existing approval
// flow handles it; we don't bypass review just because the seller liked the
// original template.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = getSupabaseService();

  // 1. Look up the source campaign + its originating campaign_request (if
  // there is one — older campaigns predate the request flow).
  const { data: campaign, error: cErr } = await svc
    .from("campaigns")
    .select("id, name, channel, sequence_steps, template_id, lead_id, leads!inner(company_bio_id, icp_profile_id)")
    .eq("id", id)
    .single();
  if (cErr || !campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  // Tenant guard: a scoped user can only duplicate within their own bio.
  const leadBioId = (campaign as any).leads?.company_bio_id as string | undefined;
  if (scope.isScoped && scope.companyBioId && leadBioId !== scope.companyBioId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 2. Try to find the original campaign_request by name + icp. (We don't
  // store a direct FK, so this is heuristic but stable enough.)
  const icpId = (campaign as any).leads?.icp_profile_id as string | null;
  let sourceRequest: { id: string; name: string; message_prompts: unknown; icp_profile_id: string | null } | null = null;
  if (icpId) {
    const { data } = await svc
      .from("campaign_requests")
      .select("id, name, message_prompts, icp_profile_id")
      .eq("icp_profile_id", icpId)
      .eq("name", campaign.name)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    sourceRequest = data;
  }

  if (!sourceRequest) {
    return NextResponse.json({
      error: "No original campaign request found for this campaign. Save it as a template first.",
    }, { status: 404 });
  }

  // 3. Insert the duplicate.
  const newName = `Copy of ${sourceRequest.name}`;
  const { data: inserted, error: iErr } = await svc
    .from("campaign_requests")
    .insert({
      name: newName,
      icp_profile_id: sourceRequest.icp_profile_id,
      message_prompts: sourceRequest.message_prompts,
      status: "pending_review",
    })
    .select("id")
    .single();
  if (iErr || !inserted) {
    return NextResponse.json({ error: iErr?.message ?? "Failed to duplicate" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, requestId: inserted.id, name: newName });
}
