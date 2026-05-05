// Returns the data_access_log for the caller's tenant. The tenant uses this
// to audit who decrypted their leads and why. Cross-tenant leakage is blocked
// by RLS (data_access_log_tenant_read policy) — we still query through the
// service client and filter by the caller's bio for an extra defence-in-depth
// pass and so super_admins on demo mode see only the impersonated tenant.

import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bioId = scope.companyBioId;
  if (!bioId) {
    // Cross-tenant SWL super_admin without an active demo: do not leak audit
    // entries from every tenant in one call. They can use /admin views or a
    // tenant-scoped tool for this.
    return NextResponse.json({ entries: [], note: "no tenant scope" });
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const since = req.nextUrl.searchParams.get("since"); // ISO timestamp

  const svc = getSupabaseService();
  let q = svc
    .from("data_access_log")
    .select("id, lead_id, caller, reason, encryption_mode, occurred_at")
    .eq("company_bio_id", bioId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("occurred_at", since);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entries: data ?? [] });
}
