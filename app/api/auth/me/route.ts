import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { DEMO_SESSION_COOKIE, ACTIVE_TENANT_COOKIE } from "@/lib/scope";

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
    .select("company_bio_id, role, tier, company_bios(company_name, logo_url)")
    .eq("user_id", user.id)
    .maybeSingle();

  // The embedded relation can come back as an object or a single-item array
  // depending on supabase-js version; handle both shapes defensively.
  const rawBios = (profile as unknown as { company_bios?: unknown })?.company_bios;
  const bio = Array.isArray(rawBios)
    ? (rawBios[0] as { company_name: string | null; logo_url: string | null } | undefined) ?? null
    : (rawBios as { company_name: string | null; logo_url: string | null } | null) ?? null;

  const role = (profile?.role ?? user.user_metadata?.role ?? "client") as string;
  // tier was backfilled in migration 010. Defensive default from role for
  // any pre-migration row that slipped through.
  const tier = (profile?.tier as string | null | undefined)
    ?? (role === "admin" ? "super_admin" : "owner");

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

  const displayName = (user.user_metadata?.display_name ?? user.user_metadata?.name ?? user.user_metadata?.full_name ?? user.email) as string | undefined;

  // ─── Demo impersonation override ────────────────────────────────────────
  // While inside a demo tenant, the entire UX should pretend the user belongs
  // to that company. Top-right header shows the demo's name/logo, role is
  // demoted to "client" so admin-only nav (Sidebar `adminOnly`, /admin route
  // guards) auto-hides without case-by-case patches, and queries that scope
  // by `companyBioId` from this payload land on demo data.
  if (demoMode.active) {
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName,
        role: "client",
        // Demo impersonation = act as `owner` of the demo tenant. Hides
        // SWL super_admin views automatically.
        tier: "owner",
        companyBioId: demoMode.bioId,
        companyName: demoMode.companyName,
        companyLogoUrl: demoMode.logoUrl,
      },
      demoMode,
    }, {
      // No caching while impersonating — flipping the cookie has to flip
      // this payload immediately (max-age=30 was eating the override on
      // client-side nav).
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Multi-tenant switcher: honor ACTIVE_TENANT_COOKIE if it points at a bio
  // the user has membership in. Falls back to user_profiles.company_bio_id.
  // We validate server-side so a tampered cookie can't redirect the UI into
  // a tenant the user doesn't belong to.
  const cookieStoreActive = await cookies();
  const activeCookie = cookieStoreActive.get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  let effectiveBioId: string | null = profile?.company_bio_id ?? null;
  let effectiveBioName: string | null = bio?.company_name ?? null;
  let effectiveBioLogo: string | null = bio?.logo_url ?? null;
  let effectiveTier: string = tier;
  if (activeCookie && activeCookie !== effectiveBioId) {
    const { data: m } = await svc
      .from("user_company_memberships")
      .select("tier, company_bios(id, company_name, logo_url, archived_at)")
      .eq("user_id", user.id)
      .eq("company_bio_id", activeCookie)
      .maybeSingle();
    type ActiveBio = { id: string; company_name: string | null; logo_url: string | null; archived_at: string | null };
    const aBioRaw = (m as { company_bios?: ActiveBio | ActiveBio[] | null } | null)?.company_bios;
    const aBio = Array.isArray(aBioRaw) ? aBioRaw[0] : aBioRaw;
    if (aBio && !aBio.archived_at) {
      effectiveBioId = aBio.id;
      effectiveBioName = aBio.company_name;
      effectiveBioLogo = aBio.logo_url;
      effectiveTier = (m?.tier as string | undefined) ?? tier;
    }
  }

  // Full membership list so the TenantSwitcher dropdown renders without a
  // separate round-trip when /me is the first fetch on app boot.
  const { data: memData } = await svc
    .from("user_company_memberships")
    .select("company_bio_id, tier, company_bios(id, company_name, logo_url, archived_at)")
    .eq("user_id", user.id);
  type MemBio = { id: string; company_name: string | null; logo_url: string | null; archived_at: string | null };
  type MemRow = { company_bio_id: string; tier: string; company_bios: MemBio | MemBio[] | null };
  const memberships = (memData ?? []).map((row: unknown) => {
    const r = row as MemRow;
    const bioRaw = r.company_bios;
    const b = Array.isArray(bioRaw) ? bioRaw[0] : bioRaw;
    if (!b || b.archived_at) return null;
    return { companyBioId: r.company_bio_id, companyName: b.company_name, logoUrl: b.logo_url, tier: r.tier };
  }).filter((m): m is NonNullable<typeof m> => m !== null);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName,
      role,
      tier: effectiveTier,
      companyBioId: effectiveBioId,
      companyName: effectiveBioName,
      companyLogoUrl: effectiveBioLogo,
    },
    memberships,
    demoMode,
  }, {
    // No-store on auth payload. The earlier 30s cache was eating logout/login
    // flips: user A logs out, user B logs in, and the browser served user A's
    // /api/auth/me response from cache → header showed user A's identity for
    // up to 30s after login. Hard fix: never cache auth.
    headers: { "Cache-Control": "no-store" },
  });
}
