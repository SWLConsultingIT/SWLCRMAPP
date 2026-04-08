import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ leads: [] });

  const { data } = await supabase
    .from("leads")
    .select("id, first_name, last_name, company, role, status, assigned_seller, email")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(8);

  return NextResponse.json({ leads: data ?? [] });
}
