import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// Mark / unmark a lead as priority ("hot"). Backs the flame quick action on
// the leads list. Tenant guard mirrors the bulk-status endpoint.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { is_priority?: boolean } | null;
  if (typeof body?.is_priority !== "boolean") {
    return NextResponse.json({ error: "is_priority boolean required" }, { status: 400 });
  }
  const scope = await getUserScope();
  let q = supabase.from("leads").update({ is_priority: body.is_priority }).eq("id", id);
  if (scope.isScoped && scope.companyBioId) {
    q = q.eq("company_bio_id", scope.companyBioId);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
