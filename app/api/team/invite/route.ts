import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canManageTeam, type Tier } from "@/lib/scope";

// Invite (or attach) a team member to one OR MORE tenants in a single call.
//
// Authorization:
//   - super_admin: can invite/attach into ANY tenant(s) (companyBioIds from body).
//                  Also the only tier that can grant `super_admin` to others.
//   - owner: can invite/attach into their own tenant only (any requested ids
//            other than their own are ignored).
//   - others: 403.
//
// Input (back-compat):
//   - companyBioIds: string[]   ← preferred, multi-tenant
//   - companyBioId:  string     ← legacy single-tenant, still accepted
//   - email, tier, fullName?, sellerId?
//
// Process:
//   1. Validate input + resolve the set of target tenants.
//   2. Look up the email in auth.users ONCE.
//        a. Existing → create a membership row per target tenant (idempotent).
//           If the user has no home tenant yet (e.g. a "pending" signup), set
//           user_profiles.company_bio_id + tier to the first target so they
//           stop showing up as unassigned.
//        b. New → send ONE Supabase Auth invite + user_profiles + one membership
//           row per target tenant.
//   3. When `tier === "super_admin"`, also set user_profiles.is_super_admin.
//   4. Optional seller link only applies when exactly one tenant is targeted.
//
// Response:
//   { ok: true, mode, user, results: [{ companyBioId, mode }] }
//   where per-tenant mode ∈ "invited" | "added" | "already_member".

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

  // Accept either companyBioIds[] (preferred) or a single companyBioId (legacy).
  const requestedIds: string[] = Array.isArray(body?.companyBioIds)
    ? body.companyBioIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
    : typeof body?.companyBioId === "string" && body.companyBioId
      ? [body.companyBioId]
      : [];

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!tier || !validTiers.includes(tier)) {
    return NextResponse.json({
      error: `tier must be one of: ${validTiers.join(", ")}`,
    }, { status: 400 });
  }

  // Resolve the set of target tenants (where membership rows will live).
  // super_admin honors the requested ids; everyone else is forced to their own
  // tenant regardless of what was asked.
  let targetBioIds: string[];
  if (isSuperAdminCaller) {
    targetBioIds = requestedIds.length ? Array.from(new Set(requestedIds)) : (scope.companyBioId ? [scope.companyBioId] : []);
    if (!targetBioIds.length) {
      return NextResponse.json({ error: "super_admin must specify companyBioIds" }, { status: 400 });
    }
  } else {
    if (!scope.companyBioId) {
      return NextResponse.json({ error: "No tenant" }, { status: 403 });
    }
    targetBioIds = [scope.companyBioId];
  }

  // Membership tier — super_admin is a global flag, not a tenant role, so
  // attach the user as "owner" of each target tenant alongside the global
  // is_super_admin=true. Without this they'd land on the switcher with zero
  // tenants and immediately bounce to a fallback view.
  const membershipTier: Exclude<Tier, "super_admin"> = tier === "super_admin" ? "owner" : tier;

  // Seller linking only makes sense for a single tenant (a seller record is
  // tenant-scoped). Ignored when multiple tenants are targeted.
  const sellerIdToLink =
    targetBioIds.length === 1 && tier === "seller" && typeof body?.sellerId === "string" && body.sellerId
      ? body.sellerId
      : null;

  const svc = getSupabaseService();

  // Look up the email — does this auth.users row already exist? We rely on
  // listUsers + filter-in-memory to match the rest of the codebase (this is
  // the same pattern /api/auth/check-email uses). Fine for tenants with
  // <thousands of users; revisit if Supabase exposes a direct getByEmail.
  const { data: existingList } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const existing = existingList?.users?.find(u => u.email?.toLowerCase() === email) ?? null;

  // Inserts one membership row per target tenant (idempotent). Returns the
  // per-tenant mode array. Caller handles is_super_admin + seller link.
  async function attachMemberships(userId: string): Promise<{ companyBioId: string; mode: "added" | "already_member" }[]> {
    const out: { companyBioId: string; mode: "added" | "already_member" }[] = [];
    for (const bioId of targetBioIds) {
      const { data: prior } = await svc
        .from("user_company_memberships")
        .select("user_id")
        .eq("user_id", userId)
        .eq("company_bio_id", bioId)
        .maybeSingle();
      if (prior) {
        out.push({ companyBioId: bioId, mode: "already_member" });
        continue;
      }
      const { error: memErr } = await svc.from("user_company_memberships").insert({
        user_id: userId,
        company_bio_id: bioId,
        tier: membershipTier,
        invited_by: scope.userId,
      });
      if (memErr) throw new Error(memErr.message);
      out.push({ companyBioId: bioId, mode: "added" });
    }
    return out;
  }

  async function linkSeller(userId: string) {
    if (!sellerIdToLink) return;
    const { data: target } = await svc
      .from("sellers")
      .select("id, user_id, company_bio_id")
      .eq("id", sellerIdToLink)
      .maybeSingle();
    if (target && target.company_bio_id === targetBioIds[0] && !target.user_id) {
      await svc.from("sellers").update({ user_id: userId }).eq("id", sellerIdToLink);
    }
  }

  if (existing) {
    // ─── Existing user → attach membership(s) ────────────────────────────
    let results;
    try {
      results = await attachMemberships(existing.id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to attach" }, { status: 500 });
    }

    // Ensure the user has a home tenant. Pending signups (and some legacy
    // rows) have user_profiles with a null company_bio_id, which keeps them
    // stuck in the "Pending Assignment" banner even after they get a
    // membership. Backfill it to the first target tenant + set their tier.
    const { data: prof } = await svc
      .from("user_profiles")
      .select("company_bio_id")
      .eq("user_id", existing.id)
      .maybeSingle();
    if (!prof || !prof.company_bio_id) {
      await svc.from("user_profiles").upsert(
        {
          user_id: existing.id,
          company_bio_id: targetBioIds[0],
          role: "client",
          tier: tier === "super_admin" ? "super_admin" : tier,
          ...(tier === "super_admin" ? { is_super_admin: true } : {}),
        },
        { onConflict: "user_id" }
      );
    } else if (tier === "super_admin") {
      await svc.from("user_profiles").update({ is_super_admin: true }).eq("user_id", existing.id);
    }

    await linkSeller(existing.id);

    const allAlready = results.every(r => r.mode === "already_member");
    return NextResponse.json({
      ok: true,
      mode: allAlready ? "already_member" : "added",
      user: { id: existing.id, email, tier },
      results,
    });
  }

  // ─── New user → ONE invite + profile + membership(s) ─────────────────────
  const { data: invited, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
    data: body?.fullName ? { full_name: body.fullName } : undefined,
  });
  if (inviteErr || !invited?.user) {
    return NextResponse.json({ error: inviteErr?.message ?? "Invite failed" }, { status: 500 });
  }

  const profileInsert: Record<string, unknown> = {
    user_id: invited.user.id,
    company_bio_id: targetBioIds[0], // home / landing tenant
    role: "client",
    tier: tier === "super_admin" ? "super_admin" : tier,
  };
  if (tier === "super_admin") profileInsert.is_super_admin = true;

  const { error: profileErr } = await svc.from("user_profiles").insert(profileInsert);
  if (profileErr) {
    await svc.auth.admin.deleteUser(invited.user.id).catch(() => null);
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  let results;
  try {
    results = await attachMemberships(invited.user.id);
  } catch (e) {
    // Best-effort rollback so we don't leave an orphan user without any
    // tenant linkage — they'd land on a login that resolves to nothing.
    // (Postgrest builders are thenable but have no .catch, so we await + try.)
    try { await svc.from("user_company_memberships").delete().eq("user_id", invited.user.id); } catch { /* ignore */ }
    try { await svc.from("user_profiles").delete().eq("user_id", invited.user.id); } catch { /* ignore */ }
    await svc.auth.admin.deleteUser(invited.user.id).catch(() => null);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to attach" }, { status: 500 });
  }

  await linkSeller(invited.user.id);

  return NextResponse.json({
    ok: true,
    mode: "invited",
    user: { id: invited.user.id, email, tier },
    results,
  });
}
