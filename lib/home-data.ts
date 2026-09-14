// Home ("Start here") data — the priority list, the day's queue, and this
// week's performance, for the EFFECTIVE user.
//
// ── Effective user, not logged-in user ─────────────────────────────────────
// Everything here keys off `getUserScope()` + `getMyAssignedUserId()`. Under
// admin "View as Seller", `applyViewAs` has already downgraded `tier` to
// "seller" and `userId` to the seller's, so these resolvers return the SELLER's
// scope with no special-casing here. That is the whole point of that design:
// one identity path, no per-surface view-as branches to forget.
//
// ── Why this file does not load the tenant ─────────────────────────────────
// The previous version pulled `leads` + `campaigns` + `lead_replies` +
// `campaign_messages` in full for the tenant on every Home render — ~7.9k
// leads and ~37k messages for SWL, growing. Adding weekly metrics on top of
// that would have made the landing page the slowest screen in the product.
// Every read below is narrowed before it leaves the database:
//   · by TIME    — today / this week, never "all history"
//   · by STATE   — pending replies only, active campaigns only (951 of 5568)
//   · by PERSON  — the seller's own campaigns / activities / dials
// `campaign_messages.lead_id` and `.company_bio_id` are fully populated
// (verified 2026-09-14), so message reads scope directly instead of joining
// through campaigns.
//
// ── Definitions ────────────────────────────────────────────────────────────
// Metric semantics come from lib/metric-defs.ts — the audited, single source
// for contacted / replied / positive. This file does NOT define metrics; it
// scopes rows and hands them to those functions.

import { getSupabaseService } from "@/integrations/supabase/service";
import { getUserScope, getMyAssignedUserId, getMyAssignedLeadIds, getMyAssignedSellerIds } from "@/shared/auth/scope";
import { selectAllPages } from "@/integrations/supabase/bulk";
import { computePendingCalls, type PendingCallCampaign, type PendingCallLead } from "@/lib/pending-calls";
import { businessDayStartMs, businessToday, businessDayMinus } from "@/shared/lib/business-time";
import {
  contactedLeadIds, repliedLeadIds, positiveLeadIds, isSent,
  type ReplyRow as MetricReplyRow, type MessageRow as MetricMessageRow,
} from "@/lib/metric-defs";
import {
  rankPriorities, reasonForReply, notNowMatured,
  ACCEPTED_NO_FOLLOWUP_MIN_HOURS, MS_HOUR,
  type HomePriority, type LeadRef, type PrioritySignal,
} from "@/lib/home-priorities";

export type { HomePriority };

export type HomeTasks = {
  replies: number;
  calls: number;
  followUps: number;
  /** null = not applicable to this user (see `toAssign` below). */
  toAssign: number | null;
};

export type HomeActivity = { connections: number; messages: number; emails: number; calls: number };

export type HomePerformance = {
  reached: number;
  replies: number;
  positives: number;
  meetings: number;
  /** null = this seller has no weekly target → render the count with no bar. */
  target: number | null;
};

export type HomeData = {
  firstName: string | null;
  scope: "seller" | "team";
  viewingAsSellerName: string | null;
  priorities: HomePriority[];
  tasks: HomeTasks;
  /** Where "Leads to assign" points. null when the tile is hidden. */
  toAssignHref: string | null;
  activity: HomeActivity;
  performance: HomePerformance;
};

type LeadRow = {
  id: string; primary_first_name: string | null; primary_last_name: string | null;
  company_name: string | null; primary_phone: string | null;
  primary_secondary_phone: string | null; allow_call: boolean | null;
};
type CampRow = {
  id: string; lead_id: string | null; status: string | null;
  current_step: number | null; sequence_steps: unknown; last_step_at: string | null;
};
type ReplyRow = {
  id: string; lead_id: string | null; classification: string | null; channel: string | null;
  received_at: string | null; requires_human_review: boolean | null; review_status: string | null;
  reply_text: string | null;
};
type MsgRow = {
  id: string; campaign_id: string | null; lead_id: string | null; step_number: number | null;
  status: string | null; sent_at: string | null; channel: string | null; metadata: Record<string, unknown> | null;
};
type ActivityRow = {
  id: string; lead_id: string | null; type: string | null; status: string | null;
  due_at: string | null; source: string | null;
};
type CallRow = { id: string; lead_id: string | null; classification: string | null; started_at: string | null };

