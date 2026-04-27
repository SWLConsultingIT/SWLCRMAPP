import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const { tone_of_voice, ideal_message_examples } = await req.json();

  const update: Record<string, unknown> = {};
  if (typeof tone_of_voice === "string" || tone_of_voice === null) update.tone_of_voice = tone_of_voice;
  if (Array.isArray(ideal_message_examples)) update.ideal_message_examples = ideal_message_examples;

  const supabase = getSupabaseService();
  const { error } = await supabase.from("company_bios").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
