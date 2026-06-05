import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { fetchLinkedInProfileFull, linkedinIdentifier } from "@/lib/linkedin-profile";
import { resolveUnipileAccount } from "@/lib/unipile-account";

// GET → the lead's full LinkedIn profile (About, full work history with dates,
// education, skills, languages, certifications) for the LinkedIn Enrichment
// panel. Fetched live from Unipile on demand (one profile view per click).
// `linkedin_internal_id` is a plain column even on client-source leads, so no
// decryption is needed just to resolve the identifier.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const svc = getSupabaseService();

  const { data: lead } = await svc
    .from("leads")
    .select("id, linkedin_internal_id, primary_linkedin_url, linkedin_assigned_account, company_bio_id")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const identifier = linkedinIdentifier(lead.linkedin_internal_id as string | null, lead.primary_linkedin_url as string | null);
  if (!identifier) return NextResponse.json({ profile: null, reason: "no_linkedin" });

  if (!lead.company_bio_id) return NextResponse.json({ profile: null, reason: "no_account" });
  const accountId = await resolveUnipileAccount(svc, lead.company_bio_id as string, lead.linkedin_assigned_account as string | null);
  if (!accountId) return NextResponse.json({ profile: null, reason: "no_account" });

  const profile = await fetchLinkedInProfileFull(identifier, accountId);
  if (!profile) return NextResponse.json({ profile: null, reason: "fetch_failed" });

  return NextResponse.json({ profile });
}
