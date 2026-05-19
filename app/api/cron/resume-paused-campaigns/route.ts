// Cron: resume campaigns paused by auto-reply handler.
// Campaigns paused due to OOO auto-replies get status='paused' + a paused_until
// timestamp. When that window passes, this cron flips them back to 'active'.
//
// Only resumes campaigns where metadata->>'paused_reason' = 'autoreply' —
// campaigns manually paused by the seller are left alone.
//
// Auth: Bearer CRON_SECRET (same as all other crons). Wire into n8n Orquestador.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const CRON_SECRET = process.env.CRON_SECRET;

function authorized(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  const h = req.headers.get("authorization") ?? "";
  return h === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();
  const nowISO = new Date().toISOString();

  // Find campaigns paused by auto-reply whose pause window has expired.
  const { data: expired, error } = await svc
    .from("campaigns")
    .select("id, metadata")
    .eq("status", "paused")
    .lte("paused_until", nowISO)
    .not("paused_until", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const autoReplyPaused = (expired ?? []).filter(
    (c: any) => (c.metadata as Record<string, unknown> | null)?.paused_reason === "autoreply"
  );

  if (autoReplyPaused.length === 0) {
    return NextResponse.json({ ok: true, resumed: 0 });
  }

  const ids = autoReplyPaused.map((c: any) => c.id);

  const { error: updateErr } = await svc
    .from("campaigns")
    .update({ status: "active", paused_until: null })
    .in("id", ids);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    resumed: ids.length,
    campaignIds: ids,
  });
}
