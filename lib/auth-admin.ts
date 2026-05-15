import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getOrFetchProfile } from "@/lib/user-profile-cache";

// SWL super-admin gates — used by every /admin/* page and /api/admin/* route
// to restrict cross-tenant SWL operational tools (reliability, demos, etc.)
// to super_admin tier only. Per-tenant admin actions (owner/manager) should
// use the helpers in lib/scope.ts (canManageTeam, canApproveCampaigns, etc.).
//
// During the RBAC migration both `tier === 'super_admin'` AND legacy
// `role === 'admin'` are accepted so existing rows that haven't been
// re-fetched still authenticate. Once every user_profile has been migrated
// the legacy fallback can be removed.

function isSuperAdmin(profile: { role?: string | null; tier?: string | null } | null): boolean {
  if (!profile) return false;
  if (profile.tier === "super_admin") return true;
  if (profile.role === "admin") return true;
  return false;
}

export async function requireAdminPage() {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getOrFetchProfile(user.id, getSupabaseService());
  if (!isSuperAdmin(profile)) redirect("/");
  return user;
}

export async function requireAdminApi(): Promise<{ user: { id: string } } | NextResponse> {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getOrFetchProfile(user.id, getSupabaseService());
  if (!isSuperAdmin(profile)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { user };
}
