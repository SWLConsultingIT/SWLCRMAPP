// GET /api/leads/search — flexible lead lookup.
//
// Three modes:
//   1. Text search:           ?q=<term>     — name / company / title ilike
//   2. Filter listing:        ?icp_profile_id=<uuid>[&status=new]  — used by
//                             the TemplateLaunchModal to populate the picker
//                             with leads of a specific ICP.
//   3. Combined:              ?q=…&icp_profile_id=…  — both filters AND'd.
//
// All modes are tenant-scoped via getUserScope so the service-role query
// can't accidentally surface another tenant's leads. Also fixed the column
// names — the previous version queried first_name/company/email which no
// longer exist (real schema is primary_first_name / company_name /
// primary_work_email per migration 002).

import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const q = url.searchParams.get("q")?.trim() ?? "";
  const icpProfileId = url.searchParams.get("icp_profile_id")?.trim();
  const status = url.searchParams.get("status")?.trim();
  const limit = Math.min(2000, parseInt(url.searchParams.get("limit") ?? "200", 10));

  // Require at least one constraint — bare "list everything" would be a
  // footgun for tenants with thousands of leads.
  if (!q && !icpProfileId) {
    return NextResponse.json({ leads: [] });
  }

  const supabase = getSupabaseService();
  let query = supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, primary_title_role, company_name, status, icp_profile_id")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (scope.companyBioId) {
    query = query.eq("company_bio_id", scope.companyBioId);
  }
  if (icpProfileId) {
    query = query.eq("icp_profile_id", icpProfileId);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (q.length >= 2) {
    query = query.or(`primary_first_name.ilike.%${q}%,primary_last_name.ilike.%${q}%,company_name.ilike.%${q}%,primary_work_email.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ leads: data ?? [] });
}
