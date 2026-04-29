import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// POST /api/admin/demos
// Creates a new is_demo=true company_bios row. Accepts the same shape as the
// `/api/company-bios/scrape` response, so callers can paste a URL → scrape →
// pass through directly without massaging fields. Admin-only.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (scope.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    company_name?: string;
    industry?: string | null;
    tagline?: string | null;
    description?: string | null;
    value_proposition?: string | null;
    main_services?: string[] | null;
    differentiators?: string | null;
    target_market?: string | null;
    location?: string | null;
    tone_of_voice?: string | null;
    logo_url?: string | null;
    website?: string | null;
    linkedin_url?: string | null;
    instagram_url?: string | null;
    twitter_url?: string | null;
    facebook_url?: string | null;
    youtube_url?: string | null;
    tiktok_url?: string | null;
  };

  const company_name = body.company_name?.trim();
  if (!company_name) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }
  if (company_name.length > 120) {
    return NextResponse.json({ error: "company_name too long" }, { status: 400 });
  }

  const insertRow = {
    company_name,
    industry: body.industry?.trim() || null,
    tagline: body.tagline?.trim() || null,
    description: body.description?.trim() || null,
    value_proposition: body.value_proposition?.trim() || null,
    main_services: Array.isArray(body.main_services) ? body.main_services.slice(0, 12) : [],
    differentiators: body.differentiators?.trim() || null,
    target_market: body.target_market?.trim() || null,
    location: body.location?.trim() || null,
    tone_of_voice: body.tone_of_voice?.trim() || "professional",
    logo_url: body.logo_url?.trim() || null,
    website: body.website?.trim() || null,
    linkedin_url: body.linkedin_url?.trim() || null,
    instagram_url: body.instagram_url?.trim() || null,
    twitter_url: body.twitter_url?.trim() || null,
    facebook_url: body.facebook_url?.trim() || null,
    youtube_url: body.youtube_url?.trim() || null,
    tiktok_url: body.tiktok_url?.trim() || null,
    is_demo: true,
    tone_by_channel: { default: "professional", linkedin: null, email: null, call: null },
    languages: ["English"],
    certifications: [],
    key_clients: [],
    case_studies: [],
    resources: [],
  };

  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("company_bios")
    .insert(insertRow)
    .select("id, company_name")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bioId: data.id, companyName: data.company_name });
}
