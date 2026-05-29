import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";

// Lightweight list of active+paused campaigns scoped to the caller's
// tenant. Powers the "Add to existing flow" modal in /leads bulk actions
// without forcing the entire campaign payload through the server prop
// stream. Tenant scope comes from getUserScope so super-admins see all,
// scoped roles see only their tenant.
//
// Optional `?icp=<profile_id>` narrows the list to flows whose embedded
// leads carry that icp_profile_id. The /leads bulk popup uses this to
// enforce the one-ICP-per-campaign LAW: when surfacing "Add to existing
// flow", only flows of the selected leads' shared ICP show up.
export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;
  const icpFilter = req.nextUrl.searchParams.get("icp");

  let q = supabase
    .from("campaigns")
    .select("id, name, status, channel, sequence_steps, lead_id, leads!inner(company_bio_id, icp_profile_id)")
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(500);
  if (bioId) q = q.eq("leads.company_bio_id", bioId);
  if (icpFilter) q = q.eq("leads.icp_profile_id", icpFilter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Strip the join helper so the response stays compact.
  const campaigns = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    channel: c.channel,
    sequence_steps: c.sequence_steps,
    lead_count: 1, // each row is per-lead — caller dedupes by name
  }));
  return NextResponse.json({ campaigns });
}
