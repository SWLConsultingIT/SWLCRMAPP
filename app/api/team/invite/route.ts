import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canManageTeam, type Tier } from "@/lib/scope";

// Invite (or attach) a team member to the caller's tenant.
//
// Authorization:
//   - super_admin: can invite/attach into ANY tenant (companyBioId from body).
//                  Also the only tier that can grant `super_admin` to others.
//   - owner: can invite/attach into their own tenant only.
//   - others: 403.
//
// Process:
//   1. Validate input.
//   2. Resolve target tenant (caller's own or, for super_admin, body field).
//   3. Look up the email in auth.users:
//        a. If it already exists → SKIP the auth invite, just create a
//           membership row in `user_company_memberships`. The user keeps
//           their existing password and can switch tenants via the dropdown.
//        b. If it doesn't exist → send a Supabase Auth invite + create
//           user_profiles + membership.
//   4. When `tier === "super_admin"`, also set user_profiles.is_super_admin.
//
// Response shapes:
//   - { ok: true, mode: "invited",   user: {...} }  → fresh invite sent
//   - { ok: true, mode: "added",     user: {...} }  → existing user attached
//   - { ok: true, mode: "already_member" }          → membership row existed

const CLIENT_INVITE_TIERS: Tier[] = ["owner", "manager", "seller", "viewer"];
const SUPER_ADMIN_INVITE_TIERS: Tier[] = ["super_admin", "owner", "manager", "seller", "viewer"];

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam(scope.tier)) {
    return NextResponse.json({ error: "Only owners and super admins can invite team members" }, { status: 403 });
  }
  const isSuperAdminCaller = scope.tier === "super_admin";
  const validTiers = isSuperAdminCaller ? SUPER_ADMIN_INVITE_TIERS : CLIENT_INVITE_TIERS;

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const tier = body?.tier as Tier | undefined;
  const requestedBioId = typeof body?.companyBioId === "string" ? body.companyBioId : null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!tier || !validTiers.includes(tier)) {
    return NextResponse.json({
      error: `tier must be one of: ${validTiers.join(", ")}`,
    }, { status: 400 });
  }

  // Resolve target tenant (where the membership row will live).
  let targetBioId: string | null;
  if (isSuperAdminCaller) {
    targetBioId = requestedBioId ?? scope.companyBioId;
    if (!targetBioId) {
      return NextResponse.json({ error: "super_admin must specify companyBioId" }, { status: 400 });
    }
  } else {
    if (!scope.companyBioId) {
      return NextResponse.json({ error: "No tenant" }, { status: 403 });
    }
    targetBioId = scope.companyBioId;
  }

  // Membership tier — super_admin is a global flag, not a tenant role, so
  // attach the new user as "owner" of the target tenant alongside the global
  // is_super_admin=true. Without this they'd land on the switcher with zero
  // tenants and immediately bounce to a fallback view.
  const membershipTier: Exclude<Tier, "super_admin"> = tier === "super_admin" ? "owner" : tier;

  const svc = getSupabaseService();

  // Look up the email — does this auth.users row already exist? We rely on
  // listUsers + filter-in-memory to match the rest of the codebase (this is
  // the same pattern /api/auth/check-email uses). Fine for tenants with
  // <thousands of users; revisit if Supabase exposes a direct getByEmail.
  const { data: existingList } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const existing = existingList?.users?.find(u => u.email?.toLowerCase() === email) ?? null;

  if (existing) {
    // ─── Existing user → just attach a membership ────────────────────────
    // Idempotent: if the row already exists we don't error, we report it.
    const { data: prior } = await svc
      .from("user_company_memberships")
      .select("user_id")
      .eq("user_id", existing.id)
      .eq("company_bio_id", targetBioId)
      .maybeSingle();
    if (prior) {
      // Already a member. If the caller is upgrading to super_admin, still
      // honor the global flag promotion below.
      if (tier === "super_admin") {
        await svc.from("user_profiles").update({ is_super_admin: true }).eq("user_id", existing.id);
      }
      return NextResponse.json({
        ok: true,
        mode: "already_member",
        user: { id: existing.id, email },
      });
    }

    const { error: memErr } = await svc.from("user_company_memberships").insert({
      user_id: existing.id,
      company_bio_id: targetBioId,
      tier: membershipTier,
      invited_by: scope.userId,
    });
    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 500 });
    }

    // Bump the global super_admin flag if asked (only reachable when caller
    // is super_admin because of the tier validation above).
    if (tier === "super_admin") {
      await svc.from("user_profiles").update({ is_super_admin: true }).eq("user_id", existing.id);
    }

    // Optional seller link — same shape as the new-user branch below.
    const sellerIdToLink = typeof body?.sellerId === "string" && body.sellerId ? body.sellerId : null;
    if (tier === "seller" && sellerIdToLink) {
      const { data: target } = await svc
        .from("sellers")
        .select("id, user_id, company_bio_id")
        .eq("id", sellerIdToLink)
        .maybeSingle();
      if (target && target.company_bio_id === targetBioId && !target.user_id) {
        await svc.from("sellers").update({ user_id: existing.id }).eq("id", sellerIdToLink);
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "added",
      user: { id: existing.id, email, tier },
    });
  }

  // ─── New user → invite + profile + membership ────────────────────────
  const { data: invited, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
    data: body?.fullName ? { full_name: body.fullName } : undefined,
  });
  if (inviteErr || !invited?.user) {
    return NextResponse.json({ error: inviteErr?.message ?? "Invite failed" }, { status: 500 });
  }

  const legacyRole = "client";
  const profileInsert: Record<string, unknown> = {
    user_id: invited.user.id,
    company_bio_id: targetBioId,
    role: legacyRole,
    tier: tier === "super_admin" ? "super_admin" : tier,
  };
  if (tier === "super_admin") profileInsert.is_super_admin = true;

  const { error: profileErr } = await svc.from("user_profiles").insert(profileInsert);
  if (profileErr) {
    await svc.auth.admin.deleteUser(invited.user.id).catch(() => null);
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const { error: memErr } = await svc.from("user_company_memberships").insert({
    user_id: invited.user.id,
    company_bio_id: targetBioId,
    tier: membershipTier,
    invited_by: scope.userId,
  });
  if (memErr) {
    // Best-effort rollback so we don't leave an orphan user without any
    // tenant linkage — they'd land on a login that resolves to nothing.
    await svc.from("user_profiles").delete().eq("user_id", invited.user.id).catch(() => null);
    await svc.auth.admin.deleteUser(invited.user.id).catch(() => null);
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  // Optional seller link.
  const sellerIdToLink = typeof body?.sellerId === "string" && body.sellerId ? body.sellerId : null;
  if (tier === "seller" && sellerIdToLink) {
    const { data: target } = await svc
      .from("sellers")
      .select("id, user_id, company_bio_id")
      .eq("id", sellerIdToLink)
      .maybeSingle();
    if (target && target.company_bio_id === targetBioId && !target.user_id) {
      await svc.from("sellers").update({ user_id: invited.user.id }).eq("id", sellerIdToLink);
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "invited",
    user: { id: invited.user.id, email, tier },
  });
}
