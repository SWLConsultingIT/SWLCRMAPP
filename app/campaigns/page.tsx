import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { CheckCircle } from "lucide-react";
import CampaignTabs from "./CampaignTabs";
import ActiveCampaignsView from "@/components/ActiveCampaignsView";
import ReadyToLaunchGroup from "@/components/ReadyToLaunchGroup";

const gold = "#C9A83A";

// ── Data fetchers ──

async function getActiveCampaigns() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, paused_until, completed_at, created_at, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, status), sellers(name)")
    .in("status", ["active", "paused", "completed", "failed"])
    .order("created_at", { ascending: false })
    .limit(200);
  return data ?? [];
}

async function getLeadsWithoutCampaign() {
  // Get all lead IDs that have an active/paused campaign
  const { data: campaignLeadIds } = await supabase
    .from("campaigns")
    .select("lead_id")
    .in("status", ["active", "paused"]);

  const activeLids = new Set((campaignLeadIds ?? []).map(c => c.lead_id).filter(Boolean));

  // Get all leads
  const { data: allLeads } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, status, lead_score, icp_profile_id, company_bio_id, created_at")
    .order("created_at", { ascending: false });

  // Filter to those without active campaign
  const uncampaigned = (allLeads ?? []).filter(l => !activeLids.has(l.id));

  // Group by icp_profile_id
  const grouped: Record<string, { profile_id: string | null; leads: any[] }> = {};
  for (const lead of uncampaigned) {
    const key = lead.icp_profile_id ?? "__none";
    if (!grouped[key]) grouped[key] = { profile_id: lead.icp_profile_id, leads: [] };
    grouped[key].leads.push(lead);
  }

  return grouped;
}

async function getIcpProfiles() {
  const { data } = await supabase
    .from("icp_profiles")
    .select("id, profile_name, target_industries, target_roles")
    .eq("status", "approved");
  const map: Record<string, any> = {};
  (data ?? []).forEach(p => { map[p.id] = p; });
  return map;
}


export default async function CampaignsPage() {
  const [campaigns, uncampaignedGroups, icpMap] = await Promise.all([
    getActiveCampaigns(), getLeadsWithoutCampaign(), getIcpProfiles(),
  ]);

  const active    = campaigns.filter(c => c.status === "active").length;
  const paused    = campaigns.filter(c => c.status === "paused").length;
  const completed = campaigns.filter(c => c.status === "completed").length;

  // Count uncampaigned leads
  const totalUncampaigned = Object.values(uncampaignedGroups).reduce((sum, g) => sum + g.leads.length, 0);

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>GrowthEngine</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>OutreachFlow</h1>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: "Active",         value: active,           color: C.green,    border: C.green },
          { label: "Paused",         value: paused,           color: "#D97706",  border: "#D97706" },
          { label: "Completed",      value: completed,        color: C.textMuted,border: C.border },
          { label: "Total",          value: campaigns.length, color: gold,       border: gold },
          { label: "Ready to Launch",value: totalUncampaigned, color: C.blue,    border: C.blue },
        ].map(({ label, value, color, border }) => (
          <div key={label} className="rounded-xl border p-5"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${border}` }}>
            <p className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
            <p className="text-xs mt-1 font-medium uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <CampaignTabs
        readyCount={totalUncampaigned}
        activeCount={campaigns.length}
      >
        {/* ═══ TAB 0: ACTIVE CAMPAIGNS ═══ */}
        <ActiveCampaignsView campaigns={campaigns as any[]} />

        {/* ═══ TAB 1: READY TO LAUNCH ═══ */}
        <div>
          {totalUncampaigned === 0 ? (
            <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
              <p className="text-sm font-medium" style={{ color: C.textBody }}>All leads have active campaigns</p>
              <p className="text-xs mt-1" style={{ color: C.textMuted }}>New leads will appear here when uploaded via Lead Gen</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(uncampaignedGroups).map(([key, group]) => {
                const profile = group.profile_id ? icpMap[group.profile_id] : null;
                return (
                  <ReadyToLaunchGroup
                    key={key}
                    profileId={group.profile_id}
                    profileName={profile?.profile_name ?? null}
                    profileDetail={profile ? [...(profile.target_industries ?? []), ...(profile.target_roles ?? [])].slice(0, 4).join(", ") : null}
                    leads={group.leads}
                  />
                );
              })}
            </div>
          )}
        </div>

      </CampaignTabs>
    </div>
  );
}
