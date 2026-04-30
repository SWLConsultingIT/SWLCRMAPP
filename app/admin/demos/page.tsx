import { redirect } from "next/navigation";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import DemosClient from "./DemosClient";

export const dynamic = "force-dynamic";

export type DemoTenant = {
  id: string;
  company_name: string;
  industry: string | null;
  logo_url: string | null;
  tagline: string | null;
  leads: number;
  profiles: number;
  campaigns: number;
};

async function getDemos(): Promise<DemoTenant[]> {
  const svc = getSupabaseService();
  const { data: bios } = await svc
    .from("company_bios")
    .select("id, company_name, industry, logo_url, tagline, created_at")
    .eq("is_demo", true)
    .order("created_at", { ascending: false });

  if (!bios || bios.length === 0) return [];

  const ids = bios.map(b => b.id);
  const [{ data: leads }, { data: profiles }, { data: campaigns }] = await Promise.all([
    svc.from("leads").select("id, company_bio_id").in("company_bio_id", ids),
    svc.from("icp_profiles").select("company_bio_id").in("company_bio_id", ids),
    // campaigns has lead_id, not company_bio_id — join via leads.
    svc.from("campaigns")
      .select("id, lead_id, leads!inner(company_bio_id)")
      .in("leads.company_bio_id", ids),
  ]);

  const count = (rows: { company_bio_id: string | null }[] | null, id: string) =>
    (rows ?? []).filter(r => r.company_bio_id === id).length;

  // For campaigns, the bio_id lives on the joined `leads` row. supabase-js
  // returns it nested on each campaign as `leads: { company_bio_id }`.
  type CampaignRow = { id: string; lead_id: string | null; leads: { company_bio_id: string | null } | { company_bio_id: string | null }[] | null };
  const campaignBioId = (c: CampaignRow): string | null => {
    const l = c.leads;
    if (Array.isArray(l)) return l[0]?.company_bio_id ?? null;
    return l?.company_bio_id ?? null;
  };
  const countCampaigns = (id: string) =>
    ((campaigns ?? []) as unknown as CampaignRow[]).filter(c => campaignBioId(c) === id).length;

  return bios.map(b => ({
    id: b.id,
    company_name: b.company_name,
    industry: b.industry,
    logo_url: b.logo_url,
    tagline: b.tagline,
    leads: count(leads, b.id),
    profiles: count(profiles, b.id),
    campaigns: countCampaigns(b.id),
  }));
}

export default async function DemosPage() {
  const scope = await getUserScope();
  if (scope.role !== "admin") redirect("/");

  const demos = await getDemos();
  return <DemosClient demos={demos} isInDemoMode={scope.isDemoMode} currentDemoBioId={scope.demoBioId} />;
}
