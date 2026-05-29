// Tenant-scoped lead delete. Cascades to lead_replies, campaign_messages,
// campaigns, and lead_notes — the schema doesn't have ON DELETE CASCADE on
// every back-ref, so the route does it explicitly.
//
// Auth: any authenticated user can delete a lead inside their own tenant.
// Pre-2026-05-29 this route had NO auth gate at all — anyone with the URL
// could wipe any lead in any tenant.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const svc = getSupabaseService();

  const { data: lead, error: readErr } = await svc
    .from("leads")
    .select("id, company_bio_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await svc.from("lead_replies").delete().eq("lead_id", id);
  await svc.from("campaign_messages").delete().eq("lead_id", id);
  await svc.from("campaigns").delete().eq("lead_id", id);
  await svc.from("lead_notes").delete().eq("lead_id", id);

  const { error } = await svc.from("leads").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true });
}
