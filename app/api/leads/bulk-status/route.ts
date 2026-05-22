import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";

const ALLOWED_STATUSES = new Set([
  "new",
  "contacted",
  "connected",
  "responded",
  "qualified",
  "proposal_sent",
  "closed_won",
  "closed_lost",
  "nurturing",
]);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { ids?: string[]; status?: string } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids : [];
  const status = body?.status;
  if (ids.length === 0 || !status) {
    return NextResponse.json({ error: "ids and status required" }, { status: 400 });
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: `unknown status '${status}'` }, { status: 400 });
  }

  // Tenant guard: a tenant-scoped user can only flip leads inside their bio.
  // Super-admin (no scope) is allowed cross-tenant. Without this, a malicious
  // client could POST any lead id and overwrite another tenant's pipeline.
  const scope = await getUserScope();
  let q = supabase.from("leads").update({ status }).in("id", ids);
  if (scope.isScoped && scope.companyBioId) {
    q = q.eq("company_bio_id", scope.companyBioId);
  }
  const { error, count } = await q.select("id", { count: "exact", head: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ updated: count ?? ids.length });
}
