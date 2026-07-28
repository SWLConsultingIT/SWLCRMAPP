import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser, assertTenant } from "@/lib/require-scope";
import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { id } = await params;
  const supabase = getSupabaseService();

  const { data: camp } = await supabase
    .from("campaigns")
    .select("id, leads!inner(company_bio_id)")
    .eq("id", id)
    .maybeSingle();
  if (!camp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  {
    const lj = (camp as { leads?: { company_bio_id?: string | null } | Array<{ company_bio_id?: string | null }> | null }).leads;
    const bio = Array.isArray(lj) ? lj[0]?.company_bio_id : lj?.company_bio_id;
    const denied = assertTenant(g.scope, bio ?? null);
    if (denied) return denied;
  }

  const { error } = await supabase
    .from("campaigns")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