/** Chunk size for `.in()` — PostgREST chokes on very long URL filters. */
const IN_CHUNK = 80;

function chunk<T>(xs: T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Monday 00:00 of the current business week, in ms. */
function weekStartMs(nowMs: number): number {
  const todayKey = businessToday(new Date(nowMs));
  // businessWeekday: 0 = Sunday. Monday-based weeks, so Sunday counts as day 7.
  const d = new Date(todayKey + "T12:00:00.000Z").getUTCDay();
  const back = d === 0 ? 6 : d - 1;
  return businessDayStartMs(businessDayMinus(todayKey, back));
}

export async function getHomeData(nowMs: number = Date.now()): Promise<HomeData> {
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId : null;
  const myUserId = await getMyAssignedUserId();   // non-null ⇒ effective user is a seller
  const isSeller = myUserId !== null;
  const svc = getSupabaseService();

  const todayStart = businessDayStartMs(businessToday(new Date(nowMs)));
  const weekStart = weekStartMs(nowMs);
  const weekStartIso = new Date(weekStart).toISOString();
  const todayStartIso = new Date(todayStart).toISOString();
  const last30Iso = new Date(nowMs - 30 * 86_400_000).toISOString();

  // Greeting. Under view-as this is the SELLER's name, which is what makes the
  // preview read as the seller's own Home rather than the admin's.
  let firstName: string | null = null;
  if (scope.userId) {
    try {
      const { data } = await svc.auth.admin.getUserById(scope.userId);
      const meta = data?.user?.user_metadata as Record<string, unknown> | undefined;
      const email = data?.user?.email as string | undefined;
      const nm = (meta?.display_name ?? meta?.name ?? meta?.full_name) as string | undefined;
      let first = nm ? nm.trim().split(/\s+/)[0] : "";
      if (!first && email) {
        const lp = email.split("@")[0].split(/[._-]+/)[0];
        first = lp ? lp.charAt(0).toUpperCase() + lp.slice(1) : "";
      }
      firstName = first || null;
    } catch { /* greeting falls back to no name */ }
  }

  // The seller's lead universe. null ⇒ team view (no lead restriction).
  const myLeadIds = await getMyAssignedLeadIds();
  const mine = (leadId: string | null | undefined): boolean =>
    !leadId ? false : (myLeadIds ? myLeadIds.has(leadId) : true);

  // ── Active campaigns (the ONLY ones computePendingCalls looks at) ─────────
  const activeCamps = await selectAllPages<CampRow>("campaigns", () => {
    let q = svc.from("campaigns")
      .select("id, lead_id, status, current_step, sequence_steps, last_step_at, leads!inner(company_bio_id)")
      .eq("status", "active")
      .order("id", { ascending: true });
    if (bioId) q = q.eq("leads.company_bio_id", bioId);
    if (myUserId) q = q.eq("assigned_user_id", myUserId);
    return q as never;
  });
  const activeCampIds = activeCamps.map(c => c.id);
  const activeCampLeadIds = Array.from(new Set(activeCamps.map(c => c.lead_id).filter(Boolean) as string[]));

  // ── Everything else, in parallel ─────────────────────────────────────────
  const [
    callStepMsgs, pendingReplies, weekReplies, weekMsgs, todayMsgs,
    linkedinRecent, activities, weekCalls, todayCalls, callLeads,
  ] = await Promise.all([
    // Call-channel messages for the active campaigns — the "already handled"
    // block-list for the pending-call predicate. Scoped to those campaign ids.
    (async () => {
      const out: MsgRow[] = [];
      for (const ids of chunk(activeCampIds)) {
        const { data } = await svc.from("campaign_messages")
          .select("id, campaign_id, lead_id, step_number, status, sent_at, channel, metadata")
          .eq("channel", "call").in("campaign_id", ids).in("status", ["sent", "skipped"]);
        out.push(...((data ?? []) as MsgRow[]));
      }
      return out;
    })(),

    // Replies awaiting a human. Filtered at the DB — this is a handful of rows,
    // not the reply history.
    (async () => {
      let q = svc.from("lead_replies")
        .select("id, lead_id, classification, channel, received_at, requires_human_review, review_status, reply_text, leads!inner(company_bio_id)")
        .or("review_status.eq.pending,requires_human_review.eq.true")
        .neq("channel", "call")
        .order("received_at", { ascending: false })
        .limit(500);
      if (bioId) q = q.eq("leads.company_bio_id", bioId);
      const { data } = await q;
      return (data ?? []) as ReplyRow[];
    })(),

    // This week's replies — the performance numerator.
    (async () => {
      let q = svc.from("lead_replies")
        .select("id, lead_id, classification, channel, received_at, requires_human_review, review_status, reply_text, leads!inner(company_bio_id)")
        .gte("received_at", weekStartIso)
        .limit(2000);
      if (bioId) q = q.eq("leads.company_bio_id", bioId);
      const { data } = await q;
      return (data ?? []) as ReplyRow[];
    })(),

    // This week's sent messages — the "contacts reached" denominator source.
    (async () => {
      let q = svc.from("campaign_messages")
        .select("id, campaign_id, lead_id, step_number, status, sent_at, channel, metadata")
        .eq("status", "sent").gte("sent_at", weekStartIso).limit(5000);
      if (bioId) q = q.eq("company_bio_id", bioId);
      const { data } = await q;
      return (data ?? []) as MsgRow[];
    })(),

    // Today's sent messages — the activity counters.
    (async () => {
      let q = svc.from("campaign_messages")
        .select("id, campaign_id, lead_id, step_number, status, sent_at, channel, metadata")
        .eq("status", "sent").gte("sent_at", todayStartIso).limit(2000);
      if (bioId) q = q.eq("company_bio_id", bioId);
      const { data } = await q;
      return (data ?? []) as MsgRow[];
    })(),

    // Recent LinkedIn traffic — used to spot an accepted connection request
    // that never got a follow-up message.
    (async () => {
      let q = svc.from("campaign_messages")
        .select("id, campaign_id, lead_id, step_number, status, sent_at, channel, metadata")
        .eq("channel", "linkedin").gte("sent_at", last30Iso).limit(4000);
      if (bioId) q = q.eq("company_bio_id", bioId);
      const { data } = await q;
      return (data ?? []) as MsgRow[];
    })(),

    // Open activities assigned to the effective user. THE canonical follow-up
    // source (Fran 2026-09-14): ownership, due date, overdue and reminders all
    // live here. `lead_replies.classification='follow_up'` is a signal, not a
    // task, and is deliberately not counted as one.
    (async () => {
      let q = svc.from("activities")
        .select("id, lead_id, type, status, due_at, source")
        .eq("status", "pending").limit(500);
      if (bioId) q = q.eq("company_bio_id", bioId);
      if (scope.userId) q = q.eq("assigned_to", scope.userId);
      const { data } = await q;
      return (data ?? []) as ActivityRow[];
    })(),

    // This week's calls, by the human who dialled (95% populated vs 73% for
    // seller_id — and every seller shares one Aircall seat, so seller_id is
    // not a person).
    (async () => {
      let q = svc.from("calls")
        .select("id, lead_id, classification, started_at, leads!inner(company_bio_id)")
        .gte("started_at", weekStartIso).limit(2000);
      if (bioId) q = q.eq("leads.company_bio_id", bioId);
      if (scope.userId && isSeller) q = q.eq("dialed_by_user_id", scope.userId);
      const { data } = await q;
      return (data ?? []) as CallRow[];
    })(),

    (async () => {
      let q = svc.from("calls")
        .select("id, lead_id, classification, started_at, leads!inner(company_bio_id)")
        .gte("started_at", todayStartIso).limit(1000);
      if (bioId) q = q.eq("leads.company_bio_id", bioId);
      if (scope.userId && isSeller) q = q.eq("dialed_by_user_id", scope.userId);
      const { data } = await q;
      return (data ?? []) as CallRow[];
    })(),

    // Lead rows for the active campaigns — needed by the pending-call
    // predicate (phone + allow_call) and to label priority rows.
    (async () => {
      const out: LeadRow[] = [];
      for (const ids of chunk(activeCampLeadIds)) {
        const { data } = await svc.from("leads")
          .select("id, primary_first_name, primary_last_name, company_name, primary_phone, primary_secondary_phone, allow_call")
          .in("id", ids);
        out.push(...((data ?? []) as LeadRow[]));
      }
      return out;
    })(),
  ]);

  // ── Lead directory for labelling ─────────────────────────────────────────
  const leadById = new Map<string, LeadRow>(callLeads.map(l => [l.id, l]));
  const missingLeadIds = Array.from(new Set(
    [...pendingReplies.map(r => r.lead_id), ...activities.map(a => a.lead_id), ...linkedinRecent.map(m => m.lead_id)]
      .filter((id): id is string => !!id && !leadById.has(id)),
  ));
  for (const ids of chunk(missingLeadIds)) {
    const { data } = await svc.from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_phone, primary_secondary_phone, allow_call")
      .in("id", ids);
    for (const l of (data ?? []) as LeadRow[]) leadById.set(l.id, l);
  }

  const nameOf = (l: LeadRow | undefined): string | null =>
    l ? (`${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || null) : null;

  // ── Pending calls (canonical predicate) ──────────────────────────────────
  const handledCallStepsByCampaign = new Map<string, Set<number>>();
  for (const m of callStepMsgs) {
    if (!m.campaign_id || m.step_number == null) continue;
    const set = handledCallStepsByCampaign.get(m.campaign_id) ?? new Set<number>();
    set.add(m.step_number);
    handledCallStepsByCampaign.set(m.campaign_id, set);
  }
  // A lead that already replied is off the dial list.
  const repliedNonCallLeadIds = new Set<string>();
  for (const r of [...pendingReplies, ...weekReplies]) if (r.lead_id && r.channel !== "call") repliedNonCallLeadIds.add(r.lead_id);

  const pendingCalls = computePendingCalls({
    campaigns: activeCamps as unknown as PendingCallCampaign[],
    leadById: leadById as unknown as Map<string, PendingCallLead>,
    handledCallStepsByCampaign,
    repliedNonCallLeadIds,
    now: nowMs,
  });
  const callLeadIds = new Set<string>();
  const callOverdueByLead = new Map<string, number>();
  for (const info of pendingCalls.values()) {
    if (!leadById.has(info.leadId)) continue;
    callLeadIds.add(info.leadId);
    const prev = callOverdueByLead.get(info.leadId);
    if (prev == null || info.overdueDays > prev) callOverdueByLead.set(info.leadId, info.overdueDays);
  }

  // ── Signals for the priority engine ──────────────────────────────────────
  const signals: PrioritySignal[] = [];

  for (const r of pendingReplies) {
    if (!r.lead_id || !mine(r.lead_id)) continue;
    const reason = reasonForReply(r.classification);
    if (reason) {
      signals.push({ leadId: r.lead_id, reason, at: r.received_at, snippet: r.reply_text });
    } else if (r.classification === "not_now" && notNowMatured(r.received_at, nowMs)) {
      signals.push({ leadId: r.lead_id, reason: "not_now_matured", at: r.received_at, snippet: r.reply_text });
    }
  }

  // Callbacks and other open activities that are due or late.
  for (const a of activities) {
    if (!a.lead_id || !mine(a.lead_id)) continue;
    if (!a.due_at) continue;
    const dueMs = Date.parse(a.due_at);
    if (Number.isNaN(dueMs)) continue;
    const overdueDays = dueMs < todayStart ? Math.floor((todayStart - dueMs) / 86_400_000) + 1 : 0;
    if (dueMs < todayStart) {
      signals.push({ leadId: a.lead_id, reason: "callback_overdue", at: a.due_at, overdueDays });
    } else if (dueMs <= todayStart + 86_400_000) {
      signals.push({ leadId: a.lead_id, reason: "callback_today", at: a.due_at });
    }
  }

  for (const [leadId, overdueDays] of callOverdueByLead) {
    if (!mine(leadId)) continue;
    signals.push({ leadId, reason: "call_overdue", at: null, overdueDays: Math.max(overdueDays, 0) });
  }

  // Accepted connection request with nothing sent after it. `accepted_at` is
  // stamped on the step-0 message by the acceptance webhook.
  {
    const laterByCampaign = new Map<string, number>();  // campaign → max step sent
    for (const m of linkedinRecent) {
      if (!m.campaign_id || m.step_number == null || !isSent(m)) continue;
      const cur = laterByCampaign.get(m.campaign_id);
      if (cur == null || m.step_number > cur) laterByCampaign.set(m.campaign_id, m.step_number);
    }
    for (const m of linkedinRecent) {
      if (m.step_number !== 0 || !m.campaign_id || !m.lead_id || !mine(m.lead_id)) continue;
      const acceptedAt = (m.metadata?.accepted_at as string | undefined) ?? null;
      if (!acceptedAt) continue;
      const acceptedMs = Date.parse(acceptedAt);
      if (Number.isNaN(acceptedMs)) continue;
      if (nowMs - acceptedMs < ACCEPTED_NO_FOLLOWUP_MIN_HOURS * MS_HOUR) continue;
      if ((laterByCampaign.get(m.campaign_id) ?? 0) > 0) continue;   // already followed up
      if (repliedNonCallLeadIds.has(m.lead_id)) continue;            // they answered anyway
      signals.push({ leadId: m.lead_id, reason: "connection_accepted_no_followup", at: acceptedAt });
    }
  }

  const leadRefs = new Map<string, LeadRef>();
  for (const [id, l] of leadById) leadRefs.set(id, { id, name: nameOf(l), company: l.company_name });
  const priorities = rankPriorities(signals, leadRefs, nowMs);

  // ── My tasks ─────────────────────────────────────────────────────────────
  const replyTaskLeadIds = new Set<string>();
  for (const r of pendingReplies) if (r.lead_id && mine(r.lead_id)) replyTaskLeadIds.add(r.lead_id);

  const followUps = activities.filter(a => a.type === "follow_up" || a.source === "call_callback").length;

  // ── Leads to assign ──────────────────────────────────────────────────────
  // Workspace-level by nature: a lead has no owner until it is enrolled in a
  // flow, so there is no such thing as "MY unassigned leads". It is therefore
  // shown only to users who can actually act on it in bulk; for a seller the
  // tile is hidden (null) rather than showing a number that is not theirs.
  let toAssign: number | null = null;
  let toAssignHref: string | null = null;
  if (!isSeller) {
    const totalQ = svc.from("leads").select("id", { count: "exact", head: true });
    const { count: totalLeads } = await (bioId ? totalQ.eq("company_bio_id", bioId) : totalQ);
    const enrolled = await selectAllPages<{ lead_id: string | null }>("campaigns", () => {
      let q = svc.from("campaigns")
        .select("lead_id, leads!inner(company_bio_id)")
        .in("status", ["active", "paused"])
        .order("lead_id", { ascending: true });
      if (bioId) q = q.eq("leads.company_bio_id", bioId);
      return q as never;
    });
    const enrolledIds = new Set(enrolled.map(e => e.lead_id).filter(Boolean) as string[]);
    toAssign = Math.max(0, (totalLeads ?? 0) - enrolledIds.size);

    // Assignment lives in the ICP-ticket flow, never in the generic lead list.
    // With one ICP we can point at the exact ticket; with several there is no
    // global assignment view to point at (audit 2026-09-14: SWL has 9 ICPs
    // holding unassigned leads), so we land on the ticket list instead of
    // guessing one.
    let icpQ = svc.from("icp_profiles").select("id").limit(2);
    if (bioId) icpQ = icpQ.eq("company_bio_id", bioId);
    const { data: icps } = await icpQ;
    toAssignHref = (icps ?? []).length === 1
      ? `/leads/ticket/${(icps as { id: string }[])[0].id}?sub=unassigned`
      : "/icp";
  }

  // ── Activity done today ──────────────────────────────────────────────────
  const todayMine = todayMsgs.filter(m => mine(m.lead_id));
  const activity: HomeActivity = {
    // Step 0 on LinkedIn is the connection request; every later step is a DM.
    connections: todayMine.filter(m => m.channel === "linkedin" && m.step_number === 0).length,
    messages: todayMine.filter(m => m.channel === "linkedin" && (m.step_number ?? 0) > 0).length,
    emails: todayMine.filter(m => m.channel === "email").length,
    calls: todayCalls.filter(c => mine(c.lead_id)).length,
  };

  // ── Performance this week ────────────────────────────────────────────────
  const weekMine = weekMsgs.filter(m => mine(m.lead_id));
  // campaign_messages carries lead_id directly, so the canonical
  // contactedLeadIds() gets its map without a campaigns round-trip.
  const leadOfCampaign = new Map<string, string>();
  for (const m of weekMine) if (m.campaign_id && m.lead_id) leadOfCampaign.set(m.campaign_id, m.lead_id);
  const reached = contactedLeadIds(
    weekMine as unknown as MetricMessageRow[],
    leadOfCampaign,
    { fromMs: weekStart, toMs: null },
  );
  const weekRepliesMine = weekReplies.filter(r => mine(r.lead_id)) as unknown as MetricReplyRow[];

  // MEETINGS BOOKED — a confirmed meeting, nothing weaker. The only event in
  // the product that actually confirms one is a call dispositioned
  // `meeting_booked`. `lead_replies.classification='meeting_intent'` is a lead
  // SAYING they want to meet: a strong priority signal (it tops the priority
  // list) but not a booking, so it is deliberately NOT counted here.
  // KNOWN LIMITATION (audit 2026-09-14): there are 2 such calls in the whole
  // database, so this KPI will read 0 for almost every seller until meeting
  // capture is a real product flow. Correct-and-small beats inflated.
  const meetings = weekCalls.filter(c => mine(c.lead_id) && c.classification === "meeting_booked").length;

  // Weekly target for the EFFECTIVE seller. Under view-as this is the
  // impersonated seller's row, not the admin's.
  let target: number | null = null;
  {
    const sellerIds = scope.viewAsSellerId ? [scope.viewAsSellerId] : (await getMyAssignedSellerIds() ?? []);
    if (sellerIds.length > 0) {
      const { data } = await svc.from("sellers")
        .select("weekly_meeting_target").in("id", sellerIds).limit(1).maybeSingle();
      const raw = (data as { weekly_meeting_target: number | null } | null)?.weekly_meeting_target ?? null;
      target = typeof raw === "number" && raw > 0 ? raw : null;
    }
  }

  return {
    firstName,
    scope: isSeller ? "seller" : "team",
    viewingAsSellerName: scope.isViewingAsSeller ? scope.viewAsSellerName : null,
    priorities,
    tasks: {
      replies: replyTaskLeadIds.size,
      calls: callLeadIds.size,
      followUps,
      toAssign,
    },
    toAssignHref,
    activity,
    performance: {
      reached: reached.size,
      replies: repliedLeadIds(weekRepliesMine).size,
      positives: positiveLeadIds(weekRepliesMine).size,
      meetings,
      target,
    },
  };
}
