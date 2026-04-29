import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserScope, DEMO_SESSION_COOKIE } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// DELETE /api/admin/demos/[id]
// Hard-deletes a demo tenant + everything that hangs off it. Refuses to touch
// rows that aren't is_demo=true so a stale URL can't nuke a real client.
//
// Order matters: child rows first (so FK constraints don't fail), then the
// company_bios row last. We also clear the demo-session cookie if the admin
// happened to be inside this very demo while deleting.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (scope.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: bioId } = await ctx.params;
  const svc = getSupabaseService();

  // 1) Verify target is a demo. Anything else and we bail.
  const { data: bio } = await svc
    .from("company_bios")
    .select("id, is_demo, company_name")
    .eq("id", bioId)
    .eq("is_demo", true)
    .maybeSingle();
  if (!bio?.id) {
    return NextResponse.json({ error: "Not a demo tenant" }, { status: 404 });
  }

  // 2) Get all leads in the demo so we can clean their child rows.
  const { data: demoLeads } = await svc.from("leads").select("id").eq("company_bio_id", bioId);
  const leadIds = (demoLeads ?? []).map(l => l.id);

  // 3) Get all campaigns so we can clean campaign_messages.
  const { data: demoCampaigns } = await svc.from("campaigns").select("id").eq("company_bio_id", bioId);
  const campaignIds = (demoCampaigns ?? []).map(c => c.id);

  // 4) Cascade. Each step is idempotent — empty `in()` filters short-circuit
  //    cleanly via the conditional, so we don't fire pointless deletes.
  if (campaignIds.length > 0) {
    await svc.from("campaign_messages").delete().in("campaign_id", campaignIds);
  }
  if (leadIds.length > 0) {
    await svc.from("lead_replies").delete().in("lead_id", leadIds);
  }
  await svc.from("campaigns").delete().eq("company_bio_id", bioId);
  await svc.from("campaign_requests").delete().eq("company_bio_id", bioId);
  await svc.from("icp_profiles").delete().eq("company_bio_id", bioId);
  await svc.from("leads").delete().eq("company_bio_id", bioId);
  await svc.from("sellers").delete().eq("company_bio_id", bioId);

  // Finally the bio row itself.
  const { error: bioErr } = await svc.from("company_bios").delete().eq("id", bioId).eq("is_demo", true);
  if (bioErr) {
    return NextResponse.json({ error: bioErr.message }, { status: 500 });
  }

  // If the admin was currently impersonating this demo, drop the cookie so
  // the next page render snaps back to SWL admin scope.
  const cookieStore = await cookies();
  const current = cookieStore.get(DEMO_SESSION_COOKIE)?.value;
  if (current === bioId) {
    cookieStore.set(DEMO_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }

  return NextResponse.json({ ok: true, deletedBioId: bioId, deletedLeadCount: leadIds.length, deletedCampaignCount: campaignIds.length });
}
