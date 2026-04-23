import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    company_name, website, tagline, industry, description,
    value_proposition, main_services, target_market, differentiators,
    team_size, location, linkedin_url,
  } = body;

  if (!company_name || !description) {
    return NextResponse.json({ error: "company_name and description required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Derive email_domain from the user's email (skip personal domains so workspaces don't merge strangers)
  const PERSONAL = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.es",
    "hotmail.com", "hotmail.es", "hotmail.co.uk", "outlook.com", "live.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  ]);
  let emailDomain: string | null = null;
  const emailLower = (user.email ?? "").toLowerCase();
  const at = emailLower.lastIndexOf("@");
  if (at > 0) {
    const dom = emailLower.slice(at + 1);
    if (dom && dom.includes(".") && !PERSONAL.has(dom)) emailDomain = dom;
  }

  // Create company_bio
  const { data: bio, error: bioErr } = await svc
    .from("company_bios")
    .insert({
      company_name,
      website: website || null,
      tagline: tagline || null,
      industry: industry || null,
      description,
      value_proposition: value_proposition || null,
      main_services: Array.isArray(main_services) ? main_services : null,
      target_market: target_market || null,
      differentiators: differentiators || null,
      team_size: team_size || null,
      location: location || null,
      linkedin_url: linkedin_url || null,
      email_domain: emailDomain,
    })
    .select("id")
    .single();

  if (bioErr || !bio) {
    return NextResponse.json({ error: bioErr?.message ?? "Failed to create company bio" }, { status: 500 });
  }

  // Link the user's profile to this bio
  const { error: profErr } = await svc
    .from("user_profiles")
    .upsert({ user_id: user.id, company_bio_id: bio.id, role: "client" }, { onConflict: "user_id" });

  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, company_bio_id: bio.id });
}
