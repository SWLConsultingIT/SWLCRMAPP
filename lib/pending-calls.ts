// Canonical "pending call" definition — the SINGLE source of truth for how many
// calls a seller actually has to make right now. Both the /queue "To Call" list
// and the dashboard "What to do today → Today's calls" count import this so the
// two can never disagree again (they used to: /queue applied the replied/phone/
// due guards, the dashboard just counted every queued call message → 6 vs 7 for
// Grupo IEB, 2026-07-01).
//
// A campaign contributes a pending call iff ALL hold:
//   1. the campaign is active,
//   2. its CURRENT step is a call step (sequence_steps[current_step].channel === 'call'),
//   3. the call has NOT already been handled: no campaign_message with status
//      'sent' or 'skipped' at step_number = current_step + 1. We use a block-list
//      (exclude handled) rather than an allow-list (require queued) so that
//      campaigns whose call message was never created by the dispatcher still
//      surface — a missing message means "not yet dispatched", not "done".
//   4. the lead has a phone on file and allow_call !== false,
//   5. the lead has NOT replied on a non-call channel (answered leads are worked
//      from the Inbox, not cold-called), and
//   6. the call is DUE — last_step_at + daysAfter has passed, rolled forward off
//      weekends, and today itself isn't a weekend.

type Step = { channel?: string; daysAfter?: number };

export type PendingCallCampaign = {
  id: string;
  lead_id: string | null;
  status?: string | null;
  current_step: number | null;
  sequence_steps: unknown;
  last_step_at?: string | null;
};

export type PendingCallLead = {
  primary_phone?: string | null;
  primary_secondary_phone?: string | null;
  allow_call?: boolean | null;
};

export type PendingCallInfo = {
  leadId: string;
  currentStepIdx: number;
  dueAt: number | null;
  isOverdue: boolean;
  overdueDays: number;
};

// Push a timestamp forward to Monday if it lands on Sat/Sun — sellers don't want
// "due today" calls surfacing over the weekend (boss 2026-05-27).
function rollWeekendForward(ts: number): number {
  const d = new Date(ts);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Returns a map of campaignId → due info for every campaign that currently owes
 * an actionable call. Callers build the three lookup structures from whatever
 * shape their data is in; the predicate itself lives here so it stays identical
 * across the app.
 */
export function computePendingCalls(opts: {
  campaigns: PendingCallCampaign[];
  leadById: Map<string, PendingCallLead>;
  /** campaignId → set of step_numbers whose call message is already handled (sent or skipped). */
  handledCallStepsByCampaign: Map<string, Set<number>>;
  /** lead ids that have replied on any channel OTHER than 'call'. */
  repliedNonCallLeadIds: Set<string>;
  now: number;
}): Map<string, PendingCallInfo> {
  const { campaigns, leadById, handledCallStepsByCampaign, repliedNonCallLeadIds, now } = opts;
  const todayDow = new Date(now).getDay();
  const isTodayWeekend = todayDow === 0 || todayDow === 6;

  const out = new Map<string, PendingCallInfo>();
  for (const c of campaigns) {
    if (c.status != null && c.status !== "active") continue;
    if (!c.lead_id) continue;
    const steps = Array.isArray(c.sequence_steps) ? (c.sequence_steps as Step[]) : [];
    const idx = c.current_step ?? 0;
    if (steps[idx]?.channel !== "call") continue;

    const lead = leadById.get(c.lead_id);
    const hasPhone = !!(lead?.primary_phone || lead?.primary_secondary_phone);
    if (!lead || lead.allow_call === false || !hasPhone) continue;

    if (repliedNonCallLeadIds.has(c.lead_id)) continue;

    // Skip if the call was already handled (sent or skipped). A missing entry
    // means the dispatcher hasn't created the message yet — that's still a
    // pending call, not a resolved one.
    const handledSteps = handledCallStepsByCampaign.get(c.id);
    if (handledSteps?.has(idx + 1)) continue;

    const daysAfter = steps[idx]?.daysAfter ?? 0;
    const rawDueAt = c.last_step_at ? new Date(c.last_step_at).getTime() + daysAfter * 86_400_000 : null;
    const dueAt = rawDueAt !== null ? rollWeekendForward(rawDueAt) : null;
    const isDue = isTodayWeekend ? false : dueAt !== null ? now >= dueAt : daysAfter === 0;
    if (!isDue) continue;

    const isOverdue = dueAt !== null && now > dueAt;
    const overdueDays = isOverdue && dueAt ? Math.floor((now - dueAt) / 86_400_000) : 0;
    out.set(c.id, { leadId: c.lead_id, currentStepIdx: idx, dueAt, isOverdue, overdueDays });
  }
  return out;
}
