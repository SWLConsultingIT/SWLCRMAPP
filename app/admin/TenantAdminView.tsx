import { Users, Building2, Megaphone, Phone, Mail, Shield, ExternalLink } from "lucide-react";
import Link from "next/link";
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
    <div className="p-6 w-full max-w-7xl mx-auto">
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

      {/* Two-column layout: team (wide) + workspace sidebar (narrow). The
          sidebar holds workspace metadata + jump-links to the sub-admin
          areas (Sellers, Aircall, Instantly) so the page actually fills
          the width and the seller has clear "where to go next" options. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="min-w-0">
          <TenantTeamTab companyBioId={companyBioId} canManage={canManage} />
        </div>

        <aside className="space-y-4">
          {/* Workspace summary card */}
          <div className="rounded-2xl border overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>Workspace</p>
              <p className="text-sm font-bold mt-0.5" style={{ color: C.textPrimary }}>{tenantName}</p>
              {ctx.bio?.created_at && (
                <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
                  Created {new Date(ctx.bio.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              )}
            </div>
            <div className="px-5 py-3 space-y-2">
              <WorkspaceLine label="Aircall numbers"
                value={ctx.bio?.aircall_number_ids?.length
                  ? `${ctx.bio.aircall_number_ids.length} configured`
                  : "Not configured"}
                ok={!!ctx.bio?.aircall_number_ids?.length} />
              <WorkspaceLine label="Instantly campaign"
                value={ctx.bio?.instantly_campaign_id ? "Linked" : "Not linked"}
                ok={!!ctx.bio?.instantly_campaign_id} />
              <WorkspaceLine label="Active flows"
                value={`${ctx.activeFlowCount} running`}
                ok={ctx.activeFlowCount > 0} />
            </div>
          </div>

          {/* Quick links — jump-table to the sub-admin areas. Only visible
              for owners; managers get a read-only team list and that's it. */}
          {canManage && (
            <div className="rounded-2xl border overflow-hidden"
              style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
              <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>Quick links</p>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Configure resources for this workspace.</p>
              </div>
              <div className="py-1">
                <QuickLink href="/accounts" icon={Phone} label="Sellers & accounts"
                  hint="LinkedIn + Aircall mapping" />
                <QuickLink href="/company-bios" icon={Building2} label="Company bio"
                  hint="Branding, voice, services" />
                <QuickLink href="/settings" icon={Shield} label="Account settings"
                  hint="Your profile + preferences" />
              </div>
            </div>
          )}
        </aside>
      </div>
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

function WorkspaceLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px] py-1">
      <span style={{ color: C.textMuted }}>{label}</span>
      <span className="flex items-center gap-1 font-semibold"
        style={{ color: ok ? C.green : C.textDim }}>
        <span className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: ok ? C.green : C.textDim }} />
        {value}
      </span>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label, hint }: {
  href: string;
  icon: typeof Phone;
  label: string;
  hint: string;
}) {
  return (
    <Link href={href}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-black/[0.02] group">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: C.surface }}>
        <Icon size={13} style={{ color: C.textMuted }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold group-hover:underline" style={{ color: C.textPrimary }}>{label}</p>
        <p className="text-[10px]" style={{ color: C.textDim }}>{hint}</p>
      </div>
      <ExternalLink size={11} style={{ color: C.textDim, opacity: 0.5 }}
        className="group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}
