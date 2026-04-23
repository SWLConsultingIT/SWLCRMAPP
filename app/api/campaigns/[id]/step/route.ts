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

  // Kanban semantics: Step N col = "Nth DM sent" = current_step=N.
  // - "skip": force current_step=N (fake that the Nth DM was sent). No orchestrator send.
  // - "send": set current_step=N-1 so the orchestrator's next cycle sends step_number=N.
  //           Post-send, the orchestrator naturally advances current_step to N.
  //           Back-date last_step_at to ensure daysAfter check passes.
  const update: Record<string, any> = action === "send"
    ? {
        current_step: Math.max(0, step - 1),
        paused_until: null,
        paused_channel: null,
        last_step_at: new Date(Date.now() - 7 * 86400000).toISOString(),
      }
    : {
        current_step: step,
        last_step_at: new Date().toISOString(),
      };

  const { error } = await supabase.from("campaigns").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, currentStep: step, action });
}
