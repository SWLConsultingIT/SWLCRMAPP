// Ungated tenant roster for @mention + tag pickers. Unlike /api/team (admin
// only), ANY authenticated member of the tenant can read it — they need it to
// mention/tag teammates. Returns minimal { userId, name } only (no tier/role).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { prettyDisplayName } from "@/lib/display-name";

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ roster: [] });

  // super_admin may target any tenant via ?bioId; everyone else is their own.
  const requested = new URL(req.url).searchParams.get("bioId");
  const bioId = scope.tier === "super_admin" ? (requested ?? scope.companyBioId) : scope.companyBioId;
  if (!bioId) return NextResponse.json({ roster: [] });

  const svc = getSupabaseService();
  const { data: memberships } = await svc
    .from("user_company_memberships")
    .select("user_id")
    .eq("company_bio_id", bioId);
  const userIds = (memberships ?? []).map(m => m.user_id);
  if (userIds.length === 0) return NextResponse.json({ roster: [] });

  // Resolve display names from auth metadata (small N per tenant).
  const roster = await Promise.all(userIds.map(async (uid) => {
    try {
      const { data } = await svc.auth.admin.getUserById(uid);
      return { userId: uid, name: prettyDisplayName(data?.user?.user_metadata, data?.user?.email) };
    } catch {
      return { userId: uid, name: "Teammate" };
    }
  }));

  roster.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ roster });
}
