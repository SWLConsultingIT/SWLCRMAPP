import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");

type AircallNumber = { id: number; name: string; digits: string; country: string };

export async function GET() {
  // Fetch all Aircall numbers
  const res = await fetch("https://api.aircall.io/v1/numbers", {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }
  const { numbers = [] } = (await res.json()) as { numbers: AircallNumber[] };
  const shaped = numbers.map(n => ({
    id: n.id,
    name: n.name,
    digits: n.digits,
    country: n.country,
  }));

  // Filter by current user's company (admin sees all)
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ numbers: shaped });

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("role, company_bio_id")
    .eq("user_id", user.id)
    .single();

  if (profile?.role === "admin" || !profile?.company_bio_id) {
    return NextResponse.json({ numbers: shaped });
  }

  const { data: bio } = await svc
    .from("company_bios")
    .select("aircall_number_ids")
    .eq("id", profile.company_bio_id)
    .single();

  const allowed = bio?.aircall_number_ids as number[] | null;
  if (!allowed || allowed.length === 0) {
    return NextResponse.json({ numbers: [] });
  }
  const allowedSet = new Set(allowed.map(Number));
  return NextResponse.json({ numbers: shaped.filter(n => allowedSet.has(n.id)) });
}
