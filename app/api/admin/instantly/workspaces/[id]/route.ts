import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-admin";
import { getSupabaseService } from "@/lib/supabase-service";

function decodeAccountUserId(apiKey: string): string | null {
  try {
    const decoded = Buffer.from(apiKey, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 1) return null;
    return decoded.slice(0, colon);
  } catch {
    return null;
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body?.label === "string") updates.label = body.label.trim();
  if (typeof body?.notes === "string") updates.notes = body.notes.trim() || null;
  if (typeof body?.apiKey === "string" && body.apiKey.trim().length > 0) {
    const apiKey = body.apiKey.trim();
    updates.api_key = apiKey;
    updates.account_user_id = decodeAccountUserId(apiKey);
  }

  const svc = getSupabaseService();
  const { error } = await svc.from("instantly_workspaces").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { id } = await ctx.params;
  const svc = getSupabaseService();
  // FK from company_bios.instantly_workspace_id has ON DELETE SET NULL —
  // tenants currently using this workspace fall back to legacy/env after
  // delete. The admin should reassign before deleting if they care.
  const { error } = await svc.from("instantly_workspaces").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
