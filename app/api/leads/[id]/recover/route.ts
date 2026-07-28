import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser, assertTenant } from "@/lib/require-scope";
import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const supabase = getSupabaseService();
  const { id } = await params;

  // Tenant guard before the multi-table recover.
  const { data: leadRow } = await supabase.from("leads").select("company_bio_id").eq("id", id).maybeSingle();
  if (!leadRow) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const denied = assertTenant(g.scope, (leadRow as { company_bio_id: string | null }).company_bio_id);
  if (denied) return denied;

  const { error: campsErr } = await supabase
    .from("campaigns")
    .update({ status: "archived" })
    .eq("lead_id", id)
    .in("status", ["completed", "failed"]);
  if (campsErr) return NextResponse.json({ error: campsErr.message }, { status: 500 });

  const { error: repliesErr } = await supabase
    .from("lead_replies")
    .update({ classification: "nurturing" })
    .eq("lead_id", id)
    .eq("classification", "negative");
  if (repliesErr) return NextResponse.json({ error: repliesErr.message }, { status: 500 });

  const { error: leadErr } = await supabase
    .from("leads")
    .update({ status: "new", responded: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
