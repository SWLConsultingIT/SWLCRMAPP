import { Users, Settings as SettingsIcon, Activity } from "lucide-react";
import { getSupabaseService } from "@/lib/supabase-service";
import { C } from "@/lib/design";
import PageHero from "@/components/PageHero";
import Breadcrumb from "@/components/Breadcrumb";
import TenantTeamTab from "./TenantTeamTab";

// Per-tenant admin panel — what an `owner` or `manager` sees at /admin.
// Mirror of the SWL super_admin view (AdminClient) but scoped to a single
// tenant. No cross-tenant data, no SWL-only operational tools.
//
// Tabs:
//   - Team: list users in the tenant, role badges, last seen. Owner can
//     invite + change role + remove. Manager sees read-only.
//   - Settings (placeholder for now — will host integrations + branding
//     references later).
//   - Activity (placeholder — recent campaigns / replies / call activity
//     within the tenant).
//
// Phase 1 ships only Team. Settings/Activity are tab stubs to anchor the
// shape; they wire up in a follow-up commit.

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
          ? "Manage your team, settings, and activity for this workspace."
          : "View your team and recent activity. Read-only for managers."}
        accentColor={C.gold}
        status={{ label: tier === "owner" ? "Owner" : "Manager", active: true }}
      />

      <div className="flex items-center gap-2 border-b mb-6" style={{ borderColor: C.border }}>
        <TabButton icon={Users} label="Team" active />
        <TabButton icon={SettingsIcon} label="Settings" disabled />
        <TabButton icon={Activity} label="Activity" disabled />
      </div>

      <TenantTeamTab companyBioId={companyBioId} canManage={canManage} />
    </div>
  );
}

function TabButton({
  icon: Icon, label, active = false, disabled = false,
}: { icon: any; label: string; active?: boolean; disabled?: boolean }) {
  return (
    <div
      className="px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 relative"
      style={{
        color: active ? C.textPrimary : disabled ? C.textDim : C.textMuted,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon size={13} />
      <span>{label}</span>
      {disabled && <span className="text-[9px] uppercase tracking-wider ml-1" style={{ color: C.textDim }}>soon</span>}
      {active && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: C.gold }} />}
    </div>
  );
}
