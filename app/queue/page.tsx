import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, getMyAssignedSellerIds } from "@/lib/scope";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import QueueClient from "./QueueClient";

// Decrypts client-source `leads` objects nested inside join responses (eg
// campaigns!inner(...), lead_replies leads!inner(...)). The PostgREST select
// must include `id, source, encrypted_payload, company_bio_id` on the nested
// leads object for this to work — without those columns there's nothing to
// decrypt and the lead stays redacted.
async function hydrateNestedLeads<T extends { leads?: any }>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const nested = rows.map(r => r.leads).filter(Boolean) as Record<string, unknown>[];
  if (nested.length === 0) return rows;
  const hydrated = await hydrateClientLeads(nested);
  const byId = new Map(hydrated.map(l => [(l as any).id as string, l]));
  return rows.map(r => (r.leads ? { ...r, leads: byId.get((r.leads as any).id) ?? r.leads } : r));
}

export const dynamic = "force-dynamic";

async function getQueueData() {
  const supabase = await getSupabaseServer();

  // Resolve user scope via the central helper. Trust scope.isScoped — it
  // already encodes the rule that super_admins on operational pages
  // (Queue/Leads/Campaigns/Opportunities) are scoped to their OWN bio,
  // not given a cross-tenant firehose. Previously this file re-derived
  // isScoped as `tier !== 'super_admin' && companyBioId`, which inverted
  // that intent and let a super_admin signed into SWL see Pathway's
  // pending calls + replies (cross-tenant data leak, 2026-05-14).
  // The cross-tenant SWL view lives in /admin and /admin/[id], not here.
  const scope = await getUserScope();
  const scopedCompanyBioId = scope.isScoped ? scope.companyBioId : null;

  // For tier='seller', restrict campaigns/leads to those whose seller_id is
  // in the user's linked sellers. null → no extra filter.
  const sellerIds = await getMyAssignedSellerIds();

  // ICP profile IDs owned by this company (for request filtering)
  let scopedProfileIds: string[] | null = null;
  if (scopedCompanyBioId) {
    const svc = getSupabaseService();
    const { data: ps } = await svc.from("icp_profiles").select("id").eq("company_bio_id", scopedCompanyBioId);
    scopedProfileIds = (ps ?? []).map(p => p.id);
  }

  // Campaigns
  let campQuery = supabase.from("campaigns")
    .select("id, name, channel, current_step, sequence_steps, last_step_at, lead_id, seller_id, aircall_number_id, call_advance_mode, leads!inner(id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, primary_title_role, primary_phone, primary_secondary_phone, primary_work_email, company_bio_id, call_talking_points, allow_call), sellers(name)")
    .eq("status", "active")
    .order("last_step_at", { ascending: true })
    .limit(200);
  if (scopedCompanyBioId) campQuery = campQuery.eq("leads.company_bio_id", scopedCompanyBioId);
  // Seller-tier filter on campaigns. Empty array → match nothing. The
  // sentinel UUID is a no-op match used because PostgREST .in([]) is
  // disallowed; this guarantees zero rows for unlinked sellers.
  if (sellerIds !== null) {
    campQuery = campQuery.in("seller_id", sellerIds.length > 0 ? sellerIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  // Replies — exclude 'auto_reply' (OOO messages handled by the auto-reply
  // pipeline). NOTE: the enum value is `auto_reply` with an underscore.
  // Using `autoreply` here returned a 400 from PostgREST silently — page-level
  // destructure produced { data: null } and the Inbox tab rendered empty
  // (incident: De Vera Grill positive replies invisible 2026-05-24).
  let replyQuery = supabase.from("lead_replies")
    .select("id, classification, received_at, channel, reply_text, lead_id, campaign_id, requires_human_review, review_status, leads!inner(id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, company_bio_id, icp_profile_id), campaigns!inner(name, seller_id)")
    .neq("classification", "auto_reply")
    .order("received_at", { ascending: false })
    .limit(30);
  if (scopedCompanyBioId) replyQuery = replyQuery.eq("leads.company_bio_id", scopedCompanyBioId);
  if (sellerIds !== null) {
    replyQuery = replyQuery.in("campaigns.seller_id", sellerIds.length > 0 ? sellerIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  // LinkedIn connection accepts. We surface accepts as a Reply-like signal:
  // the lead engaged with our outreach, even though they did not text back.
  //
  // Source switched 2026-05-28: previously we filtered `campaign_messages`
  // step_number=1 by `metadata.queued_by IN (webhook markers)`. That missed
  // every lead whose accept arrived AFTER the dispatcher had already sent
  // step 1 (cron beat the webhook), because the marker can't land on a row
  // already in `sent`. SWL PE Spain alone had 9 acceptances vanish that way.
  // Now we read from `leads.linkedin_connected=true` directly — single
  // source of truth, no race condition with the dispatcher.
  let acceptQuery = supabase.from("leads")
    .select("id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, company_bio_id, icp_profile_id, current_channel, created_at")
    .eq("linkedin_connected", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (scopedCompanyBioId) acceptQuery = acceptQuery.eq("company_bio_id", scopedCompanyBioId);

  // Email issues — leads flagged 'invalid' or 'bounced' surface here so the
  // seller sees them in History and can decide what to do (mark lost with a
  // reason, pivot to another contact at the company, etc.). 'invalid' comes
  // from the Instantly /email-verification pre-flight (see the Arqy 2026-05-29
  // pass); 'bounced' comes from the Instantly webhook on `email_bounced`.
  // Both are silent today — without surfacing them, sellers don't know the
  // email track quietly died on a lead.
  let emailIssuesQuery = supabase.from("leads")
    .select("id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, company_bio_id, icp_profile_id, primary_email_status, primary_work_email, updated_at")
    .in("primary_email_status", ["invalid", "bounced"])
    .order("updated_at", { ascending: false })
    .limit(50);
  if (scopedCompanyBioId) emailIssuesQuery = emailIssuesQuery.eq("company_bio_id", scopedCompanyBioId);

  // Call History — every classified call (Interested / Not interested / Bad
  // timing / Wrong number) so the team can review what was actually dialed,
  // filter by date, and replay recordings. Tenant-scoped via leads join; not
  // seller-filtered on purpose — managers want the whole team's call log.
  // NOTE: no `sellers(name)` embed — the calls table has NO foreign-key
  // relationship to sellers in the schema, so embedding it 400s the whole
  // query and History silently renders 0 calls (caught 2026-06-04). seller_id
  // is resolved to a name in a separate lookup below.
  let callHistoryQuery = supabase.from("calls")
    .select("id, lead_id, seller_id, classification, status, duration, started_at, recording_url, transcript, notes, aircall_call_id, leads!inner(id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, company_bio_id)")
    .in("classification", ["positive", "negative", "follow_up", "wrong_number"])
    .order("started_at", { ascending: false })
    .limit(500);
  if (scopedCompanyBioId) callHistoryQuery = callHistoryQuery.eq("leads.company_bio_id", scopedCompanyBioId);

  // (Pending Reviews + Updates tabs were removed from /queue per boss
  // feedback 2026-05-27 — Pending Reviews deleted entirely, Updates moved
  // to Lead Miner. Their data fetches were dropped here too.)
  const [
    { data: rawActiveCampaigns },
    { data: rawRecentReplies },
    { data: rawRecentAccepts },
    { data: rawEmailIssues },
    { data: rawCallHistory },
  ] = await Promise.all([campQuery, replyQuery, acceptQuery, emailIssuesQuery, callHistoryQuery]);

  // Decrypt client-source leads nested inside the three join queries so
  // sellers see real names instead of "Unknown" for tenants with encrypted
  // PII (eg De Vera Grill). Done as a single batch per query — hydration
  // resolves the tenant key once and reuses it across rows.
  const [activeCampaigns, recentReplies, recentAccepts, emailIssues] = await Promise.all([
    hydrateNestedLeads((rawActiveCampaigns ?? []) as any[]),
    hydrateNestedLeads((rawRecentReplies ?? []) as any[]),
    // rawRecentAccepts comes from `supabase.from("leads")` directly — flat rows,
    // no `.leads` sub-object — so use the flat hydrator. Passing it through
    // hydrateNestedLeads (which looks for r.leads) leaves PII columns null and
    // every "Aceptó la solicitud" entry renders as "Unknown".
    hydrateClientLeads((rawRecentAccepts ?? []) as any[]),
    // Same flat-row shape as accepts.
    hydrateClientLeads((rawEmailIssues ?? []) as any[]),
  ]);

  const callHistoryRows = await hydrateNestedLeads((rawCallHistory ?? []) as any[]);
  // Resolve seller names separately (no calls→sellers FK to embed).
  const histSellerIds = [...new Set(callHistoryRows.map((c: any) => c.seller_id).filter(Boolean))] as string[];
  const sellerNameById: Record<string, string> = {};
  if (histSellerIds.length > 0) {
    const { data: sellerRows } = await supabase.from("sellers").select("id, name").in("id", histSellerIds);
    for (const s of sellerRows ?? []) sellerNameById[(s as any).id] = (s as any).name;
  }
  const callHistory = callHistoryRows.map((c: any) => {
    const lead = c.leads;
    const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
    // Mirror CallCard's recording heuristic: a real recording_url, OR an
    // answered call with duration that Aircall will have a recording for
    // (the /play endpoint lazily archives it on first access).
    const hasRecording = !!c.recording_url
      || (c.status === "answered" && (c.duration ?? 0) > 0 && !!c.aircall_call_id);
    return {
      id: c.id as string,
      leadId: (lead?.id ?? c.lead_id ?? null) as string | null,
      leadName,
      company: (lead?.company_name ?? null) as string | null,
      classification: (c.classification ?? null) as string | null,
      status: (c.status ?? null) as string | null,
      durationSec: (c.duration ?? null) as number | null,
      startedAt: (c.started_at ?? null) as string | null,
      sellerName: (c.seller_id ? (sellerNameById[c.seller_id] ?? null) : null) as string | null,
      hasRecording,
      transcript: (c.transcript ?? null) as string | null,
      notes: (c.notes ?? null) as string | null,
      aircallCallId: (c.aircall_call_id ?? null) as number | string | null,
    };
  });

  // Pending Calls — also enrich with the LATEST call per lead so the UI can
  // show inline classification (Positive/Negative/Follow-up) right in the
  // queue instead of forcing the seller into the lead detail. Without this
  // step, sellers call but never classify, and the entry sits in /queue
  // forever even though the call already happened (incident 2026-05-14:
  // Graeme had 36 stuck entries because no classification loop closed them).
  const now = Date.now();
  const pendingCallCandidates: any[] = [];
  const candidateLeadIds: string[] = [];
  for (const c of activeCampaigns ?? []) {
    const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
    const currentStepIdx = c.current_step ?? 0;
    if (steps[currentStepIdx]?.channel === "call") {
      pendingCallCandidates.push({ c, currentStepIdx, steps });
      if (c.lead_id) candidateLeadIds.push(c.lead_id as string);
    }
  }

  // Fetch latest call per lead in one round-trip. The dispatcher uses
  // service-role internally; here we use the user-scoped client so RLS still
  // applies (defense in depth in case scope was bypassed upstream).
  let latestCallByLead = new Map<string, { id: string; started_at: string | null; classification: string | null }>();
  // Leads whose phone was genuinely marked wrong (a call outcome === 'wrong_number').
  // This — NOT allow_call=false — is what drives the "Wrong number" badge.
  // allow_call can be false simply because the call channel was off at import,
  // which is not a wrong number and must not show the alarm badge.
  const wrongNumberLeadIds = new Set<string>();
  if (candidateLeadIds.length > 0) {
    const { data: callRows } = await supabase
      .from("calls")
      .select("id, lead_id, started_at, classification, aircall_call_id, created_at")
      .in("lead_id", candidateLeadIds)
      .order("created_at", { ascending: false });
    for (const cr of callRows ?? []) {
      const lid = (cr as any).lead_id as string | null;
      if (!lid) continue;
      if ((cr as any).classification === "wrong_number") wrongNumberLeadIds.add(lid);
      // Only a call Aircall actually PLACED counts toward "Awaiting Outcome".
      // Clicking Call writes a dial-marker row (status=initiated,
      // aircall_call_id=null) BEFORE the embed dialer opens — for the
      // shared-seat busy banner. If the seller opens the dialer but never
      // presses the green dial, NO Aircall call is created and
      // aircall_call_id stays null forever. Those phantom markers were
      // dragging leads into "Awaiting Outcome" even though no call was made
      // (boss flagged 2026-06-04). A genuinely-dialed call gets its
      // aircall_call_id from the webhook within seconds, so requiring it (or
      // an already-logged classification) keeps un-dialed leads in "To Call".
      const isRealCall = (cr as any).aircall_call_id != null || (cr as any).classification != null;
      // First REAL entry wins because we ordered by created_at desc.
      if (isRealCall && !latestCallByLead.has(lid)) {
        latestCallByLead.set(lid, {
          id: (cr as any).id,
          started_at: (cr as any).started_at,
          classification: (cr as any).classification,
        });
      }
    }
  }

  const pendingCalls: any[] = [];
  for (const { c, currentStepIdx, steps } of pendingCallCandidates) {
    const lead = c.leads as any;
    // Skip call tasks that aren't actionable: the call channel is off for this
    // lead (allow_call=false — wrong-number outcome OR call disabled), or there's
    // no phone on file at all. Either way the seller can't / shouldn't dial, so
    // the call step doesn't belong in "To Call".
    const hasPhone = !!(lead?.primary_phone || lead?.primary_secondary_phone);
    if (lead?.allow_call === false || !hasPhone) continue;
    const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
    const daysAfter = steps[currentStepIdx]?.daysAfter ?? 0;
    // Working-days math: dueAt counts calendar days as before, but if the
    // resulting due-date lands on a Saturday or Sunday we push it forward
    // to the next Monday. Sellers don't want "due today" calls surfaced on
    // weekends — boss flagged this on 2026-05-27.
    const rollWeekendForward = (ts: number) => {
      const d = new Date(ts);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      return d.getTime();
    };
    const rawDueAt = c.last_step_at ? new Date(c.last_step_at).getTime() + daysAfter * 86400000 : null;
    const dueAt = rawDueAt !== null ? rollWeekendForward(rawDueAt) : null;
    // Also gate on the viewing day: if today is Sat/Sun, no call should be
    // "due today" — push the check to Monday's start.
    const todayDow = new Date(now).getDay();
    const isTodayWeekend = todayDow === 0 || todayDow === 6;
    // Only show calls that are actually due (and not on a weekend).
    const isDue = isTodayWeekend ? false : (dueAt !== null ? now >= dueAt : daysAfter === 0);
    if (!isDue) continue;
    const isOverdue = dueAt !== null && now > dueAt;
    const overdueDays = isOverdue && dueAt ? Math.floor((now - dueAt) / 86400000) : 0;
    const latestCall = c.lead_id ? latestCallByLead.get(c.lead_id as string) ?? null : null;

    pendingCalls.push({
      id: c.id,
      campaignId: c.id,
      campaignName: c.name,
      currentStep: currentStepIdx,
      totalSteps: steps.length,
      leadId: c.lead_id,
      leadName,
      company: lead?.company_name ?? null,
      role: lead?.primary_title_role ?? null,
      phone: lead?.primary_phone ?? null,
      secondaryPhone: lead?.primary_secondary_phone ?? null,
      // Surface the lead's allow_call so the QueueClient card can render
      // the Wrong-number badge inline. false = the post-call outcome
      // popup flagged the number; the badge click-throughs to the lead
      // detail where it can be replaced.
      allowCall: (lead as any)?.allow_call ?? null,
      phoneMarkedWrong: c.lead_id ? wrongNumberLeadIds.has(c.lead_id as string) : false,
      email: lead?.primary_work_email ?? null,
      sellerName: (c as any)?.sellers?.name ?? null,
      talkingPoints: (lead as any)?.call_talking_points ?? null,
      callAdvanceMode: ((c as any)?.call_advance_mode as "auto" | "manual" | undefined) ?? "auto",
      lastStepAt: c.last_step_at,
      isOverdue,
      overdueDays,
      aircallNumberId: (c as any).aircall_number_id ?? null,
      latestCall: latestCall
        ? {
            id: latestCall.id,
            startedAt: latestCall.started_at,
            classification: latestCall.classification as "positive" | "negative" | "follow_up" | null,
          }
        : null,
    });
  }

  // New Replies — merge spontaneous replies AND LinkedIn connection accepts.
  // Accepts use classification='connection_accepted' so QueueClient can label
  // them ("Accepted") without a reply_text body. They sort by accepted_at so
  // the newest engagement floats to the top regardless of whether it was a
  // text reply or just an accept.

  // Derive a plausible "accepted_at" per accepted lead: take the latest sent
  // step-0 timestamp on their campaigns (the invite went out, the accept
  // happened soon after). Also grab the campaign name for display.
  const acceptedLeadIds = (recentAccepts ?? []).map((l: any) => l.id);
  const acceptMetaByLead: Record<string, { sent_at: string; campaign_name: string | null }> = {};
  if (acceptedLeadIds.length > 0) {
    const { data: step0Rows } = await supabase
      .from("campaign_messages")
      .select("lead_id, sent_at, campaigns(name)")
      .in("lead_id", acceptedLeadIds)
      .eq("step_number", 0)
      .eq("status", "sent")
      .order("sent_at", { ascending: false });
    for (const row of (step0Rows ?? []) as any[]) {
      if (!acceptMetaByLead[row.lead_id]) {
        acceptMetaByLead[row.lead_id] = {
          sent_at: row.sent_at,
          campaign_name: (row.campaigns as any)?.name ?? null,
        };
      }
    }
  }

  // Resolve ICP names per lead so the History tab can filter by ICP.
  const icpIds = new Set<string>();
  for (const r of (recentReplies ?? []) as any[]) {
    const id = r.leads?.icp_profile_id; if (id) icpIds.add(id);
  }
  for (const a of (recentAccepts ?? []) as any[]) {
    const id = a.icp_profile_id; if (id) icpIds.add(id);
  }
  for (const e of (emailIssues ?? []) as any[]) {
    const id = e.icp_profile_id; if (id) icpIds.add(id);
  }
  const icpNameById: Record<string, string> = {};
  if (icpIds.size > 0) {
    const { data: icps } = await supabase.from("icp_profiles")
      .select("id, profile_name")
      .in("id", [...icpIds]);
    for (const i of icps ?? []) icpNameById[(i as any).id] = (i as any).profile_name;
  }

  const newReplies = [
    ...(recentReplies ?? []).map((r: any) => {
      const lead = r.leads;
      const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown" : "Unknown";
      return {
        id: r.id,
        leadId: r.lead_id,
        leadName,
        company: lead?.company_name ?? null,
        channel: r.channel ?? "unknown",
        classification: r.classification,
        replyText: r.reply_text,
        receivedAt: r.received_at,
        campaignName: (r.campaigns as any)?.name ?? null,
        icpProfileName: lead?.icp_profile_id ? (icpNameById[lead.icp_profile_id] ?? null) : null,
        requiresHumanReview: r.requires_human_review ?? false,
        reviewStatus: (r.review_status as string | null) ?? null,
      };
    }),
    ...(recentAccepts ?? []).map((lead: any) => {
      const leadName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
      const meta = acceptMetaByLead[lead.id];
      // accepted_at proxy: 4h after the invite send is the median for warm
      // accounts. Better than `created_at` (which is when the lead was
      // imported, often weeks before). Falls back to the lead created_at
      // only if we never sent a step-0 (shouldn't happen for accepted).
      const acceptedAt = meta?.sent_at
        ? new Date(new Date(meta.sent_at).getTime() + 4 * 3600 * 1000).toISOString()
        : (lead.created_at ?? new Date().toISOString());
      return {
        id: `accept-${lead.id}`,
        leadId: lead.id,
        leadName,
        company: lead.company_name ?? null,
        channel: "linkedin",
        classification: "connection_accepted",
        replyText: null,
        receivedAt: acceptedAt,
        campaignName: meta?.campaign_name ?? null,
        icpProfileName: lead.icp_profile_id ? (icpNameById[lead.icp_profile_id] ?? null) : null,
        requiresHumanReview: false,
      };
    }),
    // Email issues — invalid (caught by pre-flight verifier) and bounced
    // (caught by Instantly webhook). receivedAt = updated_at, which is when
    // the status flipped — the same UX expectation as accepts (newest
    // engagement signal at top).
    ...(emailIssues ?? []).map((lead: any) => {
      const leadName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
      const isBounced = lead.primary_email_status === "bounced";
      return {
        id: `email-issue-${lead.id}`,
        leadId: lead.id,
        leadName,
        company: lead.company_name ?? null,
        channel: "email",
        classification: isBounced ? "email_bounced" : "email_invalid",
        replyText: lead.primary_work_email
          ? `Address: ${lead.primary_work_email}`
          : null,
        receivedAt: lead.updated_at ?? new Date().toISOString(),
        campaignName: null,
        icpProfileName: lead.icp_profile_id ? (icpNameById[lead.icp_profile_id] ?? null) : null,
        requiresHumanReview: false,
      };
    }),
  ].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  return { pendingCalls, newReplies, callHistory };
}

export default async function QueuePage() {
  const data = await getQueueData();
  return <QueueClient {...JSON.parse(JSON.stringify(data))} />;
}
