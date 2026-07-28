import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser, assertTenant } from "@/lib/require-scope";
import { NextRequest, NextResponse } from "next/server";

const VALID_STATUSES = ["active", "restricted", "banned", "warning"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { id } = await params;
  const { status, note } = await req.json();

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const supabase = getSupabaseService();

  // Tenant guard: only the owning tenant may change a seller's status.
  const { data: sellerRow } = await supabase.from("sellers").select("company_bio_id").eq("id", id).maybeSingle();
  if (!sellerRow) return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  const denied = assertTenant(g.scope, (sellerRow as { company_bio_id: string | null }).company_bio_id);
  if (denied) return denied;

  const { error } = await supabase
    .from("sellers")
    .update({
      linkedin_status: status,
      linkedin_status_note: note ?? null,
      linkedin_status_updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
