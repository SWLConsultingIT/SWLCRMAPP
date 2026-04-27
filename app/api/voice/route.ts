import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

// Returns + updates the brand voice for the *currently logged-in user's* tenant.
// Distinct from /api/admin/company-bios/[id]/voice (which lets a SWL admin edit
// any tenant) — this one always operates on the caller's own company_bio_id, so
// the client UI never has to guess the id.

async function resolveCompanyBioId() {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const id = profile?.company_bio_id ?? null;
  if (!id) return { error: "No tenant assigned", status: 400 as const };
  return { id };
}

export async function GET() {
  const r = await resolveCompanyBioId();
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("company_bios")
    .select("id, company_name, tone_of_voice, ideal_message_examples")
    .eq("id", r.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  return NextResponse.json({ bio: data });
}

export async function PATCH(req: Request) {
  const r = await resolveCompanyBioId();
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const { tone_of_voice, ideal_message_examples } = await req.json();
  const update: Record<string, unknown> = {};
  if (typeof tone_of_voice === "string" || tone_of_voice === null) update.tone_of_voice = tone_of_voice;
  if (Array.isArray(ideal_message_examples)) update.ideal_message_examples = ideal_message_examples;

  const svc = getSupabaseService();
  const { error } = await svc.from("company_bios").update(update).eq("id", r.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
