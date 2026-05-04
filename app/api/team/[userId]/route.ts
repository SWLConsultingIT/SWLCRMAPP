import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canManageTeam, type Tier } from "@/lib/scope";

// Manage one team member: change tier (PATCH) or remove (DELETE).
//
// Authorization:
//   - super_admin: can act on any user in any tenant.
//   - owner: can act on users in their own tenant only.
//   - manager / seller / viewer: 403.
//
// Safety rules enforced server-side:
//   - Cannot change your own tier (anti-lockout — use a peer owner to demote).
//   - Cannot demote/remove the last owner of a tenant (would orphan the tenant).
//   - Cannot grant super_admin via this endpoint (SWL adds those directly).

const VALID_TIERS: Tier[] = ["owner", "manager", "seller", "viewer"];

async function loadTargetProfile(userId: string) {
  const svc = getSupabaseService();
  const { data } = await svc
    .from("user_profiles")
    .select("user_id, company_bio_id, role, tier")
    .eq("user_id", userId)
    .maybeSingle();
  return data as { user_id: string; company_bio_id: string | null; role: string; tier: Tier } | null;
}

async function isSameTenantOrSuper(scope: Awaited<ReturnType<typeof getUserScope>>, target: { company_bio_id: string | null }): Promise<boolean> {
  if (scope.tier === "super_admin") return true;
  return !!scope.companyBioId && target.company_bio_id === scope.companyBioId;
}

async function countOwnersInTenant(bioId: string): Promise<number> {
  const svc = getSupabaseService();
  const { count } = await svc
    .from("user_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("company_bio_id", bioId)
    .eq("tier", "owner");
  return count ?? 0;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam(scope.tier)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const newTier = body?.tier as Tier | undefined;
  if (!newTier || !VALID_TIERS.includes(newTier)) {
    return NextResponse.json({ error: `tier must be one of: ${VALID_TIERS.join(", ")}` }, { status: 400 });
  }

  if (userId === scope.userId) {
    return NextResponse.json({ error: "Cannot change your own tier — ask another owner" }, { status: 400 });
  }

  const target = await loadTargetProfile(userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!(await isSameTenantOrSuper(scope, target))) {
    return NextResponse.json({ error: "User not in your tenant" }, { status: 403 });
  }

  // If demoting an owner, ensure at least one other owner exists.
  if (target.tier === "owner" && newTier !== "owner" && target.company_bio_id) {
    const owners = await countOwnersInTenant(target.company_bio_id);
    if (owners <= 1) {
      return NextResponse.json({
        error: "Cannot demote the last owner of this tenant — promote another member to owner first",
      }, { status: 400 });
    }
  }

  const svc = getSupabaseService();
  const { error } = await svc
    .from("user_profiles")
    .update({ tier: newTier })
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, tier: newTier });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam(scope.tier)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await ctx.params;
  if (userId === scope.userId) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  const target = await loadTargetProfile(userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!(await isSameTenantOrSuper(scope, target))) {
    return NextResponse.json({ error: "User not in your tenant" }, { status: 403 });
  }

  // Last-owner guard.
  if (target.tier === "owner" && target.company_bio_id) {
    const owners = await countOwnersInTenant(target.company_bio_id);
    if (owners <= 1) {
      return NextResponse.json({
        error: "Cannot remove the last owner of this tenant — promote another member first",
      }, { status: 400 });
    }
  }

  const svc = getSupabaseService();
  // Profile first (the FK + RLS constraints), then auth user.
  const { error: profileErr } = await svc.from("user_profiles").delete().eq("user_id", userId);
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  // Best-effort auth user delete; log but don't fail the response if Supabase
  // refuses (the profile is gone, which is what gates app access anyway).
  await svc.auth.admin.deleteUser(userId).catch(() => null);

  return NextResponse.json({ ok: true });
}
