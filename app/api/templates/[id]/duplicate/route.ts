// POST /api/templates/{id}/duplicate — duplicate a template under a different
// ICP. Used by TemplatesView's "Duplicate to…" menu when a similar template
// is needed for a related ICP without rebuilding from scratch.
//
// Body: { icp_profile_id: string, name_suffix?: string }
//
// Behavior:
//   - Loads the source template (tenant-scoped) — 404 if not found or
//     cross-tenant.
//   - Validates the target ICP belongs to the same tenant.
//   - Inserts a new campaign_templates row with the same content but a fresh
//     id, a new name (default: `<original> · <target ICP profile_name>`),
//     usage_count = 0 (fresh start), and the new icp_profile_id.
//   - Returns the new template's id + name.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { icp_profile_id?: string; name_suffix?: string };
  if (!body.icp_profile_id) {
    return NextResponse.json({ error: "icp_profile_id is required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  const { data: src } = await svc
    .from("campaign_templates")
    .select("name, description, sequence_steps, step_messages, attachments, tags, channels, tone_preset, tone_custom_notes, rewrite_mode, voice_anchor_seller_id")
    .eq("id", id)
    .eq("company_bio_id", scope.companyBioId)
    .maybeSingle();
  if (!src) return NextResponse.json({ error: "Source template not found" }, { status: 404 });

  const { data: targetIcp } = await svc
    .from("icp_profiles")
    .select("id, profile_name")
    .eq("id", body.icp_profile_id)
    .eq("company_bio_id", scope.companyBioId)
    .maybeSingle();
  if (!targetIcp) return NextResponse.json({ error: "Target ICP not found in this tenant" }, { status: 400 });

  const suffix = body.name_suffix?.trim() || `· ${targetIcp.profile_name}`;
  // Avoid double-suffixing if the user already named it with the target.
  const newName = src.name.toLowerCase().includes(targetIcp.profile_name.toLowerCase())
    ? `${src.name} (copy)`
    : `${src.name} ${suffix}`;

  const { data: created, error: insErr } = await svc
    .from("campaign_templates")
    .insert({
      company_bio_id: scope.companyBioId,
      name: newName,
      description: src.description,
      sequence_steps: src.sequence_steps,
      step_messages: src.step_messages,
      attachments: src.attachments ?? [],
      tags: src.tags ?? [],
      channels: src.channels ?? [],
      tone_preset: src.tone_preset,
      tone_custom_notes: src.tone_custom_notes,
      rewrite_mode: src.rewrite_mode,
      voice_anchor_seller_id: src.voice_anchor_seller_id,
      icp_profile_id: body.icp_profile_id,
      created_by: scope.userId,
    })
    .select("id, name, icp_profile_id")
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ template: created });
}
