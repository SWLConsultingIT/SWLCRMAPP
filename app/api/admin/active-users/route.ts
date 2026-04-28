import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";

// Admin-only feed for the live activity widget.
// Returns every user with their last_seen_at (proxy heartbeat) + display info,
// so the client can compute "in-app now / recent / idle" buckets without
// cross-tenant queries on the browser side.

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const svc = getSupabaseService();

  const [{ data: profiles }, { data: { users } }, { data: bios }] = await Promise.all([
    svc.from("user_profiles").select("user_id, role, company_bio_id, last_seen_at"),
    svc.auth.admin.listUsers({ perPage: 200 }),
    svc.from("company_bios").select("id, company_name"),
  ]);

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.user_id, p]));
  const bioMap = Object.fromEntries((bios ?? []).map(b => [b.id, b.company_name]));

  const result = (users ?? []).map(u => {
    const p = profileMap[u.id];
    return {
      id: u.id,
      email: u.email ?? "",
      name: (u.user_metadata?.name as string) || (u.user_metadata?.display_name as string) || (u.email?.split("@")[0] ?? ""),
      role: p?.role ?? null,
      company_bio_id: p?.company_bio_id ?? null,
      company_name: p?.company_bio_id ? (bioMap[p.company_bio_id] ?? null) : null,
      last_seen_at: p?.last_seen_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    };
  });

  // Order by last_seen_at desc (most recently active first).
  result.sort((a, b) => {
    const ta = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
    const tb = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
    return tb - ta;
  });

  return NextResponse.json({ users: result });
}
