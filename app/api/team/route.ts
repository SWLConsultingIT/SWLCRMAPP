import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAdminMenu } from "@/lib/scope";
import { prettyDisplayName } from "@/lib/display-name";

// List team members of the caller's tenant.
//
// Authorization:
//   - super_admin: must pass ?bioId=<tenant> to scope (otherwise returns own bio's team).
//   - owner / manager: their own tenant only.
//   - others: 403.
//
// Response shape mirrors what TenantTeamTab needs to render rows: profile data
// joined with auth user email + display name.

export async function GET(req: Request) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewAdminMenu(scope.tier)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const requestedBioId = url.searchParams.get("bioId");

  let bioId: string | null;
  if (scope.tier === "super_admin") {
    bioId = requestedBioId ?? scope.companyBioId;
  } else {
    bioId = scope.companyBioId;
  }
  if (!bioId) {
    return NextResponse.json({ error: "No tenant" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Source of truth for "who is on this tenant" is user_company_memberships —
  // NOT user_profiles.company_bio_id, which only records a user's *home*
  // tenant. A multi-tenant user (owner of SWL + Arqy, say) has one membership
  // row per tenant and must appear under each. The old query keyed on
  // user_profiles.company_bio_id, so anyone whose home tenant differed from
  // the one being viewed silently dropped off the list.
  const { data: memberships } = await svc
    .from("user_company_memberships")
    .select("user_id, tier, created_at")
    .eq("company_bio_id", bioId)
    .order("created_at", { ascending: true });

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ team: [] });
  }

  // Pull profile fields in one batched query: last_seen_at for the activity
  // column, and the global super_admin flag so SWL ops keep rendering as the
  // protected (non-editable) "super_admin" badge even though their per-tenant
  // membership tier is just "owner"/"viewer".
  const userIds = memberships.map(m => m.user_id);
  const { data: profiles } = await svc
    .from("user_profiles")
    .select("user_id, role, tier, last_seen_at, is_super_admin")
    .in("user_id", userIds);
  const profileById = new Map((profiles ?? []).map(p => [p.user_id, p]));

  // Hydrate auth fields per user. Done sequentially because Supabase admin
  // SDK doesn't support batch user fetches; the count here is small (a tenant
  // has 1-20 users typically).
  const team = await Promise.all(memberships.map(async (m) => {
    let email: string | null = null;
    let displayName: string | null = null;
    try {
      const { data } = await svc.auth.admin.getUserById(m.user_id);
      email = data?.user?.email ?? null;
      // Always resolve a friendly name — prettyDisplayName falls back to the
      // email prefix ("lucia.antel" → "Lucia Antel") so every row shows a
      // name + email, not a mix of "Name / email" and bare-email rows.
      displayName = prettyDisplayName(data?.user?.user_metadata as Record<string, unknown> | undefined, email);
    } catch { /* orphan auth row — return minimal row */ }
    const prof = profileById.get(m.user_id);
    const isSuper = prof?.is_super_admin === true || prof?.tier === "super_admin";
    return {
      userId: m.user_id,
      email,
      displayName,
      // Per-tenant tier from the membership row; super_admins override to the
      // protected badge regardless of their membership tier here.
      tier: isSuper ? "super_admin" : (m.tier ?? "viewer"),
      role: prof?.role ?? "client",
      lastSeenAt: prof?.last_seen_at ?? null,
      createdAt: m.created_at,
    };
  }));

  return NextResponse.json({ team });
}
