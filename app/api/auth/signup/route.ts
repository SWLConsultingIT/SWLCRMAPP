import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

// Called after Supabase auth.signUp() confirms the user (via webhook or post-confirmation).
// Creates the user_profiles row that links the user to their company.
// Can also be called directly from the admin panel when creating a user for a specific company.
export async function POST(req: NextRequest) {
  const { userId, companyBioId, role = "client" } = await req.json();

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { error } = await svc
    .from("user_profiles")
    .upsert({ user_id: userId, company_bio_id: companyBioId ?? null, role }, { onConflict: "user_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
