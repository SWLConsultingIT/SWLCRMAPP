import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

// Lists every tenant the logged-in user can switch into. Powers the
// TenantSwitcher dropdown. Excludes archived bios — the user shouldn't
// be able to land inside a soft-deleted tenant via the switcher.
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
