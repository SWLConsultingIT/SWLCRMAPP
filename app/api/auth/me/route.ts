import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { DEMO_SESSION_COOKIE } from "@/lib/scope";

export async function GET() {
  const supabase = await getSupabaseServer();
  // Same defensive guard as in lib/scope.ts: a rotated/expired refresh token
  // makes supabase-ssr throw instead of returning null. Catch and treat as
  // anonymous so the client gets a clean { user: null } payload it can act on.
  let user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

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

  const role = (profile?.role ?? user.user_metadata?.role ?? "client") as string;

  // Demo impersonation surface: if admin AND a valid demo cookie is set, expose
  // the demo tenant's id + name so the UI can render the banner without an
  // additional round-trip. Cookie is HttpOnly so client JS can't read it directly.
  let demoMode: { active: false } | { active: true; bioId: string; companyName: string | null; logoUrl: string | null } = { active: false };
  if (role === "admin") {
    const cookieStore = await cookies();
    const demoBioId = cookieStore.get(DEMO_SESSION_COOKIE)?.value ?? null;
    if (demoBioId) {
      const { data: demoBio } = await svc
        .from("company_bios")
        .select("id, company_name, logo_url, is_demo")
        .eq("id", demoBioId)
        .eq("is_demo", true)
        .maybeSingle();
      if (demoBio?.id) {
        demoMode = { active: true, bioId: demoBio.id, companyName: demoBio.company_name, logoUrl: demoBio.logo_url };
      }
    }
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.user_metadata?.display_name ?? user.user_metadata?.name ?? user.user_metadata?.full_name ?? user.email,
      role,
      companyBioId: profile?.company_bio_id ?? null,
      companyName: bio?.company_name ?? null,
      companyLogoUrl: bio?.logo_url ?? null,
    },
    demoMode,
  }, {
    // Auth-bound but stable — let the browser cache for a short window.
    // SWR pattern on the client already invalidates on auth-state-change.
    // Demo cookie changes go through router.refresh() so the cache is busted.
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
