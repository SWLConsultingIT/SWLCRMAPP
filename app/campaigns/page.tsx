import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Share2, CheckCircle, Target, Megaphone } from "lucide-react";
import Link from "next/link";
import CampaignTabs from "./CampaignTabs";
import ActiveCampaignsView from "@/components/ActiveCampaignsView";

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
                  <div key={key} className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.blue}` }}>
                    {/* Group header */}
                    <div className="px-6 py-4 flex items-center justify-between border-b"
                      style={{ borderColor: C.border, background: `${C.blue}06` }}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${C.blue}15` }}>
                          <Target size={15} style={{ color: C.blue }} />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                            {profile?.profile_name ?? "Unassigned Leads"}
                          </h3>
                          {profile && (
                            <p className="text-xs" style={{ color: C.textMuted }}>
                              {[...(profile.target_industries ?? []), ...(profile.target_roles ?? [])].slice(0, 4).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: C.blueLight, color: C.blue }}>
                          {group.leads.length} leads
                        </span>
                        {group.profile_id && (
                          <Link href={`/campaigns/new/${group.profile_id}`}
                            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
                            style={{ backgroundColor: gold, color: "#04070d" }}>
                            <Megaphone size={13} /> Configure Campaign
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* Leads table */}
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          {["Lead", "Company", "Email / LinkedIn", "Score", "Status", ""].map((h, hi) => (
                            <th key={hi} className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider"
                              style={{ color: C.textMuted }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.leads.map((lead: any) => (
                          <tr key={lead.id} className="table-row-hover" style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td className="px-6 py-3">
                              <Link href={`/leads/${lead.id}`} className="hover:underline">
                                <p className="font-medium" style={{ color: C.textPrimary }}>
                                  {lead.primary_first_name} {lead.primary_last_name}
                                </p>
                              </Link>
                            </td>
                            <td className="px-6 py-3 text-xs" style={{ color: C.textBody }}>{lead.company_name ?? "—"}</td>
                            <td className="px-6 py-3">
                              <div className="flex flex-col gap-0.5">
                                {lead.primary_work_email && (
                                  <span className="text-xs truncate max-w-48" style={{ color: C.textMuted }}>{lead.primary_work_email}</span>
                                )}
                                {lead.primary_linkedin_url && (
                                  <span className="text-xs flex items-center gap-1" style={{ color: C.linkedin }}>
                                    <Share2 size={10} /> LinkedIn
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-3">
                              {lead.lead_score ? (
                                <span className="text-xs font-bold px-2 py-0.5 rounded"
                                  style={{
                                    backgroundColor: lead.lead_score >= 80 ? C.redLight : lead.lead_score >= 50 ? C.orangeLight : C.accentLight,
                                    color: lead.lead_score >= 80 ? C.red : lead.lead_score >= 50 ? C.orange : C.accent,
                                  }}>
                                  {lead.lead_score}
                                </span>
                              ) : <span style={{ color: C.textDim }}>—</span>}
                            </td>
                            <td className="px-6 py-3">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize"
                                style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                                {lead.status?.replace("_", " ") ?? "new"}
                              </span>
                            </td>
                            <td className="px-6 py-3">
                              <Link href={`/campaigns/new/lead/${lead.id}`}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
                                style={{ backgroundColor: `${gold}18`, color: gold, border: `1px solid ${gold}30` }}>
                                <Megaphone size={11} /> Target Lead
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </CampaignTabs>
    </div>
  );
}
