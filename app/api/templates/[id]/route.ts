// GET /api/templates/{id} — full template (for apply / preview)
// DELETE /api/templates/{id} — owner-tenant only
//
// Both enforce tenant ownership via getUserScope. Cross-tenant attempts
// return 404 (not 403) to avoid leaking template existence.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

async function loadOwned(id: string, companyBioId: string | null) {
  if (!companyBioId) return null;
  const svc = getSupabaseService();
  const { data } = await svc
    .from("campaign_templates")
    .select("id, name, description, sequence_steps, step_messages, attachments, tags, channels, usage_count, last_used_at, created_at, tone_preset, tone_custom_notes, rewrite_mode, voice_anchor_seller_id")
    .eq("id", id)
    .eq("company_bio_id", companyBioId)
    .maybeSingle();
  return data;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const t = await loadOwned(id, scope.companyBioId);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Don't increment usage_count here — that happens at apply time
  // (in the campaign-create flow) so the count reflects actual use,
  // not preview/list views.
  return NextResponse.json({ template: t });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const { data: deleted } = await svc
    .from("campaign_templates")
    .delete()
    .eq("id", id)
    .eq("company_bio_id", scope.companyBioId)
    .select("id");

  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: "Not found or not owned" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
