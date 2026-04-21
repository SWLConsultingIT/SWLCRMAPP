import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Megaphone, TrendingUp, MessageSquare, Users } from "lucide-react";
import PageHero from "@/components/PageHero";
import CampaignTabs from "./CampaignTabs";
import ActiveCampaignsView from "@/components/ActiveCampaignsView";
import NewCampaignView from "@/components/NewCampaignView";

const gold = "#C9A83A";

async function getData() {
  const [
    { data: campaigns },
    { data: allReplies },
    { data: campaignLeadIds },
    { data: allLeads },
    { data: icpProfiles },
  ] = await Promise.all([
    supabase.from("campaigns")
      .select("id, name, status, channel, current_step, sequence_steps, last_step_at, paused_until, completed_at, created_at, lead_id, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, icp_profile_id, company_bio_id, created_at), sellers(name)")
      .in("status", ["active", "paused", "completed", "failed"])
      .order("created_at", { ascending: false }).limit(200),
    supabase.from("lead_replies").select("lead_id, classification, campaign_id"),
    supabase.from("campaigns").select("lead_id").in("status", ["active", "paused", "completed"]),
    supabase.from("leads")
      .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, icp_profile_id, company_bio_id, created_at")
      .not("status", "in", "(closed_lost,qualified)")
      .order("created_at", { ascending: false }),
    supabase.from("icp_profiles").select("id, profile_name, target_industries, target_roles").eq("status", "approved"),
  ]);

  // Reply lookups
  const repliedLeadIds = new Set((allReplies ?? []).map(r => r.lead_id));
  const positiveLeadIds = new Set((allReplies ?? []).filter(r => r.classification === "positive" || r.classification === "meeting_intent").map(r => r.lead_id));
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

  // Stats
  const activeCamps = (campaigns ?? []).filter(c => c.status === "active");
  const contactedLeadIds = new Set((campaigns ?? []).map(c => c.lead_id).filter(Boolean));
  const contactedCount = contactedLeadIds.size;
  const repliedCount = [...contactedLeadIds].filter(id => repliedLeadIds.has(id)).length;
  const positiveCount = [...contactedLeadIds].filter(id => positiveLeadIds.has(id)).length;
  const responseRate = contactedCount > 0 ? Math.round((repliedCount / contactedCount) * 100) : 0;

  // Enrich campaigns with reply data
  const enrichedCampaigns = (campaigns ?? []).map(c => ({
    ...c,
    reply_count: repliesByCamp[c.id] ?? 0,
    positive_count: positiveByCamp[c.id] ?? 0,
  }));

  // Uncampaigned leads
  const activeLids = new Set((campaignLeadIds ?? []).map(c => c.lead_id).filter(Boolean));
  const uncampaigned = (allLeads ?? []).filter(l => !activeLids.has(l.id));
  const uncampaignedGroups: Record<string, { profile_id: string | null; leads: any[] }> = {};
  for (const lead of uncampaigned) {
    const key = lead.icp_profile_id ?? "__none";
    if (!uncampaignedGroups[key]) uncampaignedGroups[key] = { profile_id: lead.icp_profile_id, leads: [] };
    uncampaignedGroups[key].leads.push(lead);
  }
  const totalUncampaigned = uncampaigned.length;

  // ICP map
  const icpMap: Record<string, any> = {};
  (icpProfiles ?? []).forEach(p => { icpMap[p.id] = p; });

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
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Active Campaigns", value: stats.active, color: C.green, icon: Megaphone },
          { label: "Response Rate", value: `${stats.responseRate}%`, color: C.blue, icon: MessageSquare },
          { label: "Positive Replies", value: stats.positiveCount, color: C.green, icon: TrendingUp },
          { label: "Ready to Launch", value: stats.readyToLaunch, color: gold, icon: Users },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border p-4 card-lift" style={{ background: `linear-gradient(135deg, #FFFFFF 0%, ${color}09 100%)`, borderColor: C.border, borderTop: `2px solid ${color}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
              <div className="rounded-lg p-1.5" style={{ backgroundColor: `${color}15` }}>
                <Icon size={13} style={{ color }} />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <CampaignTabs
        readyCount={totalUncampaigned}
        activeCount={campaigns.filter(c => c.status === "active" || c.status === "paused").length}
      >
        {/* ═══ TAB 0: ACTIVE CAMPAIGNS ═══ */}
        <ActiveCampaignsView campaigns={JSON.parse(JSON.stringify(campaigns.filter(c => c.status === "active" || c.status === "paused")))} />

        {/* ═══ TAB 1: NEW CAMPAIGN ═══ */}
        <NewCampaignView
          groups={Object.entries(uncampaignedGroups).map(([key, group]) => {
            const profile = group.profile_id ? icpMap[group.profile_id] : null;
            return {
              profileId: group.profile_id,
              profileName: profile?.profile_name ?? null,
              profileDetail: profile ? [...(profile.target_industries ?? []), ...(profile.target_roles ?? [])].slice(0, 4).join(", ") : null,
              leads: group.leads,
            };
          })}
          totalUncampaigned={totalUncampaigned}
        />
      </CampaignTabs>
    </div>
  );
}
