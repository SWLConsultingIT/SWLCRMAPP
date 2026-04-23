import { getSupabaseServer } from "@/lib/supabase-server";
import { C } from "@/lib/design";
import Link from "next/link";

export const dynamic = "force-dynamic";
import { Target, User, ArrowLeft, AlertTriangle, Upload, Megaphone } from "lucide-react";
import NewFlowClient from "./NewFlowClient";

const gold = "var(--brand, #c9a83a)";

async function getIcpProfiles() {
  const supabase = await getSupabaseServer();
  const { data: profiles } = await supabase
    .from("icp_profiles")
    .select("id, profile_name, target_industries, target_roles, geography, status")
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (!profiles || profiles.length === 0) return [];

  // Count leads per profile
  const profileIds = profiles.map(p => p.id);
  const { data: leads } = await supabase
    .from("leads")
    .select("id, icp_profile_id")
    .in("icp_profile_id", profileIds);

  const { data: activeCamps } = await supabase
    .from("campaigns")
    .select("lead_id")
    .in("status", ["active", "paused"]);
  const activeSet = new Set((activeCamps ?? []).map(c => c.lead_id));

  const countByProfile: Record<string, { total: number; available: number }> = {};
  for (const l of leads ?? []) {
    if (!l.icp_profile_id) continue;
    if (!countByProfile[l.icp_profile_id]) countByProfile[l.icp_profile_id] = { total: 0, available: 0 };
    countByProfile[l.icp_profile_id].total++;
    if (!activeSet.has(l.id)) countByProfile[l.icp_profile_id].available++;
  }

  return profiles.map(p => ({
    ...p,
    leadCount: countByProfile[p.id]?.total ?? 0,
    availableCount: countByProfile[p.id]?.available ?? 0,
  }));
}

async function getLeadsWithoutCampaign() {
  const supabase = await getSupabaseServer();
  const { data: campaignLeadIds } = await supabase
    .from("campaigns").select("lead_id").in("status", ["active", "paused", "completed"]);
  const excludedLids = new Set((campaignLeadIds ?? []).map(c => c.lead_id).filter(Boolean));

  const { data: allLeads } = await supabase
    .from("leads")
    .select("id, primary_first_name, primary_last_name, primary_title_role, company_name, icp_profile_id")
    .not("status", "in", '("closed_lost","qualified")')
    .order("created_at", { ascending: false }).limit(100);

  return (allLeads ?? []).filter(l => !excludedLids.has(l.id));
}

export default async function NewFlowPage() {
  const supabase = await getSupabaseServer();
  const [profiles, leads, { count: totalLeads }] = await Promise.all([
    getIcpProfiles(),
    getLeadsWithoutCampaign(),
    supabase.from("leads").select("*", { count: "exact", head: true }),
  ]);

  const noLeadsAtAll = (totalLeads ?? 0) === 0;

  if (noLeadsAtAll) {
    return (
      <div className="p-6 w-full max-w-3xl mx-auto">
        <Link href="/campaigns" className="flex items-center gap-2 text-sm font-medium mb-6 hover:opacity-70" style={{ color: C.textMuted }}>
          <ArrowLeft size={16} /> Back to Campaigns
        </Link>
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <AlertTriangle size={32} className="mx-auto mb-4" style={{ color: "#D97706" }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: C.textPrimary }}>No Leads Available</h2>
          <p className="text-sm mb-6" style={{ color: C.textMuted }}>Go to Lead Miner to submit an ICP profile and import leads.</p>
          <Link href="/icp" className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-80"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            <Upload size={15} /> Go to Lead Miner
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 w-full max-w-3xl mx-auto">
      <Link href="/campaigns" className="flex items-center gap-2 text-sm font-medium mb-6 hover:opacity-70" style={{ color: C.textMuted }}>
        <ArrowLeft size={16} /> Back to Campaigns
      </Link>
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>New Flow</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Create a Campaign</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>Choose how you want to start your outreach flow.</p>
      </div>
      <div className="h-px mb-8" style={{ background: `linear-gradient(90deg, ${gold} 0%, color-mix(in srgb, var(--brand, #c9a83a) 15%, transparent) 40%, transparent 100%)` }} />

      <NewFlowClient profiles={JSON.parse(JSON.stringify(profiles))} leads={JSON.parse(JSON.stringify(leads))} />
    </div>
  );
}
