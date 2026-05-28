import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope, getMyAssignedSellerIds, canEditTenantSettings } from "@/lib/scope";
import {
  resolveTenantKey,
  decryptWithResolvedKey,
  bufferFromSupabaseBytea,
  ENCRYPTED_LEAD_COLUMNS,
} from "@/lib/leads-crypto";
import { C } from "@/lib/design";
import { Users, Upload } from "lucide-react";
import Link from "next/link";
import LeadsCampaignsClient from "@/components/LeadsCampaignsClient";
import PageHero from "@/components/PageHero";
import ExportLeadsCSVButton from "@/components/ExportLeadsCSVButton";

// Tenant-scoped + auth-gated → never static. Skip the optimization attempt.
export const dynamic = "force-dynamic";

async function getData() {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  // Seller-tier users only see leads where leads.seller_id IN (their linked
  // seller IDs). For other tiers this is null = no extra filter.
  const sellerIds = await getMyAssignedSellerIds();

  // Round 1 — profiles + leads run in parallel (both only depend on bioId).
  // Previously these were two sequential awaits, doubling the wall-clock cost.
  const profilesQ = supabase
    .from("icp_profiles")
    .select("id, profile_name, target_industries, target_roles, status")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  let leadsQ = supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, is_priority, current_channel, icp_profile_id, created_at, source, encrypted_payload, company_bio_id, transferred_to_odoo_at")
    .order("created_at", { ascending: false });
  // No cap (2026-05-28 r6). The client-side filters need every lead in
  // memory to work — paginating would break multi-select facet behaviour
  // ("Select all 627" must mean 627). PostgREST applies a default 1000-row
  // limit; we bypass it explicitly so larger tenants still get everyone.
  // If a tenant ever crosses ~10k leads the right next step is moving the
  // facets to the server, not re-capping here.
  leadsQ = leadsQ.range(0, 99999);
  // Companion count() to compute the true tenant-wide total. Head-only request
  // (no rows downloaded) so this is essentially free vs the data fetch above.
  // We use it client-side to surface a "Showing 500 of N" banner when the cap
  // truncates the visible list — sellers used to silently lose ~hundreds of
  // leads with no UI signal.
  let leadsCountQ = supabase
    .from("leads")
    .select("id", { count: "exact", head: true });
  // Seller-tier filter: only leads where seller_id ∈ their linked sellers.
  // Empty array (sellerIds.length=0) → in([]) returns no rows, which is the
  // intended behavior — a seller with no link sees nothing until they're
  // linked to a seller record.
  if (sellerIds !== null) {
    const ids = sellerIds.length > 0 ? sellerIds : ["00000000-0000-0000-0000-000000000000"];
    leadsQ = leadsQ.in("seller_id", ids);
    leadsCountQ = leadsCountQ.in("seller_id", ids);
  }
  const [{ data: profiles }, { data: rawLeads }, { count: totalLeadCount }] = await Promise.all([
    bioId ? profilesQ.eq("company_bio_id", bioId) : profilesQ,
    bioId ? leadsQ.eq("company_bio_id", bioId) : leadsQ,
    bioId ? leadsCountQ.eq("company_bio_id", bioId) : leadsCountQ,
  ]);

  // Privacy pass: client-uploaded leads have their PII inside encrypted_payload.
  //  - Same tenant → decrypt and merge into the row so the UI sees real values.
  //  - Cross-tenant SWL super_admin → null out PII columns (redaction).
  //  - List view does NOT log access (would spam the audit log on every render);
  //    only individual reads (lead detail, agent decrypt) are logged.
  const allLeads = await (async () => {
    if (!rawLeads || rawLeads.length === 0) return rawLeads ?? [];
    const clientLeads = rawLeads.filter((l: { source?: string | null }) => l.source === "client");
    if (clientLeads.length === 0) return rawLeads;

    if (bioId) {
      // Tenant view: same tenant for every row, resolve key once.
      try {
        const { key } = await resolveTenantKey(bioId);
        return rawLeads.map((l: Record<string, unknown>) => {
          if (l.source !== "client" || !l.encrypted_payload) return l;
          try {
            const blob = bufferFromSupabaseBytea(l.encrypted_payload);
            const decrypted = decryptWithResolvedKey(blob, key);
            return { ...l, ...decrypted, encrypted_payload: undefined };
          } catch (err) {
            console.error("[/leads] decrypt failed for", l.id, err);
            return l;
          }
        });
      } catch (err) {
        console.error("[/leads] tenant key resolution failed", err);
        return rawLeads;
      }
    }

    // Cross-tenant SWL view: null PII columns on every client lead.
    return rawLeads.map((l: Record<string, unknown>) => {
      if (l.source !== "client") return l;
      const out: Record<string, unknown> = { ...l, encrypted_payload: undefined };
      for (const col of ENCRYPTED_LEAD_COLUMNS) out[col] = null;
      return out;
    });
  })();

  // Build a company-level aggregation from the decrypted set. Used by the
  // "Companies" sub-view inside All Leads. Company-level facts come from
  // whichever lead of that company we encounter first (after the
  // lead_score-desc order, that's the highest-scoring contact).
  type CompanyAgg = {
    name: string;
    industry: string | null;
    subIndustry: string | null;
    shortDesc: string | null;
    description: string | null;
    tagline: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    website: string | null;
    employees: string | null;
    logoUrl: string | null;
    leadIds: string[];
  };
  const companiesAgg: Record<string, CompanyAgg> = {};
  for (const l of (allLeads ?? []) as Array<Record<string, any>>) {
    const name = (l.company_name ?? "").trim();
    if (!name) continue;
    const existing = companiesAgg[name];
    if (!existing) {
      companiesAgg[name] = {
        name,
        industry: l.company_industry ?? null,
        subIndustry: l.company_sub_industry ?? null,
        shortDesc: l.organization_short_desc ?? null,
        description: l.organization_description ?? null,
        tagline: l.organization_tagline ?? null,
        city: l.company_city ?? null,
        state: l.company_state ?? null,
        country: l.company_country ?? null,
        website: l.company_website ?? null,
        employees: l.employees ?? null,
        logoUrl: l.organization_logo_url ?? null,
        leadIds: [l.id],
      };
    } else {
      existing.leadIds.push(l.id);
      // Backfill anything missing — earlier lead wins for any populated field
      existing.industry      ??= l.company_industry ?? null;
      existing.subIndustry   ??= l.company_sub_industry ?? null;
      existing.shortDesc     ??= l.organization_short_desc ?? null;
      existing.description   ??= l.organization_description ?? null;
      existing.tagline       ??= l.organization_tagline ?? null;
      existing.city          ??= l.company_city ?? null;
      existing.state         ??= l.company_state ?? null;
      existing.country       ??= l.company_country ?? null;
      existing.website       ??= l.company_website ?? null;
      existing.employees     ??= l.employees ?? null;
      existing.logoUrl       ??= l.organization_logo_url ?? null;
    }
  }

  const icpMap: Record<string, { id: string; profile_name: string; target_industries?: string[]; target_roles?: string[] }> = {};
  for (const p of profiles ?? []) icpMap[p.id] = p;

  // Round 2 — campaigns + replies + pending requests in parallel. campaigns
  // and replies both depend on leadIds; pendingRequests is independent of
  // both, so it can join this round instead of waiting for round 3.
  const leadIds = (allLeads ?? []).map(l => l.id);
  const campaignsQ = supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, created_at, lead_id, sellers(name)")
    .in("status", ["active", "paused", "completed", "failed"])
    .order("created_at", { ascending: false })
    .limit(500);
  const [campaignsRes, repliesRes, pendingRequestsRes] = await Promise.all([
    bioId && leadIds.length > 0
      ? campaignsQ.in("lead_id", leadIds)
      : (bioId ? Promise.resolve({ data: [] as any[] }) : campaignsQ),
    leadIds.length > 0
      ? supabase.from("lead_replies").select("lead_id, classification, received_at, channel, reply_text").in("lead_id", leadIds).order("received_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("campaign_requests").select("lead_id, name, status, created_at").eq("status", "pending_review"),
  ]);
  const campaigns = campaignsRes.data;
  const replies = repliesRes.data;
  const pendingRequests = pendingRequestsRes.data;

  // Round 3 — messages depends on campIds.
  const campIds = (campaigns ?? []).map(c => c.id);
  const { data: messages } = campIds.length > 0
    ? await supabase.from("campaign_messages").select("campaign_id, sent_at").in("campaign_id", campIds)
    : { data: [] as any[] };

  const pendingRequestsByLead: Record<string, { name: string; status: string }> = {};
  for (const r of pendingRequests ?? []) {
    if (r.lead_id) pendingRequestsByLead[r.lead_id] = { name: r.name, status: r.status };
  }

  // Lookups
  const repliesByLead: Record<string, any[]> = {};
  for (const r of replies ?? []) {
    if (!repliesByLead[r.lead_id]) repliesByLead[r.lead_id] = [];
    repliesByLead[r.lead_id].push(r);
  }

  const msgsByCamp: Record<string, { sent: number; total: number }> = {};
  for (const m of messages ?? []) {
    if (!msgsByCamp[m.campaign_id]) msgsByCamp[m.campaign_id] = { sent: 0, total: 0 };
    msgsByCamp[m.campaign_id].total++;
    if (m.sent_at) msgsByCamp[m.campaign_id].sent++;
  }

  const campsByLead: Record<string, any[]> = {};
  for (const c of campaigns ?? []) {
    if (!c.lead_id) continue;
    if (!campsByLead[c.lead_id]) campsByLead[c.lead_id] = [];
    campsByLead[c.lead_id].push({
      id: c.id, name: c.name, status: c.status, channel: c.channel,
      current_step: c.current_step,
      total_steps: Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0,
      last_step_at: c.last_step_at,
      seller: (c.sellers as any)?.name ?? null,
      messages_sent: (msgsByCamp[c.id] ?? { sent: 0 }).sent,
    });
  }

  // Build profile groups + all leads list
  type ProfileGroup = {
    profileId: string;
    profileName: string;
    leads: any[];
    campaigns: any[];
    statusCounts: Record<string, number>;
    totalReplies: number;
    positiveCount: number;
    hotCount: number;
    contactedCount: number;
    lastReply: { text: string | null; classification: string; leadName: string; receivedAt: string } | null;
  };

  const profileGroups: Record<string, ProfileGroup> = {};
  const allLeadsList: any[] = [];

  for (const lead of allLeads ?? []) {
    const pid = lead.icp_profile_id;
    const leadReplies = repliesByLead[lead.id] ?? [];
    const leadCamps = campsByLead[lead.id] ?? [];
    const hasCampaign = leadCamps.length > 0;

    // Pick the most-actionable campaign for the row (active > paused >
    // any). Used by the Campaign column in the table — clicking it
    // should land on the relevant campaign, not on the first arbitrary
    // one. ICP id stays so the ICP column links to the ticket.
    const activeCamp = leadCamps.find((c: any) => c.status === "active")
      ?? leadCamps.find((c: any) => c.status === "paused")
      ?? leadCamps[0]
      ?? null;
    const leadData = {
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      industry: (lead as Record<string, any>).company_industry ?? null,
      email: lead.primary_work_email,
      linkedin_url: lead.primary_linkedin_url,
      phone: lead.primary_phone,
      status: lead.status,
      score: lead.lead_score,
      is_priority: lead.is_priority,
      channel: lead.current_channel,
      reply_count: leadReplies.length,
      has_positive: leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent"),
      has_campaign: hasCampaign,
      profile_id: pid ?? null,
      profile_name: pid ? (icpMap[pid]?.profile_name ?? null) : null,
      campaign_id: activeCamp?.id ?? null,
      campaign_name: activeCamp?.name ?? null,
      campaign_status: activeCamp?.status ?? null,
      created_at: lead.created_at,
    };

    allLeadsList.push(leadData);

    if (hasCampaign && pid) {
      if (!profileGroups[pid]) {
        profileGroups[pid] = {
          profileId: pid, profileName: icpMap[pid]?.profile_name ?? "Unknown Profile",
          leads: [], campaigns: [], statusCounts: {},
          totalReplies: 0, positiveCount: 0, hotCount: 0, contactedCount: 0, lastReply: null,
        };
      }
      const pg = profileGroups[pid];
      pg.leads.push(leadData);
      pg.contactedCount++;
      if (leadData.is_priority || (leadData.score && leadData.score >= 80)) pg.hotCount++;
      for (const camp of leadCamps) {
        pg.campaigns.push(camp);
        pg.statusCounts[camp.status] = (pg.statusCounts[camp.status] ?? 0) + 1;
      }
      pg.totalReplies += leadReplies.length;
      if (leadData.has_positive) pg.positiveCount++;
      if (leadReplies.length > 0) {
        const latest = leadReplies[0];
        const leadName = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
        if (!pg.lastReply || new Date(latest.received_at) > new Date(pg.lastReply.receivedAt)) {
          pg.lastReply = { text: latest.reply_text, classification: latest.classification, leadName, receivedAt: latest.received_at };
        }
      }
    }
  }

  // Build lost leads + re-nurturing leads
  const lostLeads: any[] = [];
  const renurturingLeads: any[] = [];

  for (const lead of allLeads ?? []) {
    const leadCamps = campsByLead[lead.id] ?? [];
    const leadReplies = repliesByLead[lead.id] ?? [];
    const hasPositive = leadReplies.some((r: any) => r.classification === "positive" || r.classification === "meeting_intent");
    if (hasPositive) continue;

    const hasCompletedCampaign = leadCamps.some((c: any) => c.status === "completed" || c.status === "failed");
    const hasNegativeReply = leadReplies.some((r: any) => r.classification === "negative");
    if (!hasCompletedCampaign && !hasNegativeReply) continue;

    const negReply = leadReplies.find((r: any) => r.classification === "negative");
    // Use only completed/failed camps for history metrics
    const pastCamps = leadCamps.filter((c: any) => c.status === "completed" || c.status === "failed");
    const channels = [...new Set(pastCamps.map((c: any) => c.channel))];
    const totalStepsDone = pastCamps.reduce((s: number, c: any) => s + (c.current_step ?? 0), 0);
    const totalStepsMax = pastCamps.reduce((s: number, c: any) => s + (c.total_steps ?? 0), 0);
    const totalMsgsSent = pastCamps.reduce((s: number, c: any) => s + (c.messages_sent ?? 0), 0);
    const mainCamp = pastCamps[0] ?? leadCamps[0];

    const baseData = {
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      email: lead.primary_work_email,
      score: lead.lead_score,
      is_priority: lead.is_priority,
      profile_name: lead.icp_profile_id ? (icpMap[lead.icp_profile_id]?.profile_name ?? null) : null,
      reason: (hasNegativeReply ? "negative" : "no_reply") as "negative" | "no_reply",
      reply_text: negReply?.reply_text ?? null,
      reply_date: negReply?.received_at ?? null,
      campaign_name: mainCamp?.name ?? null,
      channels,
      steps_completed: totalStepsDone,
      steps_total: totalStepsMax,
      messages_sent: totalMsgsSent,
    };

    const activeCamp = leadCamps.find((c: any) => c.status === "active" || c.status === "paused");
    const pendingReq = pendingRequestsByLead[lead.id];

    // Bucket assignment — boss feedback 2026-05-28 (memory:
    // feedback_no_reply_goes_to_renurture):
    //   - reason === "no_reply"   → always Renurture (silent = candidate
    //     to re-engage with new copy, not truly lost).
    //   - reason === "negative"   → Lost if no active/pending follow-up,
    //     Renurture if seller already started a new flow.
    // The "new_campaign_*" fields are null for no_reply leads without an
    // active follow-up yet; RenurturingLeadCard handles that case by
    // showing a "Ready to re-engage" CTA instead of the progress block.
    const goesToRenurture = baseData.reason === "no_reply" || !!activeCamp || !!pendingReq;
    if (goesToRenurture) {
      renurturingLeads.push({
        ...baseData,
        new_campaign_name: activeCamp?.name ?? pendingReq?.name ?? null,
        new_campaign_status: activeCamp?.status ?? pendingReq?.status ?? (baseData.reason === "no_reply" ? "ready_to_reengage" : "pending_review"),
        new_campaign_step: activeCamp?.current_step ?? null,
        new_campaign_total_steps: activeCamp?.total_steps ?? null,
      });
    } else {
      lostLeads.push(baseData);
    }
  }

  const groupList = Object.values(profileGroups).sort((a, b) => b.leads.length - a.leads.length);
  const totalLeads = (allLeads ?? []).length;
  // Response rate must be replied / actually-contacted, not replied / has-a-
  // campaign-row. The previous formula used `unique lead_ids in campaigns`
  // which includes queued/draft campaigns where no message ever fired —
  // that inflated the denominator's quality (a queued lead can't reply yet)
  // and the resulting rate read as suspiciously high (~58% on Pathway).
  // Now the denominator is the set of leads with at least one message whose
  // sent_at is non-null, and the numerator is the intersection of "replied"
  // ∩ "contacted" so a stray inbound reply on a never-contacted lead can't
  // skew the ratio either.
  const sentLeadIds = new Set<string>();
  for (const m of messages ?? []) {
    if (!m.sent_at) continue;
    const camp = (campaigns ?? []).find((c: any) => c.id === m.campaign_id);
    if (camp?.lead_id) sentLeadIds.add(camp.lead_id);
  }
  const contactedCount = sentLeadIds.size;
  const repliedAmongContacted = [...sentLeadIds].filter(id => (repliesByLead[id]?.length ?? 0) > 0).length;
  const positiveCount = groupList.reduce((s, g) => s + g.positiveCount, 0);
  const responseRate = contactedCount > 0 ? Math.round((repliedAmongContacted / contactedCount) * 100) : 0;

  // ── Campaign groups for Campaigns view ──
  const campGroupsMap: Record<string, any[]> = {};
  for (const c of campaigns ?? []) {
    const key = c.name || "Unnamed";
    if (!campGroupsMap[key]) campGroupsMap[key] = [];
    campGroupsMap[key].push(c);
  }

  const campaignGroups = Object.entries(campGroupsMap).map(([name, camps]) => {
    const channels = [...new Set(camps.flatMap((c: any) => {
      const steps = c.sequence_steps ?? [];
      return steps.map((s: any) => typeof s === "string" ? s : s?.channel).filter(Boolean);
    }))];
    if (channels.length === 0) channels.push(...new Set(camps.map((c: any) => c.channel)));
    const active = camps.filter((c: any) => c.status === "active").length;
    const completed = camps.filter((c: any) => c.status === "completed").length;
    const paused = camps.filter((c: any) => c.status === "paused").length;
    const progressValues = camps.map((c: any) => {
      const total = c.sequence_steps?.length ?? 0;
      return total > 0 ? c.current_step / total : 0;
    });
    const avgProgress = progressValues.length > 0 ? Math.round((progressValues.reduce((a: number, b: number) => a + b, 0) / progressValues.length) * 100) : 0;
    const sellers = [...new Set(camps.map((c: any) => (c.sellers as any)?.name).filter(Boolean))] as string[];
    const lastActivity = camps.map((c: any) => c.last_step_at).filter(Boolean)
      .sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    const totalReplies = camps.reduce((s: number, c: any) => s + ((msgsByCamp[c.id]?.sent ?? 0) > 0 ? (repliesByLead[c.lead_id]?.length ?? 0) : 0), 0);
    const groupStatus = active > 0 ? "active" : paused > 0 ? "paused" : completed > 0 ? "completed" : "failed";

    return { name, firstId: camps[0].id, channels: [...new Set(channels)], totalLeads: camps.length, active, completed, avgProgress, totalReplies, sellers, lastActivity, status: groupStatus };
  }).sort((a, b) => b.active - a.active || b.totalLeads - a.totalLeads);

  // ── Uncampaigned leads (pending) ──
  const activeLids = new Set((campaigns ?? []).filter((c: any) => c.status === "active" || c.status === "paused").map((c: any) => c.lead_id).filter(Boolean));
  const uncampaignedLeads = (allLeads ?? []).filter(l => !activeLids.has(l.id));
  const uncampaignedByProfile: Record<string, { profileId: string | null; profileName: string | null; leads: any[] }> = {};
  for (const lead of uncampaignedLeads) {
    const key = lead.icp_profile_id ?? "__none";
    if (!uncampaignedByProfile[key]) {
      uncampaignedByProfile[key] = {
        profileId: lead.icp_profile_id,
        profileName: lead.icp_profile_id ? (icpMap[lead.icp_profile_id]?.profile_name ?? null) : null,
        leads: [],
      };
    }
    uncampaignedByProfile[key].leads.push({
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      email: lead.primary_work_email,
      score: lead.lead_score,
    });
  }

  // Build the Won (Opportunities) view from the same dataset. A lead is "won"
  // if it has any positive/meeting_intent reply OR was transferred to Odoo.
  // Shape mirrors /opportunities so we can reuse <OpportunitiesTable />.
  const wonLeads: any[] = [];
  for (const lead of (allLeads ?? []) as Array<Record<string, any>>) {
    const leadReplies = repliesByLead[lead.id] ?? [];
    const positiveReply = leadReplies.find(r => r.classification === "positive" || r.classification === "meeting_intent");
    const isOdoo = !!lead.transferred_to_odoo_at;
    if (!positiveReply && !isOdoo) continue;
    const camp = (campaigns ?? []).find((c: any) => c.lead_id === lead.id);
    const steps = Array.isArray(camp?.sequence_steps) ? camp.sequence_steps.length : 0;
    const channels = camp ? [...new Set([camp.channel, ...(Array.isArray(camp.sequence_steps) ? camp.sequence_steps.map((s: any) => s.channel) : [])])].filter(Boolean) : (positiveReply?.channel ? [positiveReply.channel] : []);
    const daysToConvert = positiveReply?.received_at && lead.created_at
      ? Math.max(1, Math.round((new Date(positiveReply.received_at).getTime() - new Date(lead.created_at).getTime()) / 86400000))
      : null;
    wonLeads.push({
      id: lead.id,
      first_name: lead.primary_first_name,
      last_name: lead.primary_last_name,
      company: lead.company_name,
      role: lead.primary_title_role,
      score: lead.lead_score,
      is_priority: !!lead.is_priority,
      transferred: isOdoo,
      profile_name: lead.icp_profile_id ? (icpMap[lead.icp_profile_id]?.profile_name ?? null) : null,
      campaign_name: camp?.name ?? null,
      campaign_id: camp?.id ?? null,
      win_channel: positiveReply?.channel ?? camp?.channel ?? null,
      win_text: positiveReply?.reply_text ?? null,
      win_classification: positiveReply?.classification ?? "positive",
      win_date: positiveReply?.received_at ?? null,
      channels,
      steps_to_convert: camp?.current_step ?? 0,
      total_steps: steps,
      days_to_convert: daysToConvert,
    });
  }
  wonLeads.sort((a, b) => {
    if (a.win_date && b.win_date) return new Date(b.win_date).getTime() - new Date(a.win_date).getTime();
    if (a.win_date) return -1;
    if (b.win_date) return 1;
    return 0;
  });

  // Finalize the companies list with per-company outreach stats derived from
  // the same campaigns/replies maps we already computed above.
  const companies = Object.values(companiesAgg).map(c => {
    let contactedCount = 0, repliedCount = 0, positiveCount = 0, wonCount = 0;
    for (const lid of c.leadIds) {
      const camps = campsByLead[lid] ?? [];
      const replies = repliesByLead[lid] ?? [];
      if (camps.length > 0) contactedCount++;
      if (replies.length > 0) repliedCount++;
      if (replies.some(r => r.classification === "positive" || r.classification === "meeting_intent")) positiveCount++;
      const leadObj = (allLeads ?? []).find((x: any) => x.id === lid);
      if (leadObj && (leadObj as any).status === "closed_won") wonCount++;
    }
    return {
      ...c,
      leadCount: c.leadIds.length,
      contactedCount,
      repliedCount,
      positiveCount,
      wonCount,
    };
  }).sort((a, b) => b.leadCount - a.leadCount || a.name.localeCompare(b.name));

  return {
    profileGroups: groupList,
    allLeads: allLeadsList,
    lostLeads,
    renurturingLeads,
    wonLeads,
    icpMap,
    campaignGroups,
    companies,
    uncampaignedGroups: Object.values(uncampaignedByProfile),
    stats: { activeProfiles: groupList.filter(g => (g.statusCounts.active ?? 0) > 0).length, totalLeads, responseRate, positiveReplies: positiveCount, activeCampaigns: campaignGroups.filter(g => g.status === "active").length },
    totalLeadCount: typeof totalLeadCount === "number" ? totalLeadCount : (allLeadsList?.length ?? 0),
  };
}

export default async function LeadsCampaignsPage() {
  const { profileGroups, allLeads, lostLeads, renurturingLeads, wonLeads, companies, stats, totalLeadCount } = await getData();
  const scope = await getUserScope();
  const canImport = canEditTenantSettings(scope.tier) || scope.tier === "manager";

  return (
    <div className="p-4 sm:p-6 w-full">
      <PageHero
        icon={Users}
        section="Operations"
        title="Leads"
        description="Manage your full prospect pipeline and track outreach progress across all channels."
        accentColor={C.blue}
        status={{ label: "Active", active: true }}
        stats={[
          { label: "Total leads", value: totalLeadCount ?? allLeads.length, tone: "neutral" },
          { label: "Active flows", value: stats.activeCampaigns, tone: "positive" },
          { label: "Reply rate", value: `${stats.responseRate}%`, tone: stats.responseRate >= 10 ? "positive" : "warning" },
          { label: "Positive replies", value: stats.positiveReplies, tone: stats.positiveReplies > 0 ? "positive" : "neutral" },
        ]}
        action={
          <div className="flex items-center gap-2 shrink-0">
            <ExportLeadsCSVButton
              leads={JSON.parse(JSON.stringify(allLeads))}
              totalLeadCount={totalLeadCount}
            />
            {canImport && (
              <Link
                href="/leads/import"
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shrink-0 transition-opacity hover:opacity-90"
                style={{
                  background: `linear-gradient(135deg, ${C.gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`,
                  color: "#1A1A2E",
                }}
              >
                <Upload size={11} /> Import Leads
              </Link>
            )}
          </div>
        }
      />

      <LeadsCampaignsClient
        profileGroups={JSON.parse(JSON.stringify(profileGroups))}
        allLeads={JSON.parse(JSON.stringify(allLeads))}
        lostLeads={JSON.parse(JSON.stringify(lostLeads))}
        renurturingLeads={JSON.parse(JSON.stringify(renurturingLeads))}
        wonLeads={JSON.parse(JSON.stringify(wonLeads))}
        companies={JSON.parse(JSON.stringify(companies))}
        stats={stats}
        totalLeadCount={totalLeadCount}
      />
    </div>
  );
}
