import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseService();
  const { id } = await params;
  const body = await req.json();
  const step = Number(body.currentStep);
  const action: "skip" | "send" = body.action === "send" ? "send" : "skip";
  if (!Number.isFinite(step) || step < 0) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }

  // "skip" → advance current_step past the pending message (don't send it)
  // "send" → keep current_step at the pending message so orchestrator sends it next cycle,
  //          and clear any pause/schedule so it's processed ASAP
  const update: Record<string, any> = action === "send"
    ? {
        current_step: step,
        paused_until: null,
        paused_channel: null,
        last_step_at: new Date(Date.now() - 7 * 86400000).toISOString(), // back-date so daysAfter has elapsed
      }
    : {
        current_step: step,
        last_step_at: new Date().toISOString(),
      };

  const { error } = await supabase.from("campaigns").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, currentStep: step, action });
}
