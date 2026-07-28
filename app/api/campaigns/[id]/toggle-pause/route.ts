import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser, assertTenant } from "@/lib/require-scope";
import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const supabase = getSupabaseService();
  const { id } = await params;
  const { data: campaign } = await supabase.from("campaigns").select("status, leads!inner(company_bio_id)").eq("id", id).single();
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  {
    const lj = (campaign as { leads?: { company_bio_id?: string | null } | Array<{ company_bio_id?: string | null }> | null }).leads;
    const bio = Array.isArray(lj) ? lj[0]?.company_bio_id : lj?.company_bio_id;
    const denied = assertTenant(g.scope, bio ?? null);
    if (denied) return denied;
  }

  const newStatus = campaign.status === "paused" ? "active" : "paused";
  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "paused") update.paused_until = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  else update.paused_until = null;

  const { error } = await supabase.from("campaigns").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, newStatus });
}
