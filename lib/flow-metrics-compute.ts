// Shared Flow-Metrics computation — extracted from app/campaigns/[id]/page.tsx
// (perf refactor 2026-08-28). Used by the page (initial render) AND the
// /api/campaigns/[id]/flow-metrics route (filtered recompute) so filter changes
// don't re-run the whole flow page. Metric definitions are UNCHANGED — this is
// a move + a decrypt-free resolver, not a logic change.
import { type FlowMetrics, type DrillLead } from "@/components/FlowMetricsPanel";
import { isRealCall, isConnected, isPositiveOutcome, callOutcomeGroup, healthOf, pctOf, type CallRow } from "@/lib/flow-metrics-lib";

export type CampRow = { lead_id: string; status: string; current_step: number | null; started_at: string | null; seller_id: string | null; last_step_at: string | null };
export type MetricsFilters = { sellerFilter: string | null; range: string; winFrom: number | null; winTo: number };

export function failCategory(e: string | null): string {
  const s = (e ?? "").toLowerCase();
  if (!s) return "Unknown";
  if (s.includes("name mismatch")) return "Name mismatch";
  if (s.includes("not found") || s.includes("/users/") || s.includes("404")) return "Profile not found";
  if (s.includes("422") || s.includes("limit")) return "Rate limit";
  if (s.includes("bounce")) return "Bounce";
  if (s.includes("empty body") || s.includes("placeholder")) return "Content/placeholder";
  return "Other";
}

