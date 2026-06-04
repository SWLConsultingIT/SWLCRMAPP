import { getSupabaseService } from "@/lib/supabase-service";

// Advance a lead's active campaign(s) past a CALL step.
//
// Calls are MANUAL — nothing auto-dispatches them, so the only things that move
// a campaign past a call step are: a wrong-number outcome (skips it), a stale
// auto-skip cron (after N days), or THIS — invoked when the seller has actually
// dialed/handled the call and the flow should move on:
//   • the legacy /api/aircall/dial path (a dial = the call happened), and
//   • a "bad timing" outcome (the call connected but it's a follow-up — the
//     call step is DONE, so the flow continues to the next step on schedule).
//
// Mirrors a normal step completion: mark the current call message `sent`,
// advance current_step + last_step_at (so the next step's daysAfter timer
// starts now), and flip the next draft step to `queued` so its channel's cron
// fires when eligible. If there's no next step, the campaign completes.
//
// `source` tags the audit metadata (e.g. "manual-dial-aircall",
// "call-outcome-bad-timing"). Advances at most one campaign per call.
export async function advanceCallStepForLead(
  svc: ReturnType<typeof getSupabaseService>,
  leadId: string,
  source: string,
): Promise<boolean> {
  const { data: campaigns } = await svc
    .from("campaigns")
    .select("id, current_step, sequence_steps, status")
    .eq("lead_id", leadId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(5);

  for (const c of (campaigns ?? []) as Array<{ id: string; current_step: number | null; sequence_steps: Array<{ channel?: string; daysAfter?: number }> | null }>) {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const currentStep = c.current_step ?? 0;
    // sequence_steps is 0-indexed; the pending step is steps[currentStep].
    const pendingStep = steps[currentStep];
    if (pendingStep?.channel !== "call") continue;

    const newStepNumber = currentStep + 1;
    const nextStepConfig = steps[newStepNumber] ?? null;
    const nextDaysAfter = typeof nextStepConfig?.daysAfter === "number" ? nextStepConfig.daysAfter : null;
    const nextEligibleAt = nextDaysAfter !== null
      ? new Date(Date.now() + nextDaysAfter * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const now = new Date().toISOString();
    // campaign_messages.step_number is 1-indexed; the call message sits at
    // newStepNumber (= currentStep + 1).
    const callStepNumber = newStepNumber;

    await Promise.all([
      svc.from("campaign_messages")
        .update({ status: "sent", sent_at: now, metadata: { dispatched_by: source, advanced_at: now } })
        .eq("campaign_id", c.id)
        .eq("step_number", callStepNumber)
        .eq("channel", "call")
        .eq("status", "queued"),
      svc.from("campaigns")
        .update({
          current_step: newStepNumber,
          last_step_at: now,
          ...(nextEligibleAt === null ? { status: "completed" } : {}),
        })
        .eq("id", c.id),
      ...(nextEligibleAt ? [
        svc.from("campaign_messages")
          .update({ status: "queued", metadata: { eligible_at: nextEligibleAt, queued_by: source } })
          .eq("campaign_id", c.id)
          .eq("step_number", callStepNumber + 1)
          .eq("status", "draft"),
      ] : []),
    ]);
    return true;
  }
  return false;
}
