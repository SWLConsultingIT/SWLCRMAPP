// Real-state signals for the first-run OnboardingChecklist widget.
//
// Replaces the old cosmetic checklist (localStorage toggles that never
// verified anything) with three tenant-scoped existence checks:
//   - linkedin: a seller in this tenant has a Unipile account wired
//   - campaign: at least one campaign exists for this tenant
//   - call:     at least one call is logged against one of this tenant's leads
//
// All three are bounded existence checks (limit 1, no exact count) so this
// stays cheap — no full-table counts, no 1000-row .in() cap. Read-only.
//
// Mirrors the /api/sidebar/badges scoping pattern: getUserScope() once, then
// filter every query by company_bio_id when the caller is tenant-scoped.
import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ linkedin: false, campaign: false, call: false });
  }

  const svc = getSupabaseService();
  const scopedBio = scope.isScoped ? scope.companyBioId : null;

  // LinkedIn — any seller in this tenant with a Unipile account attached.
  const linkedinQ = svc.from("sellers")
    .select("id")
    .not("unipile_account_id", "is", null)
    .limit(1);
  if (scopedBio) linkedinQ.eq("company_bio_id", scopedBio);

  // Campaign — any campaign created for this tenant.
  const campaignQ = svc.from("campaigns")
    .select("id")
    .limit(1);
  if (scopedBio) campaignQ.eq("company_bio_id", scopedBio);

  // Call — any call logged against one of this tenant's leads. calls has no
  // company_bio_id of its own, so scope through the calls→leads FK with an
  // inner embed. limit(1) keeps it an existence probe.
  const callQ = scopedBio
    ? svc.from("calls").select("id, leads!inner(company_bio_id)").eq("leads.company_bio_id", scopedBio).limit(1)
    : svc.from("calls").select("id").limit(1);

  const [linkedin, campaign, call] = await Promise.all([linkedinQ, campaignQ, callQ]);

  return NextResponse.json({
    linkedin: (linkedin.data?.length ?? 0) > 0,
    campaign: (campaign.data?.length ?? 0) > 0,
    call: (call.data?.length ?? 0) > 0,
  });
}
