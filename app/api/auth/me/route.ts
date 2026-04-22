import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ user: null });
  }

  // Fetch company_bio_id and role from user_profiles
  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id, role")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.user_metadata?.display_name ?? user.email,
      role: profile?.role ?? user.user_metadata?.role ?? "client",
      companyBioId: profile?.company_bio_id ?? null,
    },
  });
}
