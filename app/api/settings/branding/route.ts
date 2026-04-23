import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.company_bio_id) return NextResponse.json({ primary_color: null, use_brand_colors: false });

  const { data: bio } = await svc
    .from("company_bios")
    .select("primary_color, use_brand_colors, logo_url")
    .eq("id", profile.company_bio_id)
    .maybeSingle();

  return NextResponse.json({
    primary_color: bio?.primary_color ?? null,
    use_brand_colors: bio?.use_brand_colors ?? false,
    logo_url: bio?.logo_url ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const primary_color: string | null = body.primary_color ?? null;
  const use_brand_colors: boolean = body.use_brand_colors ?? false;

  // Validate hex color
  if (primary_color !== null && !/^#[0-9A-Fa-f]{6}$/.test(primary_color)) {
    return NextResponse.json({ error: "primary_color must be a hex like #RRGGBB" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.company_bio_id) return NextResponse.json({ error: "No company bio" }, { status: 400 });

  const { error } = await svc
    .from("company_bios")
    .update({ primary_color, use_brand_colors })
    .eq("id", profile.company_bio_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, primary_color, use_brand_colors });
}
