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
    .select("id, name, channel, current_step, sequence_steps, last_step_at, lead_id, seller_id, aircall_number_id, call_advance_mode, leads!inner(id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, primary_title_role, primary_phone, primary_secondary_phone, primary_work_email, company_bio_id, call_talking_points), sellers(name)")
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
    .select("id, classification, received_at, channel, reply_text, lead_id, campaign_id, requires_human_review, leads!inner(id, source, encrypted_payload, primary_first_name, primary_last_name, company_name, company_bio_id, icp_profile_id), campaigns!inner(name, seller_id)")
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

  // (Pending Reviews + Updates tabs were removed from /queue per boss
  // feedback 2026-05-27 — Pending Reviews deleted entirely, Updates moved
  // to Lead Miner. Their data fetches were dropped here too.)
  const [
    { data: rawActiveCampaigns },
    { data: rawRecentReplies },
    { data: rawRecentAccepts },
  ] = await Promise.all([campQuery, replyQuery, acceptQuery]);

  // Decrypt client-source leads nested inside the three join queries so
  // sellers see real names instead of "Unknown" for tenants with encrypted
  // PII (eg De Vera Grill). Done as a single batch per query — hydration
  // resolves the tenant key once and reuses it across rows.
  const [activeCampaigns, recentReplies, recentAccepts] = await Promise.all([
    hydrateNestedLeads((rawActiveCampaigns ?? []) as any[]),
    hydrateNestedLeads((rawRecentReplies ?? []) as any[]),
    hydrateNestedLeads((rawRecentAccepts ?? []) as any[]),
  ]);

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
  if (candidateLeadIds.length > 0) {
    const { data: callRows } = await supabase
      .from("calls")
      .select("id, lead_id, started_at, classification, created_at")
      .in("lead_id", candidateLeadIds)
      .order("created_at", { ascending: false });
    for (const cr of callRows ?? []) {
      const lid = (cr as any).lead_id as string | null;
      if (!lid) continue;
      // First entry wins because we ordered by created_at desc.
      if (!latestCallByLead.has(lid)) {
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
  ].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  return { pendingCalls, newReplies };
}

export default async function QueuePage() {
  const data = await getQueueData();
  return <QueueClient {...JSON.parse(JSON.stringify(data))} />;
}
