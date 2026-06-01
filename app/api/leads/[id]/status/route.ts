import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

const VALID = ["new", "contacted", "qualified", "cold", "closed_lost", "closed_won"];

// Marker prefix the UI looks for in lead_replies.reply_text to surface
// the "why this lead was lost" reason on /leads/lost/[id]. Stored in
// lead_replies (existing event store) instead of a dedicated column so
// the change is zero-migration. If we later spin up a `lead_lost_reasons`
// table we can backfill by parsing rows with this prefix.
export const LOST_REASON_PREFIX = "[LOST_REASON] ";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseService();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string; reason?: string };
  const { status, reason } = body;
  if (!status || !VALID.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  const { error } = await supabase.from("leads").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // When the lead transitions to closed_lost AND the caller supplied a
  // reason, log it to lead_replies so /leads/lost/[id] can render
  // "Why this lead was lost: <reason>" without a schema change.
  if (status === "closed_lost" && reason && reason.trim().length > 0) {
    await supabase.from("lead_replies").insert({
      lead_id: id,
      channel: "system",
      classification: "negative",
      reply_text: LOST_REASON_PREFIX + reason.trim(),
      received_at: new Date().toISOString(),
      requires_human_review: false,
    });
  }
  return NextResponse.json({ ok: true });
}
