import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

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
  const res = await fetch("https://api.aircall.io/v1/numbers", {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    next: { revalidate: 300 },
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

  // FALLBACK PATH (no lead context): viewer-tenant scope. Super_admin sees
  // all numbers ONLY in this branch — used by surfaces that haven't been
  // upgraded to pass leadId. Should be deprecated once every caller wires
  // the leadId through.
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ numbers: shaped });

  const { data: profile } = await svc
    .from("user_profiles")
    .select("role, tier, company_bio_id")
    .eq("user_id", user.id)
    .single();

  const isSuperAdmin = (profile?.tier === "super_admin") || (profile?.role === "admin");
  if (isSuperAdmin || !profile?.company_bio_id) {
    return NextResponse.json({ numbers: shaped });
  }

  const { data: bio } = await svc
    .from("company_bios")
    .select("aircall_number_ids")
    .eq("id", profile.company_bio_id)
    .single();

  const allowed = bio?.aircall_number_ids as number[] | null;
  if (!allowed || allowed.length === 0) {
    return NextResponse.json({ numbers: [] });
  }
  const allowedSet = new Set(allowed.map(Number));
  return NextResponse.json({ numbers: shaped.filter(n => allowedSet.has(n.id)) });
}
