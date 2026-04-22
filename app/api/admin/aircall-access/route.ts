import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");

type AircallNumber = { id: number; name: string; digits: string; country: string };

export async function GET() {
  const supabase = getSupabaseService();
  const [res, { data: bios }] = await Promise.all([
    fetch("https://api.aircall.io/v1/numbers", {
      headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
      next: { revalidate: 300 },
    }),
    supabase.from("company_bios").select("id, company_name, aircall_number_ids").order("company_name"),
  ]);
  const { numbers = [] } = (await res.json()) as { numbers: AircallNumber[] };
  return NextResponse.json({ numbers, companies: bios ?? [] });
}

export async function PATCH(req: NextRequest) {
  const { companyBioId, aircallNumberIds } = await req.json();
  if (!companyBioId) return NextResponse.json({ error: "Missing companyBioId" }, { status: 400 });
  const supabase = getSupabaseService();
  const { error } = await supabase
    .from("company_bios")
    .update({ aircall_number_ids: Array.isArray(aircallNumberIds) ? aircallNumberIds : null })
    .eq("id", companyBioId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
