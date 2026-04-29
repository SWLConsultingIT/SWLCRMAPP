import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ user: null });
  }

  // Single query with FK join — supabase-js unfolds it via the foreign-key
  // relationship between user_profiles.company_bio_id → company_bios.id.
  // Saves a sequential round-trip (~400-600ms in the wild).
  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id, role, company_bios(company_name, logo_url)")
    .eq("user_id", user.id)
    .maybeSingle();

  // The embedded relation can come back as an object or a single-item array
  // depending on supabase-js version; handle both shapes defensively.
  const rawBios = (profile as unknown as { company_bios?: unknown })?.company_bios;
  const bio = Array.isArray(rawBios)
    ? (rawBios[0] as { company_name: string | null; logo_url: string | null } | undefined) ?? null
    : (rawBios as { company_name: string | null; logo_url: string | null } | null) ?? null;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.user_metadata?.display_name ?? user.user_metadata?.name ?? user.user_metadata?.full_name ?? user.email,
      role: profile?.role ?? user.user_metadata?.role ?? "client",
      companyBioId: profile?.company_bio_id ?? null,
      companyName: bio?.company_name ?? null,
      companyLogoUrl: bio?.logo_url ?? null,
    },
  }, {
    // Auth-bound but stable — let the browser cache for a short window.
    // SWR pattern on the client already invalidates on auth-state-change.
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
