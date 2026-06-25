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

  // Bug 10 fix: re-queue draft messages for the next step of each resumed campaign
  // whose eligible_at is already in the past. When a campaign is paused mid-sequence
  // the next step stays in 'draft' (dispatchers skip paused campaigns), so the
  // resume flip alone won't trigger a send — we must flip draft→queued here.
  const { data: draftMsgs } = await svc
    .from("campaign_messages")
    .select("id, step_number, metadata, campaigns!inner(current_step)")
    .in("campaign_id", ids)
    .eq("status", "draft");

  const toRequeue = (draftMsgs ?? []).filter((m: any) => {
    const currentStep = (m as any).campaigns?.current_step ?? -1;
    if (m.step_number !== currentStep + 1) return false;
    const eligibleAt = (m?.metadata as any)?.eligible_at;
    if (!eligibleAt) return true;
    return new Date(eligibleAt).getTime() <= Date.now();
  });

  for (const m of toRequeue) {
    const prevMeta = ((m as any).metadata as Record<string, unknown> | null) ?? {};
    await svc.from("campaign_messages")
      .update({ status: "queued", metadata: { ...prevMeta, eligible_at: nowISO, queued_by: "resume-paused" } })
      .eq("id", (m as any).id);
  }

  return NextResponse.json({
    ok: true,
    resumed: ids.length,
    requeued: toRequeue.length,
    campaignIds: ids,
  });
}
