import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const supabase = getSupabaseService();

  const update: Record<string, unknown> = {};
  if ("role" in body) update.role = body.role;
  if ("company_bio_id" in body) update.company_bio_id = body.company_bio_id;

  const { error } = await supabase
    .from("user_profiles")
    .upsert({ user_id: id, ...update }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseService();
  const { error } = await supabase.from("user_profiles").delete().eq("user_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
