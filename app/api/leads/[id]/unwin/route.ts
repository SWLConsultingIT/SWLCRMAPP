import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

// Undo a "won". Wins are signal-driven — a positive/meeting_intent lead_reply
// OR an Odoo transfer — NOT leads.status (see app/results/page.tsx). So to pull
// a lead out of Won we clear those signals. Used when a call/reply was marked
// positive by mistake.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseService();
  const { id } = await params;

  // 1) Drop the positive / meeting-intent replies (the win signal). Other
  //    replies (not_now, negative, call history) are left untouched.
  const { error: e1 } = await supabase
    .from("lead_replies")
    .delete()
    .eq("lead_id", id)
    .in("classification", ["positive", "meeting_intent"]);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // 2) Clear the Odoo-transfer flag (the other win signal) and 3) revert a
  //    won/qualified status so the lead leaves the Won bucket. Any other status
  //    is left as-is.
  const { data: lead } = await supabase.from("leads").select("status").eq("id", id).maybeSingle();
  const st = (lead as { status?: string } | null)?.status ?? "";
  const patch: Record<string, unknown> = { transferred_to_odoo_at: null, updated_at: new Date().toISOString() };
  if (st === "closed_won" || st === "qualified") {
    patch.status = "contacted";
    patch.responded = false;
  }
  const { error: e2 } = await supabase.from("leads").update(patch).eq("id", id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
