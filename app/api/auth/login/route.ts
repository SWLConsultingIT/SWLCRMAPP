import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

// Match brand.tsx: darken by 12% and build rgba with 0.15 alpha.
function darken(hex: string, amt = 0.12): string {
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amt)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amt)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amt)));
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    user: {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.user_metadata?.display_name ?? data.user.email,
      role: data.user.user_metadata?.role ?? "user",
    },
  });

  // Pre-seed the brand cookie so the first SSR of the dashboard paints in the
  // tenant's color with no FOUC. If branding is off/unset we skip it (gold default).
  try {
    const svc = getSupabaseService();
    const { data: profile } = await svc
      .from("user_profiles")
      .select("company_bio_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profile?.company_bio_id) {
      const { data: bio } = await svc
        .from("company_bios")
        .select("primary_color, use_brand_colors")
        .eq("id", profile.company_bio_id)
        .maybeSingle();

      const color = bio?.primary_color ?? null;
      const enabled = !!bio?.use_brand_colors && !!color && /^#[0-9A-Fa-f]{6}$/.test(color);
      if (enabled && color) {
        const payload = JSON.stringify({
          enabled: true,
          color,
          dark: darken(color, 0.12),
          soft: hexToRgba(color, 0.15),
        });
        response.headers.append(
          "Set-Cookie",
          `swl-brand=${encodeURIComponent(payload)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`
        );
      } else {
        // Clear any stale cookie if brand is disabled for this tenant.
        response.headers.append("Set-Cookie", `swl-brand=; Path=/; Max-Age=0; SameSite=Lax`);
      }
    }
  } catch {
    // non-fatal: login succeeds, brand will resolve client-side on next paint
  }

  return response;
}
