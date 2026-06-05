import { getSupabaseService } from "@/lib/supabase-service";

// Picks a connected LinkedIn account to view a profile through. Prefers the
// seller the lead is assigned to (leads.linkedin_assigned_account holds a
// name); otherwise any active seller in the tenant with a Unipile account
// (own or shared into the tenant).
export async function resolveUnipileAccount(
  svc: ReturnType<typeof getSupabaseService>,
  companyBioId: string,
  assignedName: string | null,
): Promise<string | null> {
  const { data: sellers } = await svc
    .from("sellers")
    .select("name, unipile_account_id, company_bio_id, shared_with_company_bio_ids, active")
    .eq("active", true)
    .or(`company_bio_id.eq.${companyBioId},shared_with_company_bio_ids.cs.{${companyBioId}}`);
  const rows = (sellers ?? []).filter((s: any) => s.unipile_account_id);
  if (rows.length === 0) return null;
  if (assignedName) {
    const match = rows.find((s: any) => (s.name ?? "").toLowerCase() === assignedName.toLowerCase());
    if (match) return match.unipile_account_id as string;
  }
  return rows[0].unipile_account_id as string;
}
