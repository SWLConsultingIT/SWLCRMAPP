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
    .select("id, name, description, sequence_steps, step_messages, attachments, tags, channels, usage_count, last_used_at, created_at, tone_preset, tone_custom_notes, rewrite_mode, voice_anchor_seller_id, icp_profile_id")
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Partial<{
    icp_profile_id: string | null;
    name: string;
    description: string | null;
    tone_preset: "conservative" | "balanced" | "direct" | "spicy" | "custom";
    rewrite_mode: "verbatim" | "personalize" | "rewrite_with_source";
    step_messages: unknown;
    sequence_steps: unknown;
  }>;

  const svc = getSupabaseService();
  // If the caller is changing the ICP, validate cross-tenant ownership the
  // same way the POST flow does. A NULL clear is fine (returns the row to
  // the "Needs ICP" bucket).
  if (body.icp_profile_id) {
    const { data: ownIcp } = await svc
      .from("icp_profiles").select("id").eq("id", body.icp_profile_id).eq("company_bio_id", scope.companyBioId).maybeSingle();
    if (!ownIcp) {
      return NextResponse.json({ error: "icp_profile_id not found in this tenant" }, { status: 400 });
    }
  }

  const patch: Record<string, unknown> = {};
  if (body.icp_profile_id !== undefined) patch.icp_profile_id = body.icp_profile_id;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.tone_preset) patch.tone_preset = body.tone_preset;
  if (body.rewrite_mode) patch.rewrite_mode = body.rewrite_mode;
  if (body.step_messages !== undefined) patch.step_messages = body.step_messages;
  if (body.sequence_steps !== undefined) patch.sequence_steps = body.sequence_steps;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await svc
    .from("campaign_templates")
    .update(patch)
    .eq("id", id)
    .eq("company_bio_id", scope.companyBioId)
    .select("id, name, icp_profile_id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }
  return NextResponse.json({ template: data });
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
