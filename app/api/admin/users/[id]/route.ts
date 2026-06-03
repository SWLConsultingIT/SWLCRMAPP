import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { invalidateProfileCache } from "@/lib/user-profile-cache";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const body = await req.json();
  const supabase = getSupabaseService();

  const update: Record<string, unknown> = {};
  if ("role" in body) update.role = body.role;
  if ("company_bio_id" in body) update.company_bio_id = body.company_bio_id;

  const { error } = await supabase
    .from("user_profiles")
    .upsert({ user_id: id, ...update }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateProfileCache(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseService();
  // Full purge — used by the Pending Assignment "delete" action to remove an
  // unassigned/test account entirely: memberships + profile + the auth user.
  // (Postgrest builders have no .catch, so await the row deletes directly;
  // they no-op when there are no rows. The auth deletion is the one that
  // makes the account actually disappear.)
  await supabase.from("user_company_memberships").delete().eq("user_id", id);
  await supabase.from("user_profiles").delete().eq("user_id", id);
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateProfileCache(id);
  return NextResponse.json({ ok: true });
}
