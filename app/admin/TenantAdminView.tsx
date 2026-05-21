import { Users, Building2, Megaphone, Phone } from "lucide-react";
import { getSupabaseService } from "@/lib/supabase-service";
import { C } from "@/lib/design";
import PageHero from "@/components/PageHero";
import Breadcrumb from "@/components/Breadcrumb";
import TenantTeamTab from "./TenantTeamTab";

// Per-tenant admin panel — what an `owner` or `manager` sees at /admin.
// Mirror of the SWL super_admin view (AdminClient) but scoped to a single
// tenant. No cross-tenant data, no SWL-only operational tools.

type Props = {
  tier: "owner" | "manager";
  companyBioId: string;
};

const gold = "var(--brand, #c9a83a)";

async function fetchTenantContext(companyBioId: string) {
  const svc = getSupabaseService();
  const [bioRes, profilesRes, sellersRes, campsRes] = await Promise.all([
    svc.from("company_bios").select("id, company_name, logo_url, created_at, aircall_number_ids, instantly_campaign_id").eq("id", companyBioId).maybeSingle(),
    svc.from("user_profiles").select("tier, last_seen_at").eq("company_bio_id", companyBioId),
    svc.from("sellers").select("id, active").eq("company_bio_id", companyBioId),
    svc.from("campaigns").select("id, status, leads!inner(company_bio_id)").eq("leads.company_bio_id", companyBioId).in("status", ["active", "paused"]),
  ]);

  const profiles = profilesRes.data ?? [];
  const tierCounts = profiles.reduce<Record<string, number>>((acc, p) => {
    const t = (p as { tier?: string }).tier ?? "viewer";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});

  // Pick the most recent last_seen_at across all team members for the
  // "active in last X" signal in the sidebar.
  const lastSeen = profiles
    .map((p) => (p as { last_seen_at?: string | null }).last_seen_at)
    .filter((v): v is string => !!v)
    .sort()
    .reverse()[0] ?? null;

  return {
    bio: bioRes.data,
    memberCount: profiles.length,
    tierCounts,
    sellerCount: (sellersRes.data ?? []).filter(s => (s as { active?: boolean }).active !== false).length,
    activeFlowCount: (campsRes.data ?? []).length,
    lastSeen,
  };
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default async function TenantAdminView({ tier, companyBioId }: Props) {
  const ctx = await fetchTenantContext(companyBioId);
  const tenantName = ctx.bio?.company_name ?? "Workspace";
  const canManage = tier === "owner";
  const ownerCount = ctx.tierCounts["owner"] ?? 0;
  const managerCount = ctx.tierCounts["manager"] ?? 0;
  const sellerCount = ctx.tierCounts["seller"] ?? 0;
  const viewerCount = ctx.tierCounts["viewer"] ?? 0;

  return (
    <div className="p-6 w-full">
      <Breadcrumb crumbs={[{ label: "Admin", href: "/admin" }, { label: tenantName }]} />

      <PageHero
        icon={Users}
        section="Workspace admin"
        title={tenantName}
        description={canManage
          ? "Manage your team and workspace resources."
          : "View your team. Read-only for managers."}
        accentColor={C.gold}
        status={{ label: tier === "owner" ? "Owner" : "Manager", active: true }}
      />

      {/* Quick stats row — gives the page weight + signals workspace health
          at a glance instead of dumping the seller straight into the team list. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile icon={Users} label="Members" value={ctx.memberCount} accent={gold}
          sub={`${ownerCount} owner${ownerCount === 1 ? "" : "s"} · ${managerCount} mgr · ${sellerCount} sellers${viewerCount > 0 ? ` · ${viewerCount} viewers` : ""}`} />
        <StatTile icon={Megaphone} label="Active flows" value={ctx.activeFlowCount} accent={C.green} />
        <StatTile icon={Phone} label="Sellers configured" value={ctx.sellerCount} accent={C.blue} />
        <StatTile icon={Building2} label="Last team activity" value={timeAgo(ctx.lastSeen)} accent={C.textBody} small />
      </div>

      {/* Team list full-width. Workspace sidebar removed — the bio metadata
          + quick links it surfaced are reachable from the global sidebar
          (/accounts, /company-bios, /settings) so duplicating them here was
          noise. Team management is the only thing this page exists for. */}
      <TenantTeamTab companyBioId={companyBioId} canManage={canManage} />
    </div>
  );
}

function StatTile({ icon: Icon, label, value, accent, sub, small }: {
  icon: typeof Users;
  label: string;
  value: number | string;
  accent: string;
  sub?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border px-4 py-3.5 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, var(--c-card) 0%, color-mix(in srgb, ${accent} 5%, var(--c-card)) 100%)`,
        borderColor: C.border,
        borderTop: `3px solid ${accent}`,
      }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={11} style={{ color: accent, opacity: 0.75 }} />
        <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{label}</span>
      </div>
      <p className={`${small ? "text-[15px]" : "text-[24px]"} font-bold leading-none tabular-nums`}
        style={{ color: accent, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] mt-1.5 leading-tight" style={{ color: C.textDim }}>{sub}</p>
      )}
    </div>
  );
}

