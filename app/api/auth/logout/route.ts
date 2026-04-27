import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST() {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  const res = NextResponse.json({ ok: true });
  // Clear the tenant brand cookie so the next visit to /login shows the SWL
  // default gold instead of the previous tenant's color.
  res.headers.append("Set-Cookie", "swl-brand=; Path=/; Max-Age=0; SameSite=Lax");
  return res;
}
