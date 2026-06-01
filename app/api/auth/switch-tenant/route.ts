import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { ACTIVE_TENANT_COOKIE } from "@/lib/scope";
import { getOrFetchProfile } from "@/lib/user-profile-cache";

// Switches the active tenant for the logged-in user.
// Body: { companyBioId: string | null }
//   - string → switch to that tenant (must have membership; archived bios rejected)
//   - null   → clear the cookie (falls back to user_profiles.company_bio_id)
//
// Super admins skip the membership check — they're implicit members of every
// active bio. Membership-table requirement was blocking SWL ops from entering
// freshly-onboarded tenants (e.g. Juan couldn't switch into De Vera Grill on
// 2026-05-28 because only the owner had a row).
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { companyBioId } = (await req.json().catch(() => ({}))) as { companyBioId?: string | null };

  const cookieStore = await cookies();

  if (!companyBioId) {
    cookieStore.delete(ACTIVE_TENANT_COOKIE);
    return NextResponse.json({ ok: true, companyBioId: null });
  }

  // Server-side validation: the user must actually have a membership in this
  // bio, and the bio cannot be archived. Super admins bypass the membership
  // requirement — they can switch into any active bio. Without this check, a
  // tampered cookie would route a normal user into any tenant.
  const svc = getSupabaseService();
  const profile = await getOrFetchProfile(user.id, svc);
  const isSuperAdmin = profile?.tier === "super_admin";

  if (isSuperAdmin) {
    const { data: bio } = await svc
      .from("company_bios")
      .select("id, archived_at")
      .eq("id", companyBioId)
      .maybeSingle();
    if (!bio) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if (bio.archived_at) return NextResponse.json({ error: "Tenant archived" }, { status: 403 });
  } else {
    const { data: membership } = await svc
      .from("user_company_memberships")
      .select("company_bio_id, company_bios(archived_at)")
      .eq("user_id", user.id)
      .eq("company_bio_id", companyBioId)
      .maybeSingle();
    type Bio = { archived_at: string | null };
    const bioRaw = (membership as { company_bios?: Bio | Bio[] | null } | null)?.company_bios;
    const bio = Array.isArray(bioRaw) ? bioRaw[0] : bioRaw;
    if (!membership) return NextResponse.json({ error: "No membership in that tenant" }, { status: 403 });
    if (bio?.archived_at) return NextResponse.json({ error: "Tenant archived" }, { status: 403 });
  }

  // 12h maxAge — long enough for a normal working day, short enough that a
  // browser left open over the weekend doesn't carry yesterday's tenant
  // scope into Monday morning. The cookie is also cleared on logout (see
  // /api/auth/logout) so a fresh login can never inherit a previous user's
  // tenant scope.
  cookieStore.set(ACTIVE_TENANT_COOKIE, companyBioId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  // ── Mirror the switch into user_profiles.company_bio_id ────────────────
  // The SQL RLS function get_auth_company_bio_id() (migration 002, line 42)
  // reads from user_profiles.company_bio_id directly — it has no access to
  // the active_tenant cookie. Without this mirror write, every browser-side
  // RLS-protected query still filters against the user's OLD primary tenant
  // and SWL/Pathway data renders as empty. Found 2026-06-01 when Simone
  // entered SWL and saw zero leads despite owning the tenant.
  //
  // Skip for super_admins — they have is_admin() bypass on every policy,
  // so RLS doesn't gate them either way. Writing here would corrupt their
  // home tenant id (super_admin profiles canonically point at SWL Consulting
  // for /admin defaults).
  if (!isSuperAdmin) {
    await svc.from("user_profiles").update({ company_bio_id: companyBioId }).eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true, companyBioId });
}
