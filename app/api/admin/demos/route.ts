import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// POST /api/admin/demos
// Creates a new is_demo=true company_bios row with sane defaults so the demo
// is immediately enterable. Admin-only. Sample-data seeding is a separate
// step (POST /api/admin/demos/[id]/seed-leads) so the form stays snappy.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (scope.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    company_name?: string;
    industry?: string | null;
    tagline?: string | null;
    logo_url?: string | null;
  };

  const company_name = body.company_name?.trim();
  if (!company_name) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }
  if (company_name.length > 80) {
    return NextResponse.json({ error: "company_name too long" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("company_bios")
    .insert({
      company_name,
      industry: body.industry?.trim() || null,
      tagline: body.tagline?.trim() || null,
      logo_url: body.logo_url?.trim() || null,
      is_demo: true,
      // Sane defaults that match what the wizard would otherwise enforce.
      // Tone defaults to "professional" so AI generators behave the same as
      // a real tenant on first run.
      tone_of_voice: "professional",
      tone_by_channel: { default: "professional", linkedin: null, email: null, call: null },
      languages: ["English"],
      main_services: [],
      certifications: [],
      key_clients: [],
      case_studies: [],
      resources: [],
    })
    .select("id, company_name")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bioId: data.id, companyName: data.company_name });
}
