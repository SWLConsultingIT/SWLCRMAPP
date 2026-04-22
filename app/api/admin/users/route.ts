import { getSupabaseService } from "@/lib/supabase-service";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = getSupabaseService();

  const [{ data: { users } }, { data: profiles }, { data: bios }] = await Promise.all([
    supabase.auth.admin.listUsers({ perPage: 200 }),
    supabase.from("user_profiles").select("user_id, role, company_bio_id"),
    supabase.from("company_bios").select("id, company_name").order("company_name"),
  ]);

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.user_id, p]));
  const bioMap = Object.fromEntries((bios ?? []).map(b => [b.id, b.company_name]));

  const result = (users ?? []).map(u => ({
    id: u.id,
    email: u.email ?? "",
    role: profileMap[u.id]?.role ?? null,
    company_bio_id: profileMap[u.id]?.company_bio_id ?? null,
    company_name: profileMap[u.id]?.company_bio_id ? (bioMap[profileMap[u.id].company_bio_id] ?? null) : null,
    created_at: u.created_at,
  }));

  return NextResponse.json({ users: result, companies: bios ?? [] });
}
