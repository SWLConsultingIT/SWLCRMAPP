import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canManageTeam, type Tier } from "@/lib/scope";
import { invalidateProfileCache } from "@/lib/user-profile-cache";

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

  invalidateProfileCache(userId);
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

  // Owner-of-one-tenant detach scope: a super_admin who removes a member from
  // a SPECIFIC tenant should detach them from THAT tenant only, not nuke
  // their access everywhere. We restrict the full purge to the case where
  // the caller is an owner (single-tenant) or super_admin acting on a user
  // whose only membership IS the target tenant.
  const { data: allMemberships } = await svc
    .from("user_company_memberships")
    .select("company_bio_id")
    .eq("user_id", userId);
  const memberships = (allMemberships ?? []).map(m => m.company_bio_id);
  const callerScopeBioId = scope.tier === "super_admin"
    ? (target.company_bio_id ?? scope.companyBioId)
    : scope.companyBioId;
  const detachOnly = memberships.length > 1 && memberships.includes(callerScopeBioId ?? "");

  if (detachOnly && callerScopeBioId) {
    // Multi-tenant user: keep their other memberships, just drop this tenant.
    const { error: memErr } = await svc
      .from("user_company_memberships")
      .delete()
      .eq("user_id", userId)
      .eq("company_bio_id", callerScopeBioId);
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    // If this tenant happened to be their primary in user_profiles, move
    // them onto one of the remaining memberships so they don't end up with
    // a stale primary FK pointing into a tenant they no longer belong to.
    if (target.company_bio_id === callerScopeBioId) {
      const fallback = memberships.find(b => b !== callerScopeBioId);
      await svc
        .from("user_profiles")
        .update({ company_bio_id: fallback ?? null })
        .eq("user_id", userId);
      invalidateProfileCache(userId);
    }
    return NextResponse.json({ ok: true, mode: "detached_from_tenant" });
  }

  // Full purge: this is the user's only tenant (or they had none). Clean up
  // EVERY reference to the user_id so the auth.users delete doesn't trip on
  // a lingering FK. Audit-style refs (lead_notes.created_by — the call
  // notes a seller left on their leads) get NULL'd so the data survives the
  // departure; the seller themselves is unlinked from the sellers row.
  await svc.from("user_company_memberships").delete().eq("user_id", userId);
  await svc.from("sellers").update({ user_id: null }).eq("user_id", userId);
  await svc.from("lead_notes").update({ created_by: null }).eq("created_by", userId);

  const { error: profileErr } = await svc.from("user_profiles").delete().eq("user_id", userId);
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  invalidateProfileCache(userId);

  // Auth user delete — surface errors instead of swallowing. The previous
  // catch(() => null) swallowed FK violations and left orphaned auth.users
  // rows that resurfaced in the "Pending Assignment" banner forever.
  // 2026-05-22 incident: Andy from Pathway, deleted but kept reappearing.
  const { error: authErr } = await svc.auth.admin.deleteUser(userId);
  if (authErr) {
    return NextResponse.json({
      error: `User removed from tenant but auth row could not be deleted: ${authErr.message}. The account is no longer usable; surface this to engineering for cleanup.`,
    }, { status: 207 });
  }

  return NextResponse.json({ ok: true, mode: "fully_deleted" });
}
