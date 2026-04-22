import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseService();
  const { id } = await params;
  const body = await req.json();
  const step = Number(body.currentStep);
  if (!Number.isFinite(step) || step < 0) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }
  const { error } = await supabase
    .from("campaigns")
    .update({ current_step: step, last_step_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, currentStep: step });
}