export async function getFlowMetrics(
  campaignIds: string[],
  leadIds: string[],
  sequence: { channel: string; daysAfter: number }[],
  leadInfo: Map<string, { name: string; company: string | null }>,
  channelsUsed: string[],
  progressPct: number,
  campRows: { lead_id: string; status: string; current_step: number | null; started_at: string | null; seller_id: string | null; last_step_at: string | null }[],
  dailyLimit: number | null,
  sellerMap: Map<string, string>,
): Promise<FlowMetrics | null> {
  if (campaignIds.length === 0) return null;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sbKey = process.env.SUPABASE_SERVICE_KEY!;
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const restGet = async (path: string): Promise<any[]> => {
    try { const r = await fetch(`${sbUrl}/rest/v1/${path}`, { headers, cache: "no-store" }); return r.ok ? await r.json() : []; } catch { return []; }
  };
  type Msg = { lead_id: string; step_number: number; channel: string; status: string; sent_at: string | null; error_details: string | null; metadata: Record<string, unknown> | null };
  const chunk = <T,>(arr: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const inCl = (a: string[]) => encodeURIComponent(`(${a.join(",")})`);
  // Fetch every raw slice CONCURRENTLY — the 4 phases (messages / lead-status /
  // replies / calls) are independent and each phase's chunks run in parallel.
  // This replaced ~57 SEQUENTIAL REST round-trips (3-4 s on the 1166-lead PE&VC
  // flow) with a few concurrent waves. Same data, same downstream logic.
  const [msgsRaw, leadStatusRows, replyRowsRaw, callRowsRaw] = await Promise.all([
    Promise.all(chunk(campaignIds, 80).map(c => restGet(`campaign_messages?campaign_id=in.${inCl(c)}&select=lead_id,step_number,channel,status,sent_at,error_details,metadata`))).then(a => a.flat() as Msg[]),
    Promise.all(chunk(leadIds, 100).map(c => restGet(`leads?id=in.${inCl(c)}&select=id,linkedin_connected,primary_email_status,status`))).then(a => a.flat()),
    Promise.all(chunk(leadIds, 100).map(c => restGet(`lead_replies?lead_id=in.${inCl(c)}&select=lead_id,classification,channel,reply_text,received_at`))).then(a => a.flat()),
    Promise.all(chunk(leadIds, 100).map(c => restGet(`calls?lead_id=in.${inCl(c)}&select=lead_id,seller_id,status,duration,classification,aircall_call_id,started_at`))).then(a => a.flat()),
  ]);
  // Cohort scoping: campaign_messages are fetched by campaign id, so restrict
  // to this cohort's leads. No-op when leadIds = full flow.
  const cohortSet = new Set(leadIds);
  const msgs: Msg[] = msgsRaw.filter(m => cohortSet.has(m.lead_id));
  const connected = new Set<string>(); const bouncedSet = new Set<string>(); const lostSet = new Set<string>();
  const qualifiedSet = new Set<string>(); // meetings = unique leads at status 'qualified' (single attribution — see def #5)
  leadStatusRows.forEach((r: any) => {
    if (r.linkedin_connected) connected.add(r.id);
    if (r.primary_email_status === "bounced") bouncedSet.add(r.id);
    if (r.status === "closed_lost") lostSet.add(r.id);
    if (r.status === "qualified") qualifiedSet.add(r.id);
  });
  // Reply classification per lead (strongest: positive > question > negative > other)
  // + the latest reply text so the UI can show exactly what each lead said.
  const replyClass = new Map<string, string>();
  const replyText = new Map<string, { text: string; at: string; channel: string }>();
  const repliesByChannel: Record<string, Set<string>> = {};
  const positiveByChannel: Record<string, Set<string>> = {};
  const firstReplyAt = new Map<string, string>();
  const replyDates: string[] = [];
  // Bucketing aligned with the inbox classBadge so Metrics + Inbox + lead
  // detail show the SAME label. rank = which wins when a lead has >1 reply.
  // not_now + voicemail get their OWN buckets so the kanban can badge them
  // distinctly (boss 2026-06-09), but they still roll into followup/other for
  // the Metrics reply breakdown (see below) so those counts don't shift.
  const rank: Record<string, number> = { positive: 5, question: 4, followup: 3, negative: 2, not_now: 1.8, voicemail: 1.3, other: 1 };
  const bucketOf = (c: string) =>
    (c === "positive" || c === "meeting_intent") ? "positive"
    : (c === "question" || c === "needs_info") ? "question"
    : (c === "follow_up" || c === "nurturing") ? "followup"
    : (c === "not_now") ? "not_now"
    : (c === "voicemail") ? "voicemail"
    : (c === "negative") ? "negative"
    : "other";
  replyRowsRaw.forEach((r: any) => {
      const c = (r.classification ?? "").toLowerCase();
      const bucket = bucketOf(c);
      const prev = replyClass.get(r.lead_id);
      if (!prev || rank[bucket] > rank[prev]) replyClass.set(r.lead_id, bucket);
      const at = r.received_at ?? "";
      const prevText = replyText.get(r.lead_id);
      if (r.reply_text && (!prevText || at > prevText.at)) replyText.set(r.lead_id, { text: r.reply_text, at, channel: r.channel ?? "other" });
      const fr = firstReplyAt.get(r.lead_id);
      if (at && (!fr || at < fr)) firstReplyAt.set(r.lead_id, at);
      if (at) replyDates.push(at);
      const ch = r.channel ?? "other"; (repliesByChannel[ch] ||= new Set()).add(r.lead_id);
      if (bucket === "positive") (positiveByChannel[ch] ||= new Set()).add(r.lead_id);
  });
  const repliedSet = new Set(replyClass.keys());
  const positiveSet = new Set([...replyClass].filter(([, b]) => b === "positive").map(([id]) => id));

  const sent = msgs.filter(m => m.status === "sent");
  const requestsSent = sent.filter(m => m.step_number === 0 && m.channel === "linkedin").length;
  const step0SentLeads = new Set(sent.filter(m => m.step_number === 0 && m.channel === "linkedin").map(m => m.lead_id));
  const accepted = connected.size;
  const totalLeads = leadIds.length;
  const messagedSet = new Set(sent.filter(m => m.step_number > 0).map(m => m.lead_id));
  // Channel-agnostic "contacted" = a lead that received ANY sent message on ANY
  // channel (LinkedIn invite/DM, email, etc.). This is the funnel stage that
  // works for multichannel flows — unlike "accepted" (LinkedIn-only), which
  // made the funnel non-monotonic (email-heavy flows showed Messages 40 >
  // Accepted 5 → "800% of accepted"). Boss 2026-06-11.
  const contactedSet = new Set(sent.map(m => m.lead_id));
  const pendingAcceptSet = new Set([...step0SentLeads].filter(id => !connected.has(id) && !lostSet.has(id)));

  // Per-step breakdown (CR = step 0, then sequence steps).
  const nameOfEarly = (id: string): DrillLead => ({ id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null });
  const withDetail = (id: string, detail: string): DrillLead => ({ ...nameOfEarly(id), detail });
  const isPending = (s: string) => s === "queued" || s === "draft" || s === "dispatching";
  // Per-step reply attribution: each lead's FIRST reply is credited to the
  // highest step_number that lead had SENT at/before the reply timestamp —
  // i.e. the message that earned the response. This is the per-step reply
  // rate competitors (Lemlist/Smartlead) lead with: it shows WHICH step's
  // copy converts, so you know what to rewrite.
  const repliesByStep: Record<number, number> = {};
  for (const [leadId, replyAt] of firstReplyAt) {
    let respStep = -1;
    for (const m of msgs) {
      if (m.lead_id === leadId && m.status === "sent" && m.sent_at && m.sent_at <= replyAt && m.step_number > respStep) respStep = m.step_number;
    }
    if (respStep >= 0) repliesByStep[respStep] = (repliesByStep[respStep] ?? 0) + 1;
  }
  const stepNums = [...(channelsUsed.includes("linkedin") ? [0] : []), ...Array.from({ length: sequence.length }, (_, i) => i + 1)];
  const steps = stepNums.map(n => {
    const at = msgs.filter(m => m.step_number === n);
    const ch = n === 0 ? "linkedin" : (sequence[n - 1]?.channel ?? "linkedin");
    const sentN = at.filter(m => m.status === "sent").length;
    const repliesN = repliesByStep[n] ?? 0;
    return {
      label: n === 0 ? "Invite" : `Step ${n}`, channel: ch,
      replies: repliesN,
      replyRate: sentN > 0 ? Math.min(100, Math.round((repliesN / sentN) * 100)) : 0,
      sent: at.filter(m => m.status === "sent").length,
      failed: at.filter(m => m.status === "failed").length,
      skipped: at.filter(m => m.status === "skipped").length,
      pending: at.filter(m => isPending(m.status)).length,
      leads: {
        // Per-lead detail so the seller can see EXACTLY who got each step,
        // who failed and the literal reason, who was skipped and why.
        sent: at.filter(m => m.status === "sent").map(m => nameOfEarly(m.lead_id)),
        failed: at.filter(m => m.status === "failed").map(m => withDetail(m.lead_id, (m.error_details ?? failCategory(m.error_details)).slice(0, 140))),
        skipped: at.filter(m => m.status === "skipped").map(m => withDetail(m.lead_id, String((m.metadata as any)?.skipped_reason ?? "skipped"))),
        pending: at.filter(m => isPending(m.status)).map(m => withDetail(m.lead_id, m.status)),
      },
    };
  });

  const liDmsSent = sent.filter(m => m.channel === "linkedin" && m.step_number > 0).length;
  const liReplies = repliesByChannel["linkedin"]?.size ?? 0;
  const liPositive = positiveByChannel["linkedin"]?.size ?? 0;
  const linkedin = channelsUsed.includes("linkedin") ? {
    invitesSent: requestsSent, accepted, acceptRate: requestsSent ? Math.round((accepted / requestsSent) * 100) : 0,
    pendingAccept: pendingAcceptSet.size,
    dmsSent: liDmsSent,
    replies: liReplies,
    positive: liPositive,
    replyRate: pctOf(liReplies, liDmsSent),
    positiveReplyRate: pctOf(liPositive, liReplies),
    failed: msgs.filter(m => m.channel === "linkedin" && m.status === "failed").length,
  } : null;
  const emailSent = sent.filter(m => m.channel === "email").length;
  const emReplies = repliesByChannel["email"]?.size ?? 0;
  const emPositive = positiveByChannel["email"]?.size ?? 0;
  const email = channelsUsed.includes("email") ? {
    sent: emailSent, bounced: bouncedSet.size,
    bounceRate: (emailSent + bouncedSet.size) ? Math.round((bouncedSet.size / (emailSent + bouncedSet.size)) * 100) : 0,
    replies: emReplies,
    positive: emPositive,
    replyRate: pctOf(emReplies, emailSent),
    positiveReplyRate: pctOf(emPositive, emReplies),
  } : null;
  const call = channelsUsed.includes("call") ? { dialed: sent.filter(m => m.channel === "call").length } : null;

  // ── Velocity (is it moving?) + cooldown (why isn't it?) ──
  const now = Date.now();
  const dayKey = (iso: string) => { try { return new Date(iso).toISOString().slice(0, 10); } catch { return ""; } };
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const sentToday = sent.filter(m => m.sent_at && dayKey(m.sent_at) === todayKey).length;
  const lastActivityAt = sent.map(m => m.sent_at).filter(Boolean).sort().slice(-1)[0] ?? null;
  const byDay: { date: string; sent: number; replies: number }[] = [];
  for (let d = 13; d >= 0; d--) {
    const key = new Date(now - d * 86400000).toISOString().slice(0, 10);
    byDay.push({
      date: key,
      sent: sent.filter(m => m.sent_at && dayKey(m.sent_at) === key).length,
      replies: replyDates.filter(r => dayKey(r) === key).length,
    });
  }
  const firstSentByLead = new Map<string, string>();
  sent.forEach(m => { if (m.sent_at) { const p = firstSentByLead.get(m.lead_id); if (!p || m.sent_at < p) firstSentByLead.set(m.lead_id, m.sent_at); } });
  const replyGaps: number[] = [];
  firstReplyAt.forEach((rAt, lid) => { const fs = firstSentByLead.get(lid); if (fs) { const g = (new Date(rAt).getTime() - new Date(fs).getTime()) / 86400000; if (g >= 0) replyGaps.push(g); } });
  const avgDaysToReply = replyGaps.length ? Math.round((replyGaps.reduce((a, b) => a + b, 0) / replyGaps.length) * 10) / 10 : null;
  const velocity = { sentToday, dailyLimit: dailyLimit ?? null, lastActivityAt, byDay, avgDaysToReply };

  // Cooldown: newest rate-limit marker on a queued LinkedIn message, still inside
  // the 4h window the dispatcher honours. Surfaces WHY nothing is sending.
  let cooldown: { until: string; channel: string } | null = null;
  const rlTimes = msgs
    .filter(m => m.status === "queued" && m.channel === "linkedin" && (m.metadata as any)?.last_rate_limit_at)
    .map(m => new Date((m.metadata as any).last_rate_limit_at).getTime())
    .filter(t => !isNaN(t));
  if (rlTimes.length) {
    const newest = Math.max(...rlTimes);
    if (now - newest < 4 * 3600 * 1000) cooldown = { until: new Date(newest + 4 * 3600 * 1000).toISOString(), channel: "linkedin" };
  }

  // ── Cold-calling — the REAL calls table (campaign_messages channel=call is
  // only the queued STEP marker). Central rules from flow-metrics-lib so
  // connect-rate / positive / unreachable are defined in ONE place (def #4). ──
  const callRows: CallRow[] = callRowsRaw as CallRow[];
  const realCalls = callRows.filter(isRealCall);
  const connectedCalls = realCalls.filter(isConnected);
  const callLeadSet = new Set(realCalls.map(c => c.lead_id));
  const callGroupCounts: Record<string, number> = { positive: 0, followup: 0, negative: 0, unreachable: 0, other: 0 };
  const callOutcomeCounts: Record<string, number> = {};
  realCalls.forEach(c => {
    callGroupCounts[callOutcomeGroup(c)]++;
    const raw = c.classification ?? "unclassified";
    callOutcomeCounts[raw] = (callOutcomeCounts[raw] ?? 0) + 1;
  });
  // Meetings = unique 'qualified' leads (single source, def #5). Step-3
  // conversion counts only meetings whose lead actually reached the call stage.
  const meetingsFromCalls = [...qualifiedSet].filter(id => callLeadSet.has(id)).length;
  const callStage = channelsUsed.includes("call") ? {
    made: realCalls.length,
    connected: connectedCalls.length,
    connectRate: pctOf(connectedCalls.length, realCalls.length),
    positiveOutcomes: realCalls.filter(isPositiveOutcome).length,
    meetings: meetingsFromCalls,
    meetingConversion: pctOf(meetingsFromCalls, connectedCalls.length),
    groups: callGroupCounts,
    outcomes: callOutcomeCounts,
  } : null;

  // ── Pipeline — where the leads are NOW. Buckets are mutually exclusive and
  // sum to the cohort (def #6). current_step is 0-indexed over `sequence`. ──
  const stageChannel = (step: number | null) =>
    sequence[Math.max(0, Math.min(step ?? 0, sequence.length - 1))]?.channel ?? "linkedin";
  const pipeline = { inLinkedin: 0, inEmail: 0, inCall: 0, repliedExited: 0, completedNoResponse: 0, removed: 0, other: 0 };
  const agingAcc: Record<string, { active: number; stuck: number; sumDays: number; withTs: number }> = {
    linkedin: { active: 0, stuck: 0, sumDays: 0, withTs: 0 },
    email: { active: 0, stuck: 0, sumDays: 0, withTs: 0 },
    call: { active: 0, stuck: 0, sumDays: 0, withTs: 0 },
  };
  const STUCK_DAYS = 3;
  for (const c of campRows) {
    const replied = repliedSet.has(c.lead_id);
    if (c.status === "active" || c.status === "paused") {
      const ch = stageChannel(c.current_step);
      if (ch === "linkedin") pipeline.inLinkedin++;
      else if (ch === "email") pipeline.inEmail++;
      else if (ch === "call") pipeline.inCall++;
      else pipeline.other++;
      const ag = agingAcc[ch] ?? (agingAcc[ch] = { active: 0, stuck: 0, sumDays: 0, withTs: 0 });
      ag.active++;
      if (c.last_step_at) {
        const days = (now - new Date(c.last_step_at).getTime()) / 86400000;
        if (days >= 0) { ag.withTs++; ag.sumDays += days; if (days > STUCK_DAYS) ag.stuck++; }
      }
    } else if (c.status === "completed") {
      if (replied) pipeline.repliedExited++; else pipeline.completedNoResponse++;
    } else if (c.status === "closed_lost") {
      pipeline.repliedExited++;
    } else if (c.status === "cancelled") {
      pipeline.removed++;
    } else {
      pipeline.other++;
    }
  }
  const stageAging = Object.fromEntries(Object.entries(agingAcc).map(([ch, a]) => [ch, {
    active: a.active, stuckOver3d: a.stuck, avgDays: a.withTs ? Math.round((a.sumDays / a.withTs) * 10) / 10 : null, tracked: a.withTs,
  }])) as Record<string, { active: number; stuckOver3d: number; avgDays: number | null; tracked: number }>;

  // ── Seller performance — activity → engagement → outcomes → meetings, with
  // normalized rates so different-volume sellers are comparable (def #5). ──
  const sellerIds = [...new Set(campRows.map(c => c.seller_id).filter(Boolean) as string[])];
  const sellers = sellerIds.map(sid => {
    const leadSet = new Set(campRows.filter(c => c.seller_id === sid).map(c => c.lead_id));
    const inSet = (id: string) => leadSet.has(id);
    const sCalls = realCalls.filter(c => inSet(c.lead_id));
    const contactedN = [...contactedSet].filter(inSet).length;
    const repliesN = [...repliedSet].filter(inSet).length;
    const positiveN = [...positiveSet].filter(inSet).length;
    const meetingsN = [...qualifiedSet].filter(inSet).length;
    return {
      sellerId: sid, name: sellerMap.get(sid) ?? "—",
      leads: leadSet.size, contacted: contactedN,
      linkedinSent: sent.filter(m => m.channel === "linkedin" && inSet(m.lead_id)).length,
      emailsSent: sent.filter(m => m.channel === "email" && inSet(m.lead_id)).length,
      callsMade: sCalls.length, callsConnected: sCalls.filter(isConnected).length,
      replies: repliesN, positiveReplies: positiveN,
      positiveOutcomes: sCalls.filter(isPositiveOutcome).length, meetings: meetingsN,
      connectRate: pctOf(sCalls.filter(isConnected).length, sCalls.length),
      positiveReplyRate: pctOf(positiveN, repliesN),
      meetingsPer100: contactedN > 0 ? Math.round((meetingsN / contactedN) * 1000) / 10 : 0,
      positivePer100: contactedN > 0 ? Math.round((positiveN / contactedN) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.meetings - a.meetings || b.positiveReplies - a.positiveReplies);

  const failedMsgs = msgs.filter(m => m.status === "failed");
  const failCounts: Record<string, number> = {};
  failedMsgs.forEach(m => { const c = failCategory(m.error_details); failCounts[c] = (failCounts[c] ?? 0) + 1; });
  const failureReasons = Object.entries(failCounts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  const statusDist = { active: 0, paused: 0, completed: 0, cancelled: 0 };
  campRows.forEach(c => { if (c.status in statusDist) (statusDist as any)[c.status]++; });

  const nameOf = (id: string): DrillLead => ({ id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null });

  // Per-lead activity table — one row per lead, sorted by most-recent activity.
  const byLead: Record<string, Msg[]> = {};
  msgs.forEach(m => { (byLead[m.lead_id] ||= []).push(m); });
  const campMeta = new Map(campRows.map(c => [c.lead_id, c]));
  const leadsActivity = leadIds.map(id => {
    const lm = byLead[id] ?? [];
    const sentMsgs = lm.filter(x => x.status === "sent");
    const lastActivity = sentMsgs.map(x => x.sent_at).filter(Boolean).sort().slice(-1)[0] ?? null;
    const meta = campMeta.get(id);
    return {
      id, name: leadInfo.get(id)?.name ?? "Unknown", company: leadInfo.get(id)?.company ?? null,
      channels: [...new Set(lm.map(x => x.channel))],
      inviteSent: sentMsgs.some(x => x.step_number === 0 && x.channel === "linkedin"),
      accepted: connected.has(id),
      messaged: sentMsgs.filter(x => x.step_number > 0).length,
      replied: replyClass.get(id) ?? null,
      replyText: replyText.get(id)?.text ?? null,
      bounced: bouncedSet.has(id),
      status: meta?.status ?? "—",
      currentStep: meta?.current_step ?? null,
      daysInFlow: meta?.started_at ? Math.max(0, Math.round((now - new Date(meta.started_at).getTime()) / 86400000)) : null,
      lastActivity,
    };
  }).sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));

  // Clamp every rate to 100% — a denominator/numerator mismatch (stale data,
  // dedup edge) must never render a >100% funnel ("800% of accepted").
  const pct = (num: number, den: number) => den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0;
  return {
    leadsActivity, velocity, cooldown,
    totalLeads, invitesSent: requestsSent, accepted, messaged: messagedSet.size, replied: repliedSet.size, positive: positiveSet.size,
    // Channel-agnostic funnel: Leads → Contacted → Replied → Positive.
    contacted: contactedSet.size,
    contactedRate: pct(contactedSet.size, totalLeads),
    contactedReplyRate: pct(repliedSet.size, contactedSet.size),
    acceptRate: pct(accepted, requestsSent),
    messagedRate: pct(messagedSet.size, accepted),
    replyRate: pct(repliedSet.size, messagedSet.size),
    positiveRate: pct(positiveSet.size, repliedSet.size),
    progressPct, pendingAccept: pendingAcceptSet.size, lost: lostSet.size,
    // ── Flow Metrics redesign (2026-08-27) — unique-lead outcome metrics,
    // call stage from the real calls table, pipeline distribution, sellers. ──
    meetings: qualifiedSet.size,
    meetingRate: pct(qualifiedSet.size, totalLeads),
    positiveLeadRate: pct(positiveSet.size, totalLeads),
    callStage, pipeline, stageAging, sellers,
    positivesByChannel: { linkedin: liPositive, email: emPositive },
    health: {
      bounceRate: healthOf("bounceRate", email?.bounceRate ?? 0),
      connectRate: callStage ? healthOf("connectRate", callStage.connectRate) : "healthy",
      meetingConversion: callStage ? healthOf("meetingConversion", callStage.meetingConversion) : "healthy",
      positiveReplyRate: healthOf("positiveReplyRate", pct(positiveSet.size, repliedSet.size)),
    },
    statusDist, steps, linkedin, email, call, failureReasons,
    replyBreakdown: {
      positive: [...replyClass.values()].filter(b => b === "positive").length,
      negative: [...replyClass.values()].filter(b => b === "negative").length,
      question: [...replyClass.values()].filter(b => b === "question").length,
      followup: [...replyClass.values()].filter(b => b === "followup" || b === "not_now").length,
      other: [...replyClass.values()].filter(b => b === "other" || b === "voicemail").length,
    },
    drill: {
      contacted: [...contactedSet].map(nameOf),
      accepted: [...connected].map(nameOf),
      messaged: [...messagedSet].map(nameOf),
      pendingAccept: [...pendingAcceptSet].map(nameOf),
      replied: [...replyClass].map(([id, b]) => ({ ...nameOf(id), detail: b })),
      positive: [...positiveSet].map(nameOf),
      bounced: [...bouncedSet].map(id => ({ ...nameOf(id), detail: "bounced" })),
      failed: failedMsgs.map(m => ({ ...nameOf(m.lead_id), detail: `${m.step_number === 0 ? "invite" : "step " + m.step_number} · ${failCategory(m.error_details)}` })),
    },
  };
}

// ── Filters ────────────────────────────────────────────────────────────────
export function parseFilters(get: (k: string) => string | null): MetricsFilters {
  const sellerFilter = get("seller") || null;
  const range = get("range") || "all";
  const now = Date.now();
  const days = range === "7d" ? 7 : range === "4w" ? 28 : range === "90d" ? 90 : null;
  let winFrom: number | null = null; let winTo = now;
  if (days) winFrom = now - days * 86400000;
  else if (range === "custom") { const f = get("from"); const t = get("to"); if (f) { winFrom = new Date(f).getTime(); winTo = t ? new Date(t).getTime() : now; } }
  return { sellerFilter, range, winFrom, winTo };
}

// Cohort = leads enrolled in the window (started_at), optionally one seller.
// ONE cohort → every section counts the same leads (see POLICY in page.tsx).
export function cohortFilter(campRows: CampRow[], sellerFilter: string | null, winFrom: number | null, winTo: number): CampRow[] {
  const inWin = (r: CampRow) => {
    if (winFrom == null) return true;
    const t = r.started_at ? new Date(r.started_at).getTime() : null;
    return t != null && t >= winFrom && t <= winTo;
  };
  return campRows.filter(r => (!sellerFilter || r.seller_id === sellerFilter) && inWin(r));
}

// Period-over-period deltas (volume → %, rates → pp). null when no prev cohort.
export function computeDeltas(cur: FlowMetrics, prev: FlowMetrics | null): FlowMetrics["deltas"] {
  if (!prev) return null;
  const ppp = (a: number, b: number) => Math.round((a - b) * 10) / 10;
  const grow = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  return {
    meetings: { curr: cur.meetings, prev: prev.meetings, pct: grow(cur.meetings, prev.meetings) },
    positive: { curr: cur.positive, prev: prev.positive, pct: grow(cur.positive, prev.positive) },
    positiveReplyRate: { curr: cur.positiveRate, prev: prev.positiveRate, pp: ppp(cur.positiveRate, prev.positiveRate) },
    connectRate: { curr: cur.callStage?.connectRate ?? 0, prev: prev.callStage?.connectRate ?? 0, pp: ppp(cur.callStage?.connectRate ?? 0, prev.callStage?.connectRate ?? 0) },
    replyRate: { curr: cur.contactedReplyRate, prev: prev.contactedReplyRate, pp: ppp(cur.contactedReplyRate, prev.contactedReplyRate) },
  };
}

// ── Decrypt-free flow resolution for the API route ──────────────────────────
// Resolves the flow (siblings by name) WITHOUT the leads join / hydrate
// (decrypt) — the metric numbers need only lead_ids. Lead names for drills come
// from the plaintext columns (encrypted client leads fall back to company/Lead),
// so no per-lead decrypt. Then applies the cohort filter + prev period.
export async function resolveFlowMetricsLite(campaignId: string, filters: MetricsFilters): Promise<{ metrics: FlowMetrics | null; sellers: { id: string; name: string }[] } | null> {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sbKey = process.env.SUPABASE_SERVICE_KEY!;
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const rest = async (path: string): Promise<any[]> => {
    try { const r = await fetch(`${sbUrl}/rest/v1/${path}`, { headers, cache: "no-store" }); return r.ok ? await r.json() : []; } catch { return []; }
  };
  const campArr = await rest(`campaigns?id=eq.${campaignId}&select=name,sequence_steps,current_step,seller_id,sellers(linkedin_daily_limit)`);
  const camp = campArr[0];
  if (!camp) return null;
  const flowName: string = camp.name;
  const seq = (Array.isArray(camp.sequence_steps) ? camp.sequence_steps : [])
    .filter((x: any) => x && x.channel)
    .map((x: any) => ({ channel: x.channel as string, daysAfter: (x.daysAfter ?? 0) as number }));

  // Siblings by name — NO leads join, NO decrypt. Paginated (PostgREST caps at
  // 1000/page — the recurring footgun; page with ORDER BY).
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`campaigns?name=eq.${encodeURIComponent(flowName)}&select=id,lead_id,status,current_step,started_at,last_step_at,seller_id,sellers(name)&order=created_at.asc&limit=1000&offset=${from}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const campRows: CampRow[] = rows.filter(r => r.lead_id).map(r => ({
    lead_id: r.lead_id, status: r.status, current_step: r.current_step ?? null,
    started_at: r.started_at ?? null, seller_id: r.seller_id ?? null, last_step_at: r.last_step_at ?? null,
  }));
  const sellerMap = new Map<string, string>();
  rows.forEach(r => { if (r.seller_id && r.sellers?.name && !sellerMap.has(r.seller_id)) sellerMap.set(r.seller_id, r.sellers.name); });
  const allCampaignIds: string[] = rows.map(r => r.id);
  const flowLeadIds = [...new Set(campRows.map(r => r.lead_id))];
  const channels = [...new Set(seq.map((x: { channel: string }) => x.channel))];

  // Lead names — plaintext columns only, chunked, NO decrypt.
  const leadInfo = new Map<string, { name: string; company: string | null }>();
  const leadChunks: string[][] = [];
  for (let i = 0; i < flowLeadIds.length; i += 200) leadChunks.push(flowLeadIds.slice(i, i + 200));
  const leadInfoPages = await Promise.all(leadChunks.map(c =>
    rest(`leads?id=in.${encodeURIComponent(`(${c.join(",")})`)}&select=id,primary_first_name,primary_last_name,company_name`)));
  leadInfoPages.flat().forEach((l: any) => leadInfo.set(l.id, {
    name: `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || l.company_name || "Lead",
    company: l.company_name ?? null,
  }));
  const sellerDailyLimit = (camp.sellers?.linkedin_daily_limit ?? null) as number | null;

  const { sellerFilter, winFrom, winTo } = filters;
  const cohortRows = cohortFilter(campRows, sellerFilter, winFrom, winTo);
  const metrics = await getFlowMetrics(allCampaignIds, cohortRows.map(r => r.lead_id), seq, leadInfo, channels, 0, cohortRows, sellerDailyLimit, sellerMap);
  if (metrics && winFrom != null) {
    const len = winTo - winFrom;
    const prevRows = cohortFilter(campRows, sellerFilter, winFrom - len, winFrom);
    const prev = prevRows.length
      ? await getFlowMetrics(allCampaignIds, prevRows.map(r => r.lead_id), seq, leadInfo, channels, 0, prevRows, sellerDailyLimit, sellerMap)
      : null;
    metrics.deltas = computeDeltas(metrics, prev);
  }
  const sellers = [...sellerMap].map(([id, name]) => ({ id, name }));
  return { metrics, sellers };
}
