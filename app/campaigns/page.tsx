import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";
import { C } from "@/lib/design";
import { Megaphone, TrendingUp, MessageSquare, Users } from "lucide-react";
import PageHero from "@/components/PageHero";
import CampaignTabs from "./CampaignTabs";
import TemplatesView from "./TemplatesView";
import ActiveCampaignsView from "@/components/ActiveCampaignsView";
// NewCampaignView import removed 2026-05-28 — Create New Flow tab dropped.
// Flow creation now starts from a Lead Miner section header → lead picker
// at /campaigns/new/[profileId]/pick.
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

export const dynamic = "force-dynamic";

const gold = "var(--brand, #c9a83a)";

async function getData() {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const campsQ = supabase.from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, paused_until, completed_at, created_at, lead_id, leads!inner(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, icp_profile_id, company_bio_id, created_at, source, encrypted_payload, linkedin_connected, transferred_to_odoo_at), sellers(name)")
    .in("status", ["active", "paused", "completed", "failed"])
    .order("created_at", { ascending: false }).limit(200);

  const campLeadsQ = supabase.from("campaigns").select("lead_id, leads!inner(company_bio_id)").in("status", ["active", "paused", "completed"]);

  // Archived leads must not appear in the New Campaign picker. They were
  // showing up because the only filter was status; an admin operation that
  // sets archived=true without flipping status (e.g. manual cleanup, an
  // import that defaults archived to true) used to surface them as
  // selectable, then bite later when the wizard's channel coverage check
  // failed because allow_* flags were defaulted-false on archived rows.
  const leadsQ = supabase.from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, primary_phone, status, lead_score, icp_profile_id, company_bio_id, created_at, source, encrypted_payload")
    .not("status", "in", "(closed_lost,qualified)")
    .neq("archived", true)
    .order("created_at", { ascending: false });

  const icpQ = supabase.from("icp_profiles").select("id, profile_name, target_industries, target_roles").eq("status", "approved");

  const repliesQ = supabase.from("lead_replies").select("lead_id, classification, campaign_id, leads!inner(company_bio_id)");

  const [
    { data: campaigns },
    { data: allReplies },
    { data: campaignLeadIds },
    { data: allLeadsRaw },
    { data: icpProfiles },
  ] = await Promise.all([
    bioId ? campsQ.eq("leads.company_bio_id", bioId) : campsQ,
    bioId ? repliesQ.eq("leads.company_bio_id", bioId) : repliesQ,
    bioId ? campLeadsQ.eq("leads.company_bio_id", bioId) : campLeadsQ,
    bioId ? leadsQ.eq("company_bio_id", bioId) : leadsQ,
    bioId ? icpQ.eq("company_bio_id", bioId) : icpQ,
  ]) as any;

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
  if (campIds.length > 0) {
    const { data: msgCounts } = await supabase
      .from("campaign_messages")
      .select("campaign_id, status, channel, step_number")
      .in("campaign_id", campIds) as any;
    for (const m of msgCounts ?? []) {
      totalCountByCamp[m.campaign_id] = (totalCountByCamp[m.campaign_id] ?? 0) + 1;
      if (m.status === "sent" || m.status === "skipped") {
        sentCountByCamp[m.campaign_id] = (sentCountByCamp[m.campaign_id] ?? 0) + 1;
      }
      if (m.status === "sent") {
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
  const repliedLeadIds = new Set((allReplies ?? []).map((r: any) => r.lead_id));
  const positiveLeadIds = new Set((allReplies ?? []).filter((r: any) => r.classification === "positive" || r.classification === "meeting_intent").map((r: any) => r.lead_id));
  const repliesByCamp: Record<string, number> = {};
  const positiveByCamp: Record<string, number> = {};
  for (const r of allReplies ?? []) {
    if (r.campaign_id) {
      repliesByCamp[r.campaign_id] = (repliesByCamp[r.campaign_id] ?? 0) + 1;
      if (r.classification === "positive" || r.classification === "meeting_intent") {
        positiveByCamp[r.campaign_id] = (positiveByCamp[r.campaign_id] ?? 0) + 1;
      }
    }
  }

  // Stats — "Active Campaigns" matches the tab view (active + paused)
  const activeCamps = (campaigns ?? []).filter((c: any) => c.status === "active" || c.status === "paused");
  const contactedLeadIds = new Set((campaigns ?? []).map((c: any) => c.lead_id).filter(Boolean));
  const contactedCount = contactedLeadIds.size;
  const repliedCount = [...contactedLeadIds].filter(id => repliedLeadIds.has(id)).length;
  const positiveCount = [...contactedLeadIds].filter(id => positiveLeadIds.has(id)).length;
  const responseRate = contactedCount > 0 ? Math.round((repliedCount / contactedCount) * 100) : 0;

  // Enrich campaigns with reply data + message-based progress counts +
  // per-channel send breakdown so the cards can show LinkedIn invites
  // / LinkedIn DMs / emails / calls separately.
  const enrichedCampaigns = (campaigns ?? []).map((c: any) => ({
    ...c,
    reply_count: repliesByCamp[c.id] ?? 0,
    positive_count: positiveByCamp[c.id] ?? 0,
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
    },
    uncampaignedGroups,
    icpMap,
    totalUncampaigned,
  };
}

export default async function CampaignsPage() {
  const { campaigns, stats, uncampaignedGroups, icpMap, totalUncampaigned } = await getData();

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Megaphone}
        section="Growth Engine"
        title="Outreach Flow™"
        description="Build and launch multi-step outreach sequences across LinkedIn and email."
        accentColor={C.aiAccent}
        status={{ label: "AI Active", active: true }}
        badge="Outreach Engine"
      />

      {/* 4 stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Active Flows", value: stats.active, color: C.green, icon: Megaphone },
          { label: "Response Rate", value: `${stats.responseRate}%`, color: C.blue, icon: MessageSquare },
          { label: "Positive Replies", value: stats.positiveCount, color: C.green, icon: TrendingUp },
          { label: "Ready to Launch", value: stats.readyToLaunch, color: gold, icon: Users },
        ].map(({ label, value, color, icon: Icon }) => (
          <div
            key={label}
            data-stat
            className="rounded-2xl border px-6 py-5 card-lift relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, var(--c-card) 0%, color-mix(in srgb, ${color} 5%, var(--c-card)) 100%)`,
              borderColor: C.border,
              borderTop: `3px solid ${color}`,
            }}
          >
            {/* Soft halo behind the icon — premium depth without ornamentation. */}
            <div
              className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none opacity-50"
              style={{ background: `radial-gradient(circle, color-mix(in srgb, ${color} 16%, transparent) 0%, transparent 70%)` }}
            />
            <div className="flex items-center justify-between mb-4 relative">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: C.textMuted }}>
                {label}
              </span>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
                  boxShadow: `0 0 16px color-mix(in srgb, ${color} 18%, transparent)`,
                }}
              >
                <Icon size={16} style={{ color }} />
              </div>
            </div>
            <p
              className="text-[30px] font-bold leading-none"
              style={{
                color,
                fontFamily: "var(--font-outfit), system-ui, sans-serif",
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </p>
          </div>
        ))}
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
        />

        {/* ═══ TAB 1: TEMPLATES ═══ */}
        <TemplatesView />
      </CampaignTabs>
    </div>
  );
}
