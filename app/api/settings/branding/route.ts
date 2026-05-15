import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getOrFetchProfile, invalidateProfileCache } from "@/lib/user-profile-cache";

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read from the shared in-proc profile cache. BrandProvider fires this on
  // every first paint — was the #2 user_profiles read at 74 calls/min on
  // 2026-05-15. The cache row carries company_bios.primary_color +
  // use_brand_colors + logo_url so we don't fall back to a direct join.
  const profile = await getOrFetchProfile(user.id, getSupabaseService());
  const rawBios = profile?.company_bios;
  const bio = Array.isArray(rawBios) ? rawBios[0] ?? null : rawBios ?? null;

  return NextResponse.json({
    primary_color: bio?.primary_color ?? null,
    use_brand_colors: bio?.use_brand_colors ?? false,
    logo_url: bio?.logo_url ?? null,
  }, {
    // Browser-side cache headers stay no-store so a logo upload is visible
    // immediately on the next request; the server's in-proc cache (60s TTL)
    // is invalidated explicitly in the PATCH handler below + on
    // /api/company-bios mutations elsewhere, so this stays consistent.
    headers: { "Cache-Control": "no-store" },
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

  // Invalidate this user's cached row so the new branding shows up on the
  // very next render. Other users in the same tenant will see it after the
  // 60s TTL elapses on their cached rows — acceptable for branding edits.
  invalidateProfileCache(user.id);
  return NextResponse.json({ ok: true, primary_color, use_brand_colors });
}
