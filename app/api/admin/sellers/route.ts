import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { NextResponse } from "next/server";

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseService();
  const [{ data: sellers }, { data: bios }] = await Promise.all([
    supabase
      .from("sellers")
      .select("id, name, active, company_bio_id, linkedin_status, linkedin_status_note")
      .order("name"),
    supabase
      .from("company_bios")
      .select("id, company_name")
      .order("company_name"),
  ]);

  const bioMap: Record<string, string> = {};
  for (const b of bios ?? []) bioMap[b.id] = b.company_name;

  const result = (sellers ?? []).map(s => ({
    ...s,
    company_name: s.company_bio_id ? (bioMap[s.company_bio_id] ?? null) : null,
  }));

  return NextResponse.json({ sellers: result, companies: bios ?? [] });
}
