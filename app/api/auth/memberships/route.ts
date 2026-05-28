import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getOrFetchProfile } from "@/lib/user-profile-cache";

// Lists every tenant the logged-in user can switch into. Powers the
// TenantSwitcher dropdown. Excludes archived bios — the user shouldn't
// be able to land inside a soft-deleted tenant via the switcher.
//
// Super admins are implicit members of every active bio. Without this,
// onboarding a new tenant required hand-adding a row in
// user_company_memberships for every SWL super_admin — brittle and the
// reason Juan couldn't see De Vera Grill (2026-05-28).
export async function GET() {
  const supabase = await getSupabaseServer();
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }
  if (!user) return NextResponse.json({ memberships: [] }, { status: 401 });

  const svc = getSupabaseService();
  const profile = await getOrFetchProfile(user.id, svc);
  const isSuperAdmin = profile?.tier === "super_admin";

  if (isSuperAdmin) {
    // God-mode list: every non-archived bio, tier reported as super_admin.
    const { data: bios } = await svc
      .from("company_bios")
      .select("id, company_name, logo_url, archived_at")
      .is("archived_at", null)
      .order("company_name", { ascending: true });
    const memberships = (bios ?? []).map(b => ({
      companyBioId: b.id,
      companyName: b.company_name,
      logoUrl: b.logo_url,
      tier: "super_admin" as const,
    }));
    return NextResponse.json({ memberships }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data } = await svc
    .from("user_company_memberships")
    .select("company_bio_id, tier, company_bios(id, company_name, logo_url, archived_at)")
    .eq("user_id", user.id);

  type RowBio = { id: string; company_name: string | null; logo_url: string | null; archived_at: string | null };
  type Row = { company_bio_id: string; tier: string; company_bios: RowBio | RowBio[] | null };

  const memberships = (data ?? []).map((row: unknown) => {
    const r = row as Row;
    const bioRaw = r.company_bios;
    const bio = Array.isArray(bioRaw) ? bioRaw[0] : bioRaw;
    if (!bio || bio.archived_at) return null;
    return {
      companyBioId: r.company_bio_id,
      companyName: bio.company_name,
      logoUrl: bio.logo_url,
      tier: r.tier,
    };
  }).filter((m): m is NonNullable<typeof m> => m !== null);

  return NextResponse.json({ memberships }, { headers: { "Cache-Control": "no-store" } });
}
