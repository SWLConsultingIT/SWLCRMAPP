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
    svc.from("leads").select("company_bio_id").in("company_bio_id", ids),
    svc.from("icp_profiles").select("company_bio_id").in("company_bio_id", ids),
    svc.from("campaigns").select("company_bio_id").in("company_bio_id", ids),
  ]);

  const count = (rows: { company_bio_id: string | null }[] | null, id: string) =>
    (rows ?? []).filter(r => r.company_bio_id === id).length;

  return bios.map(b => ({
    id: b.id,
    company_name: b.company_name,
    industry: b.industry,
    logo_url: b.logo_url,
    tagline: b.tagline,
    leads: count(leads, b.id),
    profiles: count(profiles, b.id),
    campaigns: count(campaigns, b.id),
  }));
}

export default async function DemosPage() {
  const scope = await getUserScope();
  if (scope.role !== "admin") redirect("/");

  const demos = await getDemos();
  return <DemosClient demos={demos} isInDemoMode={scope.isDemoMode} currentDemoBioId={scope.demoBioId} />;
}
