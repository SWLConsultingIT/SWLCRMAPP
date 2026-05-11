import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { ACTIVE_TENANT_COOKIE } from "@/lib/scope";

// Switches the active tenant for the logged-in user.
// Body: { companyBioId: string | null }
//   - string → switch to that tenant (must have membership; archived bios rejected)
//   - null   → clear the cookie (falls back to user_profiles.company_bio_id)
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
  // bio, and the bio cannot be archived. Without this check, a tampered
  // cookie would route the user into any tenant.
  const svc = getSupabaseService();
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

  cookieStore.set(ACTIVE_TENANT_COOKIE, companyBioId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return NextResponse.json({ ok: true, companyBioId });
}
