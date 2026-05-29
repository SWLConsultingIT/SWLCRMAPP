import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");

type AircallNumber = { id: number; name: string; digits: string; country: string };

// Returns the Aircall numbers that may be used to call a specific lead.
// Source of truth: the LEAD's company_bio.aircall_number_ids — not the
// viewer's tenant. Without this, a super_admin viewing a SWL lead would see
// every Aircall number across every tenant (Pathway's, Arqy's, etc.) and
// could accidentally dial a SWL prospect from a Pathway number.
//
// Backward compat: if no leadId is provided, fall back to the viewer's
// tenant scope (or all numbers for super_admin) so other call surfaces
// (manual queue dial, etc.) keep working until they pass leadId too.
export async function GET(req: NextRequest) {
  // The Aircall numbers list is cached for 5 min via Next's fetch revalidation —
  // good enough for most page loads but stale right after an admin adds or
  // removes a number in the Aircall dashboard. `?fresh=1` (sent by the refresh
  // button next to the CallButton picker) bypasses the cache so the seller
  // sees newly-claimed numbers immediately instead of waiting for the TTL.
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const res = await fetch("https://api.aircall.io/v1/numbers", {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }
  const { numbers = [] } = (await res.json()) as { numbers: AircallNumber[] };
  const shaped = numbers.map(n => ({
    id: n.id,
    name: n.name,
    digits: n.digits,
    country: n.country,
  }));

  const svc = getSupabaseService();
  const leadId = req.nextUrl.searchParams.get("leadId");

  // PRIMARY PATH: scope by the lead's tenant. Applies even for super_admin.
  if (leadId) {
    const { data: lead } = await svc
      .from("leads")
      .select("company_bio_id")
      .eq("id", leadId)
      .maybeSingle();
    const leadBioId = (lead as { company_bio_id?: string | null } | null)?.company_bio_id ?? null;
    if (!leadBioId) {
      return NextResponse.json({ numbers: [] });
    }
    const { data: bio } = await svc
      .from("company_bios")
      .select("aircall_number_ids")
      .eq("id", leadBioId)
      .maybeSingle();
    const allowed = bio?.aircall_number_ids as number[] | null;
    if (!allowed || allowed.length === 0) {
      return NextResponse.json({ numbers: [] });
    }
    const allowedSet = new Set(allowed.map(Number));
    return NextResponse.json({ numbers: shaped.filter(n => allowedSet.has(n.id)) });
  }

  // FALLBACK PATH (no lead context): scope to the user's ACTIVE tenant via
  // getUserScope(). When a super_admin has switched into a tenant via the
  // TenantSwitcher (cookie ACTIVE_TENANT_COOKIE), scope.companyBioId is that
  // tenant's id — even though the super_admin's own user_profiles.company_bio_id
  // is still SWL. Returning the global pool there was the bug Fran caught
  // 2026-05-29 in the campaign wizard: viewing Pathway, the Aircall picker
  // showed SWL's + Pathway's + Arqy's numbers. Now it correctly shows only
  // Pathway's. Only an UN-scoped super_admin (e.g. cross-tenant /admin
  // surfaces) sees the full pool.
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ numbers: shaped });
  if (!scope.isScoped) return NextResponse.json({ numbers: shaped });
  if (!scope.companyBioId) return NextResponse.json({ numbers: [] });

  const { data: bio } = await svc
    .from("company_bios")
    .select("aircall_number_ids")
    .eq("id", scope.companyBioId)
    .single();

  const allowed = bio?.aircall_number_ids as number[] | null;
  if (!allowed || allowed.length === 0) {
    return NextResponse.json({ numbers: [] });
  }
  const allowedSet = new Set(allowed.map(Number));
  return NextResponse.json({ numbers: shaped.filter(n => allowedSet.has(n.id)) });
}
