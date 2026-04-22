import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ exists: false });

  const svc = getSupabaseService();
  const { data } = await svc.auth.admin.listUsers();
  const exists = data?.users?.some(u => u.email?.toLowerCase() === email.toLowerCase()) ?? false;

  return NextResponse.json({ exists });
}
