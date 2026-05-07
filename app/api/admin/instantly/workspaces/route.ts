import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-admin";
import { getSupabaseService } from "@/lib/supabase-service";

// CRUD for Instantly workspaces — the registry of {label, api_key} pairs
// the dispatcher uses to route email per tenant.
//
// SWL super_admin only: a workspace API key gives full access to that
// Instantly Organization (inbox list, campaigns, lead enroll, deletes).
// Tenants don't manage their own workspaces from here — they consume one
// via company_bios.instantly_workspace_id.

// Decode the user_id portion of an Instantly API key (Bearer token is
// base64 of `user_id:secret`). Best-effort — falls back to null if the
// key has an unexpected shape.
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

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("instantly_workspaces")
    .select("id, label, account_user_id, notes, created_at, updated_at")
    .order("label");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workspaces: data ?? [] });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : null;
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "apiKey required" }, { status: 400 });

  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("instantly_workspaces")
    .insert({
      label,
      api_key: apiKey,
      account_user_id: decodeAccountUserId(apiKey),
      notes: notes || null,
    })
    .select("id, label, account_user_id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, workspace: data });
}
