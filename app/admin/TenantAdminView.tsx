import { Users } from "lucide-react";
import { getSupabaseService } from "@/lib/supabase-service";
import { C } from "@/lib/design";
import PageHero from "@/components/PageHero";
import Breadcrumb from "@/components/Breadcrumb";
import TenantTeamTab from "./TenantTeamTab";

// Per-tenant admin panel — what an `owner` or `manager` sees at /admin.
// Mirror of the SWL super_admin view (AdminClient) but scoped to a single
// tenant. No cross-tenant data, no SWL-only operational tools.
//
// Only shows Team management today. Settings and Activity were placeholder
// tabs in an earlier draft but felt unfinished — removed until those
// sections are actually built.

type Props = {
  tier: "owner" | "manager";
  companyBioId: string;
};

async function fetchTenantContext(companyBioId: string) {
  const svc = getSupabaseService();
  const { data: bio } = await svc
    .from("company_bios")
    .select("id, company_name, logo_url")
    .eq("id", companyBioId)
    .maybeSingle();
  return bio;
}

export default async function TenantAdminView({ tier, companyBioId }: Props) {
  const bio = await fetchTenantContext(companyBioId);
  const tenantName = bio?.company_name ?? "Workspace";
  const canManage = tier === "owner";

  return (
    <div className="p-6 w-full max-w-6xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Admin", href: "/admin" }, { label: tenantName }]} />

      <PageHero
        icon={Users}
        section="Workspace admin"
        title={tenantName}
        description={canManage
          ? "Manage your team for this workspace."
          : "View your team for this workspace. Read-only for managers."}
        accentColor={C.gold}
        status={{ label: tier === "owner" ? "Owner" : "Manager", active: true }}
      />

      <TenantTeamTab companyBioId={companyBioId} canManage={canManage} />
    </div>
  );
}
