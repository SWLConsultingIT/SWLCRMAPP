import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAdminMenu } from "@/lib/scope";

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
  const { data: profiles } = await svc
    .from("user_profiles")
    .select("user_id, role, tier, last_seen_at, created_at")
    .eq("company_bio_id", bioId)
    .order("created_at", { ascending: true });

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ team: [] });
  }

  // Hydrate auth fields per user. Done sequentially because Supabase admin
  // SDK doesn't support batch user fetches; the count here is small (a tenant
  // has 1-20 users typically).
  const team = await Promise.all(profiles.map(async (p) => {
    let email: string | null = null;
    let displayName: string | null = null;
    try {
      const { data } = await svc.auth.admin.getUserById(p.user_id);
      email = data?.user?.email ?? null;
      const meta = data?.user?.user_metadata ?? {};
      displayName = (meta.full_name as string | undefined)
        ?? (meta.display_name as string | undefined)
        ?? (meta.name as string | undefined)
        ?? null;
    } catch { /* orphan profile — return minimal row */ }
    return {
      userId: p.user_id,
      email,
      displayName,
      tier: p.tier ?? "viewer",
      role: p.role ?? "client",
      lastSeenAt: p.last_seen_at,
      createdAt: p.created_at,
    };
  }));

  return NextResponse.json({ team });
}
