import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.es",
  "hotmail.com", "hotmail.es", "hotmail.co.uk", "outlook.com", "live.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "zoho.com", "gmx.com", "mail.com",
]);

function extractDomain(email: string): string | null {
  if (!email || typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.length < 3 || !domain.includes(".")) return null;
  if (PERSONAL_DOMAINS.has(domain)) return null;
  return domain;
}

// Called after Supabase auth.signUp(). Creates user_profiles and attempts domain matching:
// if the user's email domain matches an existing company_bio.email_domain, auto-link them.
export async function POST(req: NextRequest) {
  const { userId, email, companyBioId, role = "client" } = await req.json();

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  let finalCompanyBioId: string | null = companyBioId ?? null;
  let matchedDomain: string | null = null;
  let matchedCompany: string | null = null;

  // If no explicit company, try domain matching
  if (!finalCompanyBioId) {
    const domain = extractDomain(email ?? "");
    if (domain) {
      const { data: existing } = await svc
        .from("company_bios")
        .select("id, company_name")
        .ilike("email_domain", domain)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        finalCompanyBioId = existing.id;
        matchedDomain = domain;
        matchedCompany = existing.company_name;
      }
    }
  }

  const { error } = await svc
    .from("user_profiles")
    .upsert({ user_id: userId, company_bio_id: finalCompanyBioId, role }, { onConflict: "user_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    companyBioId: finalCompanyBioId,
    matchedDomain,
    matchedCompany,
  });
}
