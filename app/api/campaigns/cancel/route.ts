import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { requireUser } from "@/lib/require-scope";

type Action = "pause" | "resume" | "cancel";

export async function POST(req: NextRequest) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { ids, action } = await req.json() as { ids: string[]; action: Action };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (!["pause", "resume", "cancel"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Tenant isolation: a scoped user may only act on campaigns in their own
  // tenant. campaigns has no company_bio_id → scope via the owning lead.
  // super_admin / all-tenant viewers and local preview keep the full set.
  let allowedIds = ids;
  if (g.scope?.isScoped && g.scope.companyBioId) {
    const { data: owned } = await svc
      .from("campaigns")
      .select("id, leads!inner(company_bio_id)")
      .in("id", ids)
      .eq("leads.company_bio_id", g.scope.companyBioId);
    allowedIds = (owned ?? []).map((r) => (r as { id: string }).id);
    if (allowedIds.length === 0) {
      return NextResponse.json({ ok: true, count: 0, action });
    }
  }

  if (action === "cancel") {
    await svc.from("campaign_messages").delete().in("campaign_id", allowedIds);
    await svc.from("lead_replies").delete().in("campaign_id", allowedIds);
    const { error } = await svc.from("campaigns").delete().in("id", allowedIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const status = action === "pause" ? "paused" : "active";
    const { error } = await svc.from("campaigns").update({ status }).in("id", allowedIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: allowedIds.length, action });
}
