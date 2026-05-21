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
// Legacy `role === 'admin'` is intentionally NOT honored. That fallback was
// the source of the 2026-05-06 cross-tenant leak: a freshly-onboarded tenant
// owner inherited role='admin' from the legacy column and silently became a
// super_admin in every gate that used the OR fallback. Migration 010 already
// backfilled `tier` for every user_profile; new rows must set `tier` explicitly.
// If `tier` is somehow missing, the user gets the conservative answer (no
// admin) instead of the dangerous one (yes admin).

function isSuperAdmin(profile: { role?: string | null; tier?: string | null } | null): boolean {
  if (!profile) return false;
  return profile.tier === "super_admin";
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
