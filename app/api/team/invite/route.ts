import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canManageTeam, type Tier } from "@/lib/scope";

// Invite a new team member to the caller's tenant.
//
// Authorization:
//   - super_admin: can invite into ANY tenant (must pass companyBioId)
//   - owner: can invite into their own tenant only
//   - others: 403
//
// Process:
//   1. Validate input (email, tier).
//   2. Resolve target tenant (caller's own or, for super_admin, the body field).
//   3. Send Supabase Auth invite — they get a magic link to set password.
//   4. Insert user_profiles row with the requested tier + tenant.
//
// Tier rules:
//   - Cannot grant `super_admin` tier through this endpoint. Super admins are
//     SWL internal and added directly by SWL ops (no client should ever be
//     able to escalate to that level via the API).
//   - All other tiers are valid: owner, manager, seller, viewer.

const VALID_INVITE_TIERS: Tier[] = ["owner", "manager", "seller", "viewer"];

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam(scope.tier)) {
    return NextResponse.json({ error: "Only owners and super admins can invite team members" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const tier = body?.tier as Tier | undefined;
  const requestedBioId = typeof body?.companyBioId === "string" ? body.companyBioId : null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!tier || !VALID_INVITE_TIERS.includes(tier)) {
    return NextResponse.json({
      error: `tier must be one of: ${VALID_INVITE_TIERS.join(", ")}`,
    }, { status: 400 });
  }

  // Resolve target tenant.
  let targetBioId: string | null;
  if (scope.tier === "super_admin") {
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

  const svc = getSupabaseService();

  // Send the auth invite (email + magic link).
  const { data: invited, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
    data: body?.fullName ? { full_name: body.fullName } : undefined,
  });
  if (inviteErr || !invited?.user) {
    return NextResponse.json({ error: inviteErr?.message ?? "Invite failed" }, { status: 500 });
  }

  // Map tier → legacy role for backwards compat (the binary role column is
  // still read by some code paths until Phase 4 sunsets it).
  const legacyRole = tier === "owner" ? "client" : tier === "manager" ? "client" : tier === "seller" ? "client" : "client";

  const { error: profileErr } = await svc
    .from("user_profiles")
    .insert({
      user_id: invited.user.id,
      company_bio_id: targetBioId,
      role: legacyRole,
      tier,
    });
  if (profileErr) {
    // Roll back the auth user so we don't leave an orphan record.
    await svc.auth.admin.deleteUser(invited.user.id).catch(() => null);
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  // Optional seller link: when tier=seller and the inviter picked a seller
  // record, attach the new auth user to that sellers row. Without this, the
  // seller-tier user logs in and sees nothing (the data filter resolves to
  // an empty list of seller IDs). Validation: the seller must belong to the
  // same tenant we're inviting into AND be currently unassigned.
  const sellerIdToLink = typeof body?.sellerId === "string" && body.sellerId ? body.sellerId : null;
  if (tier === "seller" && sellerIdToLink) {
    const { data: target } = await svc
      .from("sellers")
      .select("id, user_id, company_bio_id")
      .eq("id", sellerIdToLink)
      .maybeSingle();
    if (target && target.company_bio_id === targetBioId && !target.user_id) {
      await svc
        .from("sellers")
        .update({ user_id: invited.user.id })
        .eq("id", sellerIdToLink);
    }
    // If the link couldn't be applied (seller in wrong tenant or already
    // linked), the invite still succeeds — the seller link can be set later
    // via the user-edit modal. Surface this in a follow-up commit if it
    // becomes a common confusion.
  }

  return NextResponse.json({
    ok: true,
    user: { id: invited.user.id, email, tier },
  });
}
