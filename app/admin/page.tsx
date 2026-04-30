import { getSupabaseService } from "@/lib/supabase-service";
import AdminClient from "./AdminClient";
import { getSupabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = getSupabaseService();

export type ClientData = {
  id: string;
  company_name: string;
  industry: string | null;
  location: string | null;
  logo_url: string | null;
  leads: number;
  profiles: number;
  campaigns: number;
  pendingProfiles: number;
  pendingCampaigns: number;
};

export type PendingApproval = {
  id: string;
  type: "profile" | "campaign";
  name: string;
  clientName: string;
  clientId: string;
  subtitle: string;
  createdAt: string;
  href: string;
};

export type ExecutionItem = {
  id: string;
  profileName: string;
  clientName: string;
  clientId: string;
  status: string;
  leadsUploaded: number | null;
  createdAt: string;
  href: string;
};

async function getData() {
  // Queries 1-5 are independent — fire them in parallel (Promise.all) instead
  // of awaiting sequentially. Was ~600-900ms in serial; now ~150-200ms parallel.
  const [
    { data: bios },
    { data: allProfiles },
    { data: pendingCampRequests },
    { data: leadCounts },
    { data: activeCampaigns },
  ] = await Promise.all([
    // 1) Clients — exclude demo tenants. Demos live behind /admin/demos and
    //    should never count as paying clients on the admin dashboard.
    supabase
      .from("company_bios")
      .select("id, company_name, industry, logo_url, location, created_at")
      .or("is_demo.is.null,is_demo.eq.false")
      .order("created_at", { ascending: false }),
    // 2) All ICP profiles
    supabase
      .from("icp_profiles")
      .select("id, profile_name, company_bio_id, status, execution_status, leads_uploaded, created_at"),
    // 3) All campaign requests pending
    supabase
      .from("campaign_requests")
      .select("id, name, target_leads_count, created_at, company_bio_id, status")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true }),
    // 4) Leads count per client
    supabase.from("leads").select("company_bio_id"),
    // 5) Active campaigns count per client
    supabase.from("campaigns").select("lead_id, status").eq("status", "active"),
  ]);

  // 6) campaignLeads depends on (5) so runs after — can't parallelize this one.
  const { data: campaignLeads } = activeCampaigns && activeCampaigns.length > 0
    ? await supabase.from("leads").select("id, company_bio_id").in("id", activeCampaigns.map(c => c.lead_id).filter(Boolean))
    : { data: [] };

  // Build lookups
  const bioMap: Record<string, string> = {};
  for (const b of bios ?? []) bioMap[b.id] = b.company_name;

  const leadsPerClient: Record<string, number> = {};
  for (const l of leadCounts ?? []) {
    if (l.company_bio_id) leadsPerClient[l.company_bio_id] = (leadsPerClient[l.company_bio_id] ?? 0) + 1;
  }

  const campaignsPerClient: Record<string, number> = {};
  for (const cl of campaignLeads ?? []) {
    if (cl.company_bio_id) campaignsPerClient[cl.company_bio_id] = (campaignsPerClient[cl.company_bio_id] ?? 0) + 1;
  }

  const profilesPerClient: Record<string, number> = {};
  const pendingProfilesPerClient: Record<string, number> = {};
  for (const p of allProfiles ?? []) {
    if (p.company_bio_id) {
      profilesPerClient[p.company_bio_id] = (profilesPerClient[p.company_bio_id] ?? 0) + 1;
      if (p.status === "pending") {
        pendingProfilesPerClient[p.company_bio_id] = (pendingProfilesPerClient[p.company_bio_id] ?? 0) + 1;
      }
    }
  }

  const pendingCampsPerClient: Record<string, number> = {};
  for (const cr of pendingCampRequests ?? []) {
    if (cr.company_bio_id) {
      pendingCampsPerClient[cr.company_bio_id] = (pendingCampsPerClient[cr.company_bio_id] ?? 0) + 1;
    }
  }

  // Build clients
  const clients: ClientData[] = (bios ?? []).map(b => ({
    id: b.id,
    company_name: b.company_name,
    industry: b.industry,
    location: b.location,
    logo_url: b.logo_url,
    leads: leadsPerClient[b.id] ?? 0,
    profiles: profilesPerClient[b.id] ?? 0,
    campaigns: campaignsPerClient[b.id] ?? 0,
    pendingProfiles: pendingProfilesPerClient[b.id] ?? 0,
    pendingCampaigns: pendingCampsPerClient[b.id] ?? 0,
  }));

  // Build pending approvals
  const pendingApprovals: PendingApproval[] = [
    ...(allProfiles ?? [])
      .filter(p => p.status === "pending")
      .map(p => ({
        id: p.id,
        type: "profile" as const,
        name: p.profile_name,
        clientName: bioMap[p.company_bio_id] ?? "Unknown",
        clientId: p.company_bio_id,
        subtitle: "ICP profile awaiting review",
        createdAt: p.created_at,
        href: `/admin/${p.company_bio_id}/profile/${p.id}`,
      })),
    ...(pendingCampRequests ?? []).map(cr => ({
      id: cr.id,
      type: "campaign" as const,
      name: cr.name,
      clientName: bioMap[cr.company_bio_id] ?? "Unknown",
      clientId: cr.company_bio_id,
      subtitle: `${cr.target_leads_count} ${cr.target_leads_count === 1 ? "lead" : "leads"} targeted`,
      createdAt: cr.created_at,
      href: `/admin/review/${cr.id}`,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Build execution pipeline
  const executionItems: ExecutionItem[] = (allProfiles ?? [])
    .filter(p => p.status === "approved" && p.execution_status && p.execution_status !== "done")
    .map(p => ({
      id: p.id,
      profileName: p.profile_name,
      clientName: bioMap[p.company_bio_id] ?? "Unknown",
      clientId: p.company_bio_id,
      status: p.execution_status ?? "not_started",
      leadsUploaded: p.leads_uploaded,
      createdAt: p.created_at,
      href: `/admin/${p.company_bio_id}/profile/${p.id}`,
    }))
    .sort((a, b) => {
      const order: Record<string, number> = { not_started: 0, in_progress: 1, uploaded: 2 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

  // Stats
  const stats = {
    totalClients: (bios ?? []).length,
    totalLeads: Object.values(leadsPerClient).reduce((s, v) => s + v, 0),
    pendingApprovals: pendingApprovals.length,
    activeCampaigns: activeCampaigns?.length ?? 0,
    executionPending: executionItems.length,
  };

  return { clients, pendingApprovals, executionItems, stats };
}

export default async function AdminPage() {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/");

  const data = await getData();
  return <AdminClient {...JSON.parse(JSON.stringify(data))} />;
}
