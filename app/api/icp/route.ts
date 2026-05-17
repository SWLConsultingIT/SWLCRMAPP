// GET /api/icp — list ICP profiles for the current tenant.
// Returns approved profiles by default. ?status=any returns all.
//
// Lightweight helper used by template wizards / dropdowns where we don't
// need the full execution-status payload of the main /icp page.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ icps: [] });

  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.trim();

  const svc = getSupabaseService();
  let q = svc
    .from("icp_profiles")
    .select("id, profile_name, status, target_industries, target_roles, created_at")
    .eq("company_bio_id", scope.companyBioId)
    .order("profile_name", { ascending: true });

  if (status && status !== "any") {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ icps: data ?? [] });
}
