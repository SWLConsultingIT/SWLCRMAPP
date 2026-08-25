import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { C } from "@/lib/design";
import { Megaphone, Send, MessageSquare, ThumbsUp, Sparkles } from "lucide-react";
import PageHero from "@/components/PageHero";
import CampaignTabs from "./CampaignTabs";
import TemplatesView from "./TemplatesView";
import ActiveCampaignsView from "@/components/ActiveCampaignsView";
import { getT } from "@/lib/i18n-server";
// NewCampaignView import removed 2026-05-28 — Create New Flow tab dropped.
// Flow creation now starts from a Lead Miner section header → lead picker
// at /campaigns/new/[profileId]/pick.
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

export const dynamic = "force-dynamic";

const gold = "var(--brand, #c9a83a)";

// Supabase caps a single response at ~1000 rows regardless of .range() — a bare
// .range(0,99999) still returns only the first 1000 (same footgun /leads pages
// around). Any query that can exceed 1000 on a large tenant must loop 1000-row
// pages. Rebuilds the query per page (a Supabase builder is single-use).
// 100k hard ceiling as a runaway guard.
async function fetchAllRows(mkQuery: () => any): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; from < 100000; from += PAGE) {
    const { data, error } = await mkQuery().range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function getData() {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  // Each of these can exceed 1000 rows on a large tenant. Previously they used
  // a single-shot .range(0, 9999/99999), which the comments believed lifted the
  // cap — but Supabase still returns only the first 1000, so tenants with >1000
  // campaigns/leads had an INCOMPLETE "leads already in a flow" set (inflating
  // "ready to launch") and a clipped campaign list (whole ICPs hidden). Same
  // 2026-05-31 / 2026-06-16 truncation. Now paginated via fetchAllRows so the
  // universe is complete regardless of tenant size. Builders are single-use →
  // factories rebuild per page.
  const mkCampsQuery = () => {
    let q = supabase.from("campaigns")
      .select("id, name, status, channel, current_step, sequence_steps, last_step_at, paused_until, completed_at, created_at, lead_id, leads!inner(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, icp_profile_id, company_bio_id, created_at, source, encrypted_payload, linkedin_connected, transferred_to_odoo_at), sellers(name)")
      .in("status", ["active", "paused", "completed", "failed"])
      .order("created_at", { ascending: false });
    if (bioId) q = q.eq("leads.company_bio_id", bioId);
    return q;
  };

  const mkCampLeadsQuery = () => {
    let q = supabase.from("campaigns").select("lead_id, leads!inner(company_bio_id)").in("status", ["active", "paused", "completed"]);
    if (bioId) q = q.eq("leads.company_bio_id", bioId);
    return q;
  };

  // Archived leads must not appear in the New Campaign picker. They were
  // showing up because the only filter was status; an admin operation that
  // sets archived=true without flipping status (e.g. manual cleanup, an
  // import that defaults archived to true) used to surface them as
  // selectable, then bite later when the wizard's channel coverage check
  // failed because allow_* flags were defaulted-false on archived rows.
  const mkLeadsQuery = () => {
    let q = supabase.from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, icp_profile_id, company_bio_id, created_at, source, encrypted_payload")
      .not("status", "in", "(closed_lost,qualified)")
      .neq("archived", true)
      .order("created_at", { ascending: false });
    if (bioId) q = q.eq("company_bio_id", bioId);
    return q;
  };

  const mkRepliesQuery = () => {
    let q = supabase.from("lead_replies").select("lead_id, classification, campaign_id, received_at, leads!inner(company_bio_id)");
    if (bioId) q = q.eq("leads.company_bio_id", bioId);
    return q;
  };

  const icpQ = supabase.from("icp_profiles").select("id, profile_name, target_industries, target_roles").eq("status", "approved");

  const [campaigns, allReplies, campaignLeadIds, allLeadsRaw, icpRes] = await Promise.all([
    fetchAllRows(mkCampsQuery),
    fetchAllRows(mkRepliesQuery),
    fetchAllRows(mkCampLeadsQuery),
    fetchAllRows(mkLeadsQuery),
    bioId ? icpQ.eq("company_bio_id", bioId) : icpQ,
  ]) as any;
  const icpProfiles = icpRes?.data;

  // Privacy pass: client-uploaded leads have PII inside encrypted_payload.
  // Same single-tenant decrypt as /leads/page.tsx — without it, every
  // client-source lead lands as "Unknown / Company-only" in the picker.
  // Resolve the key once and apply to both the flat lead list AND the
  // campaigns' embedded leads (campsQ uses leads!inner).
  const allLeads = await (async () => {
    if (!allLeadsRaw || allLeadsRaw.length === 0 || !bioId) return allLeadsRaw ?? [];
    const hasClient = allLeadsRaw.some((l: { source?: string | null }) => l.source === "client");
    if (!hasClient) return allLeadsRaw;
    try {
      const { key } = await resolveTenantKey(bioId);
      const decryptOne = (l: Record<string, unknown>) => {
        if (l.source !== "client" || !l.encrypted_payload) return l;
        try {
          const blob = bufferFromSupabaseBytea(l.encrypted_payload);
          return { ...l, ...decryptWithResolvedKey(blob, key), encrypted_payload: undefined };
        } catch (err) {
          console.error("[/campaigns] decrypt failed for", l.id, err);
          return l;
        }
      };
      // Also hydrate the embedded `leads` row attached to each campaign.
      for (const c of campaigns ?? []) {
        if (c.leads) c.leads = decryptOne(c.leads as Record<string, unknown>);
      }
      return allLeadsRaw.map(decryptOne);
    } catch (err) {
      console.error("[/campaigns] tenant key resolution failed", err);
      return allLeadsRaw;
    }
  })();

  // Count sent/skipped messages per campaign for accurate progress.
  // campaigns.current_step is NOT reliable: step 0 (connection request) dispatch
  // doesn't increment it, and call step completions never touch it. Using
  // campaign_messages counts is the only source of truth.
  const campIds: string[] = (campaigns ?? []).map((c: any) => c.id).filter(Boolean);
  const sentCountByCamp: Record<string, number> = {};
  const totalCountByCamp: Record<string, number> = {};
  // Per-campaign channel breakdown so each Outreach Flow card can show how
  // many LinkedIn invites (step 0), LinkedIn DMs (step 1+), and emails
  // actually fired. Boss feedback 2026-05-27.
  const liInvitesByCamp: Record<string, number> = {};
  const liDmsByCamp: Record<string, number> = {};
  const emailsByCamp: Record<string, number> = {};
  // Today's pulse — count messages sent since 00:00 local. Boss 2026-05-29
  // wants a one-line "today" strip at the top of /campaigns instead of the
  // generic 4 stat cards. Reuses the same campaign_messages query (one extra
  // column, no extra round-trip).
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  let messagesSentToday = 0;
  if (campIds.length > 0) {
    const { data: msgCounts } = await supabase
      .from("campaign_messages")
      .select("campaign_id, status, channel, step_number, sent_at")
      .in("campaign_id", campIds) as any;
    for (const m of msgCounts ?? []) {
      totalCountByCamp[m.campaign_id] = (totalCountByCamp[m.campaign_id] ?? 0) + 1;
      if (m.status === "sent" || m.status === "skipped") {
        sentCountByCamp[m.campaign_id] = (sentCountByCamp[m.campaign_id] ?? 0) + 1;
      }
      if (m.status === "sent") {
        if (m.sent_at && new Date(m.sent_at).getTime() >= startOfTodayMs) {
          messagesSentToday++;
        }
        if (m.channel === "linkedin") {
          if (m.step_number === 0) liInvitesByCamp[m.campaign_id] = (liInvitesByCamp[m.campaign_id] ?? 0) + 1;
          else liDmsByCamp[m.campaign_id] = (liDmsByCamp[m.campaign_id] ?? 0) + 1;
        } else if (m.channel === "email") {
          emailsByCamp[m.campaign_id] = (emailsByCamp[m.campaign_id] ?? 0) + 1;
        }
      }
    }
  }
  // Calls live outside campaign_messages — query the calls table separately
  // and group by lead_id, then attribute to whichever campaign owns each
  // lead. Each lead is in exactly one Outreach Flow per the schema.
  const allCampLeadIds: string[] = (campaigns ?? []).map((c: any) => c.lead_id).filter(Boolean);
  const callsByLead: Record<string, number> = {};
  if (allCampLeadIds.length > 0) {
    const { data: callRows } = await supabase.from("calls").select("lead_id").in("lead_id", allCampLeadIds);
    for (const cr of callRows ?? []) {
      const lid = (cr as any).lead_id as string | null;
      if (lid) callsByLead[lid] = (callsByLead[lid] ?? 0) + 1;
    }
  }
  const callsByCamp: Record<string, number> = {};
  for (const c of (campaigns ?? []) as any[]) {
    const lid = c.lead_id as string | null;
    if (lid && callsByLead[lid]) callsByCamp[c.id] = (callsByCamp[c.id] ?? 0) + callsByLead[lid];
  }

  // Reply lookups
  // By-lead reply sets — include EVERY channel (LinkedIn, email, AND call
  // outcomes). Call positives have no campaign_id on their lead_reply, so we
  // attribute replies to flows via the campaign's lead_id, not the reply's
  // campaign_id (see enrichedCampaigns below).
  const repliedLeadIds = new Set((allReplies ?? []).map((r: any) => r.lead_id));
  const positiveLeadIds = new Set((allReplies ?? []).filter((r: any) => r.classification === "positive" || r.classification === "meeting_intent").map((r: any) => r.lead_id));

  // Stats — "Active Campaigns" matches the tab view (active + paused)
  const activeCamps = (campaigns ?? []).filter((c: any) => c.status === "active" || c.status === "paused");
  const contactedLeadIds = new Set((campaigns ?? []).map((c: any) => c.lead_id).filter(Boolean));
  const contactedCount = contactedLeadIds.size;
  const repliedCount = [...contactedLeadIds].filter(id => repliedLeadIds.has(id)).length;
  const positiveCount = [...contactedLeadIds].filter(id => positiveLeadIds.has(id)).length;
  const responseRate = contactedCount > 0 ? Math.round((repliedCount / contactedCount) * 100) : 0;

  // Today-scoped reply counts for the pulse strip.
  let repliesToday = 0;
  let positiveRepliesToday = 0;
  for (const r of allReplies ?? []) {
    if (!r.received_at) continue;
    if (new Date(r.received_at).getTime() < startOfTodayMs) continue;
    repliesToday++;
    if (r.classification === "positive" || r.classification === "meeting_intent") positiveRepliesToday++;
  }

  // Enrich campaigns with reply data + message-based progress counts +
  // per-channel send breakdown so the cards can show LinkedIn invites
  // / LinkedIn DMs / emails / calls separately.
  const enrichedCampaigns = (campaigns ?? []).map((c: any) => ({
    ...c,
    // Reply / positive are LEAD-level signals, keyed off the campaign's
    // lead_id — NOT lead_replies.campaign_id. A positive logged via a CALL
    // (post-call popup) inserts a lead_reply with classification='positive'
    // but NO campaign_id, so the old `repliesByCamp[c.id]` (campaign_id-keyed)
    // silently dropped every call outcome — the flow card showed Positive 0
    // while the flow's Metrics tab (which keys off lead_id) showed the real
    // count. repliedLeadIds/positiveLeadIds already include all channels.
    reply_count: (c.lead_id && repliedLeadIds.has(c.lead_id)) ? 1 : 0,
    positive_count: (c.lead_id && positiveLeadIds.has(c.lead_id)) ? 1 : 0,
    sent_steps: sentCountByCamp[c.id] ?? 0,
    total_steps: totalCountByCamp[c.id] ?? (c.sequence_steps?.length ?? 0),
    linkedin_invites_sent: liInvitesByCamp[c.id] ?? 0,
    linkedin_dms_sent: liDmsByCamp[c.id] ?? 0,
    emails_sent: emailsByCamp[c.id] ?? 0,
    calls_made: callsByCamp[c.id] ?? 0,
  }));

  // Uncampaigned leads
  const activeLids = new Set((campaignLeadIds ?? []).map((c: any) => c.lead_id).filter(Boolean));
  const uncampaigned = (allLeads ?? []).filter((l: any) => !activeLids.has(l.id));
  const uncampaignedGroups: Record<string, { profile_id: string | null; leads: any[] }> = {};
  for (const lead of uncampaigned) {
    const key = lead.icp_profile_id ?? "__none";
    if (!uncampaignedGroups[key]) uncampaignedGroups[key] = { profile_id: lead.icp_profile_id, leads: [] };
    uncampaignedGroups[key].leads.push(lead);
  }
  const totalUncampaigned = uncampaigned.length;

  // ICP map
  const icpMap: Record<string, any> = {};
  (icpProfiles ?? []).forEach((p: any) => { icpMap[p.id] = p; });

  return {
    campaigns: enrichedCampaigns,
    stats: {
      active: activeCamps.length,
      responseRate,
      positiveCount,
      readyToLaunch: totalUncampaigned,
      messagesSentToday,
      repliesToday,
      positiveRepliesToday,
    },
    uncampaignedGroups,
    icpMap,
    totalUncampaigned,
  };
}

export default async function CampaignsPage() {
  const [{ campaigns, stats, uncampaignedGroups, icpMap, totalUncampaigned }, t] = await Promise.all([
    getData(),
    getT(),
  ]);
  const hasPulse = stats.messagesSentToday > 0 || stats.repliesToday > 0;
  // Per-ICP "available to launch" counts (eligible leads with no active/paused/
  // completed campaign), surfaced on each ICP card instead of one global chip.
  const availableByIcp: Record<string, number> = {};
  for (const [key, grp] of Object.entries(uncampaignedGroups)) {
    if (key === "__none") continue;
    availableByIcp[key] = (grp as { leads: unknown[] }).leads.length;
  }

  return (
    <div className="p-6 w-full">
      {/* Hero card — SWL gold identity (redesign 2026-08-25, boss). Merges the
          old purple PageHero + the separate "today's pulse" strip into one
          themed card with a gold-ramp stripe and a KPI strip (flows running ·
          sent today · replies+positive · reply rate). */}
      <div className="rounded-2xl border overflow-hidden mb-6 relative"
        style={{ backgroundColor: C.card, borderColor: C.border2, boxShadow: C.shadowMd }}>
        <div className="absolute inset-x-0 top-0 h-[3px] pointer-events-none"
          style={{ background: "linear-gradient(90deg, var(--fg1), var(--fg3) 45%, var(--fg4) 80%, transparent)" }} />
        <div className="p-6 pt-7">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="h-[2px] w-4 rounded" style={{ backgroundColor: gold }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--fg1)" }}>Growth Engine</span>
          </div>
          <h1 className="text-[25px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>Outreach Flow</h1>
          <p className="text-[12.5px] mt-1.5 max-w-lg leading-relaxed" style={{ color: C.textMuted }}>
            Multi-step outreach sequences across LinkedIn, email and calls — organized by ICP.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 border-t" style={{ borderColor: C.border }}>
          {([
            { label: "Flows running", value: String(stats.active), gold: true, sub: null as string | null },
            { label: "Sent today", value: String(stats.messagesSentToday), gold: false, sub: null },
            { label: "Replies today", value: String(stats.repliesToday), gold: false, sub: stats.positiveRepliesToday > 0 ? `+${stats.positiveRepliesToday} pos` : null },
            { label: "Reply rate", value: `${stats.responseRate}%`, gold: false, sub: null },
          ]).map((s, i) => (
            <div key={s.label} className="px-5 py-4" style={{ borderLeft: i % 4 === 0 ? "none" : `1px solid ${C.border}` }}>
              <p className="text-[22px] font-bold tabular-nums leading-none" style={{ color: s.gold ? "var(--fg1)" : C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                {s.value}{s.sub && <span className="text-[12px] font-semibold ml-1.5" style={{ color: C.green }}>{s.sub}</span>}
              </p>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] mt-2" style={{ color: C.textMuted }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs — Flows / Templates. Create New Flow tab removed 2026-05-28
          (boss feedback): flow creation now starts from inside a Lead Miner
          section header so the seller always picks an ICP first; the
          standalone tab led to the wizard with no ICP context. */}
      <CampaignTabs
        activeCount={campaigns.filter((c: any) => c.status === "active" || c.status === "paused").length}
      >
        {/* ═══ TAB 0: FLOWS (grouped by ICP) ═══ */}
        <ActiveCampaignsView
          campaigns={JSON.parse(JSON.stringify(campaigns.filter((c: any) => c.status === "active" || c.status === "paused")))}
          icpMap={JSON.parse(JSON.stringify(icpMap))}
          availableByIcp={availableByIcp}
        />

        {/* ═══ TAB 1: TEMPLATES ═══ */}
        <TemplatesView />
      </CampaignTabs>
    </div>
  );
}

function PulseStat({
  icon: Icon, label, sub, color,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  label: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 relative">
      <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
          color,
        }}>
        <Icon size={13} strokeWidth={2.2} />
      </span>
      <div className="leading-tight">
        <p className="text-[13px] font-bold tabular-nums" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
          {label}
        </p>
        {sub && (
          <p className="text-[10.5px] font-semibold tabular-nums" style={{ color }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
