import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Quick-classify endpoint triggered by the post-call popup on the lead
// detail. Four mutually exclusive outcomes, each mapped to a concrete
// CRM action so the seller doesn't have to remember which screen sets
// which field:
//
//   interested     → lead = qualified, active campaigns marked
//                    closed_won (stop_reason='call_positive')
//   not_interested → lead = closed_lost, campaigns closed_lost
//                    (stop_reason='call_negative')
//   bad_timing     → log the outcome only; the campaign keeps running
//                    on its normal cadence (follow-up will land per
//                    the existing sequence_steps). Fran 2026-06-01:
//                    'bad timing is follow up — que siga la campaign
//                    nomas'.
//   wrong_number   → lead.allow_call = false, every queued/draft call
//                    step on this lead's campaigns gets skipped, the
//                    campaign current_step advances past the bad step
//                    so other channels keep moving.
//
// All four log a synthetic lead_replies row with channel='call' so the
// outcome shows up in the History tab alongside email/LinkedIn replies.

type Outcome = "interested" | "not_interested" | "bad_timing" | "wrong_number";

const VALID: ReadonlySet<Outcome> = new Set(["interested", "not_interested", "bad_timing", "wrong_number"] as const);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: leadId } = await params;
  let body: { outcome?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const outcome = body.outcome as Outcome | undefined;
  if (!outcome || !VALID.has(outcome)) return NextResponse.json({ error: "invalid outcome" }, { status: 400 });

  const svc = getSupabaseService();
  const { data: lead } = await svc.from("leads").select("id, company_bio_id").eq("id", leadId).maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const summary = outcome === "interested" ? "Call outcome: interested — proceed to book meeting"
    : outcome === "not_interested" ? "Call outcome: not interested"
    : outcome === "bad_timing"     ? "Call outcome: bad timing — campaign continues normally"
                                   : "Call outcome: wrong number — call channel disabled for lead";

  // 1) Synthetic lead_reply so the outcome appears in /queue History
  //    (channel='call' bucket) — the seller's other surfaces already
  //    consume lead_replies, no need to invent a new event source.
  const classificationMap: Record<Outcome, string> = {
    interested: "positive",
    not_interested: "negative",
    bad_timing: "not_now",
    wrong_number: "wrong_number",
  };
  await svc.from("lead_replies").insert({
    lead_id: leadId,
    channel: "call",
    reply_text: body.note ? `${summary}\n\n${body.note}` : summary,
    classification: classificationMap[outcome],
    received_at: now,
    requires_human_review: false,
  });

  // 2) Per-outcome side effects on the lead + its campaigns.
  if (outcome === "interested") {
    await svc.from("leads").update({ status: "qualified", responded: true, response_outcome: "interested", updated_at: now }).eq("id", leadId);
    await svc.from("campaigns").update({ status: "completed", stop_reason: "call_positive", completed_at: now }).eq("lead_id", leadId).eq("status", "active");
  } else if (outcome === "not_interested") {
    await svc.from("leads").update({ status: "closed_lost", responded: true, response_outcome: "not_interested", updated_at: now }).eq("id", leadId);
    await svc.from("campaigns").update({ status: "closed_lost", stop_reason: "call_negative", completed_at: now }).eq("lead_id", leadId).eq("status", "active");
  } else if (outcome === "bad_timing") {
    // No campaign mutation — the lead_replies row above already
    // records the outcome for History. Campaign keeps running on
    // its existing cadence and the next step fires per sequence_steps.
    await svc.from("leads").update({ updated_at: now }).eq("id", leadId);
  } else {
    // wrong_number: flag the lead so future calls are blocked, then
    // walk every active/draft campaign step that's a call and skip
    // it. For the steps that are currently 'queued' (the current call
    // due in /queue), skipping unblocks the next non-call step via the
    // already-wired dispatcher advance logic — same path stale-call
    // cron uses.
    await svc.from("leads").update({ allow_call: false, primary_phone: null, primary_secondary_phone: null, updated_at: now }).eq("id", leadId);
    const { data: callMsgs } = await svc.from("campaign_messages")
      .select("id, campaign_id, step_number")
      .eq("lead_id", leadId)
      .eq("channel", "call")
      .in("status", ["queued", "draft"]);
    if (callMsgs && callMsgs.length > 0) {
      const ids = callMsgs.map((m: { id: string }) => m.id);
      await svc.from("campaign_messages").update({
        status: "skipped",
        error_details: "wrong_number — channel disabled for lead",
        metadata: { skipped_by: "call-outcome-wrong-number", skipped_at: now },
      }).in("id", ids);
      // Advance each affected campaign past the call step if it was the
      // current one — otherwise the campaign sits stuck on a now-skipped
      // call. Same advance shape dispatch-email uses after a send.
      const campaignIds = Array.from(new Set(callMsgs.map((m: { campaign_id: string }) => m.campaign_id)));
      for (const campaignId of campaignIds) {
        const { data: camp } = await svc.from("campaigns")
          .select("id, current_step, sequence_steps")
          .eq("id", campaignId)
          .maybeSingle();
        if (!camp) continue;
        const seq = Array.isArray(camp.sequence_steps) ? camp.sequence_steps : [];
        const currentStep = camp.current_step ?? 0;
        // If the current step itself is a call, push current_step forward
        // so the next dispatcher tick looks at the step after it.
        if (seq[currentStep]?.channel === "call") {
          await svc.from("campaigns").update({
            current_step: currentStep + 1,
            last_step_at: now,
          }).eq("id", campaignId);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, outcome });
}
