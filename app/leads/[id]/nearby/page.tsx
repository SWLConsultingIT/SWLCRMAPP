import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import NearbyCompaniesPage from "@/components/NearbyCompaniesPage";

// Gruppo Everest demo: a dedicated page listing the businesses around the
// plant — the "Opportunity 2: producer ↔ consumer energy match" view.
const EVEREST_BIO = "4ab610c8-e852-4b37-97d7-c41ba19b0d0e";

export default async function NearbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await getSupabaseServer();
  const { data } = await sb
    .from("leads")
    .select("id, company_bio_id, source, encrypted_payload, enrichment, company_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const [lead] = await hydrateClientLeads([data as any]);
  if ((lead as any).company_bio_id !== EVEREST_BIO) notFound(); // demo-only

  const enr = ((lead as any).enrichment ?? {}) as Record<string, unknown>;
  const nearby = Array.isArray(enr.nearby_companies) ? (enr.nearby_companies as any[]) : [];

  return (
    <NearbyCompaniesPage
      leadId={id}
      company={(lead as any).company_name ?? "the plant"}
      plantLat={typeof enr.rooftop_lat === "number" ? (enr.rooftop_lat as number) : null}
      plantLng={typeof enr.rooftop_lng === "number" ? (enr.rooftop_lng as number) : null}
      potenzaKw={typeof enr.cacer_potenza_kw === "number" ? (enr.cacer_potenza_kw as number) : null}
      initial={nearby}
    />
  );
}
