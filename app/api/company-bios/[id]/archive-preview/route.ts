// Returns the count of leads / campaigns / messages / members that would be
// archived if the user clicks "Archive this tenant". Used by the modal to
// show "This will archive 312 leads, 9 campaigns, 1,847 messages."

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();

  // Authorization mirrors the RPC: super_admin always, otherwise must be an
  // owner of this tenant.
  if (scope.tier !== "super_admin") {
    const { data: m } = await svc
      .from("user_company_memberships")
      .select("tier")
      .eq("user_id", scope.userId)
      .eq("company_bio_id", id)
      .maybeSingle();
    if (!m || m.tier !== "owner") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Counts. Run them in parallel — none of them can take long.
  const [bio, leadsCount, campsCount, msgsCount, repliesCount, membersCount] = await Promise.all([
    svc.from("company_bios").select("company_name, archived_at").eq("id", id).maybeSingle(),
    svc.from("leads").select("id", { count: "exact", head: true })
      .eq("company_bio_id", id).is("archived_at", null),
    svc.from("campaigns").select("id, leads!inner(company_bio_id)", { count: "exact", head: true })
      .eq("leads.company_bio_id", id).is("archived_at", null),
    svc.from("campaign_messages").select("id, leads!inner(company_bio_id)", { count: "exact", head: true })
      .eq("leads.company_bio_id", id),
    svc.from("lead_replies").select("id, leads!inner(company_bio_id)", { count: "exact", head: true })
      .eq("leads.company_bio_id", id),
    svc.from("user_company_memberships").select("user_id", { count: "exact", head: true })
      .eq("company_bio_id", id),
  ]);

  if (!bio.data) {
    return NextResponse.json({ error: "bio not found" }, { status: 404 });
  }
  if (bio.data.archived_at) {
    return NextResponse.json({ error: "already archived", archived_at: bio.data.archived_at }, { status: 409 });
  }

  return NextResponse.json({
    company_name: bio.data.company_name,
    counts: {
      leads: leadsCount.count ?? 0,
      campaigns: campsCount.count ?? 0,
      messages: msgsCount.count ?? 0,
      replies: repliesCount.count ?? 0,
      members: membersCount.count ?? 0,
    },
  });
}
