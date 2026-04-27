import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ user: null });
  }

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id, role")
    .eq("user_id", user.id)
    .single();

  let companyName: string | null = null;
  let companyLogoUrl: string | null = null;
  if (profile?.company_bio_id) {
    const { data: bio } = await svc
      .from("company_bios")
      .select("company_name, logo_url")
      .eq("id", profile.company_bio_id)
      .maybeSingle();
    companyName = bio?.company_name ?? null;
    companyLogoUrl = bio?.logo_url ?? null;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.user_metadata?.display_name ?? user.user_metadata?.name ?? user.user_metadata?.full_name ?? user.email,
      role: profile?.role ?? user.user_metadata?.role ?? "client",
      companyBioId: profile?.company_bio_id ?? null,
      companyName,
      companyLogoUrl,
    },
  });
}
