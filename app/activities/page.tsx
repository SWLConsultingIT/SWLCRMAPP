// Activities workspace page (block 4). Server-fetches ONLY the open (pending)
// work queue — never historical completed — enriches lead name / company /
// campaign in batch (no N+1), and hands it to the client workspace (List default,
// Board alternate). Tenant + ownership scoped in code (service client bypasses
// RLS). Completed history is loaded lazily later (block 11).

import AuroraHero from "@/components/AuroraHero";
import ActivitiesWorkspace from "@/components/ActivitiesWorkspace";
import type { BoardActivity } from "@/components/ActivitiesBoard";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { getT } from "@/lib/i18n-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { leadDisplayName } from "@/lib/lead-label";
import { ACTIVITY_SELECT, type ActivityType, type ActivityStatus } from "@/lib/activities";

export const dynamic = "force-dynamic";

type LeadEmbed = {
  id?: string;
  company_name?: string | null;
  primary_first_name?: string | null;
  primary_last_name?: string | null;
  source?: string | null;
  encrypted_payload?: unknown;
  company_bio_id?: string | null;
};

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const scope = await getUserScope();
  const seesAll = canViewAllTenantData(scope.tier);
  const wantScope: "mine" | "all" = sp.scope === "all" && seesAll ? "all" : "mine";

  let rows: BoardActivity[] = [];
  if (scope.userId) {
    const svc = getSupabaseService();
    // Work queue = OPEN only. Never fetch completed history here.
    let q = svc
      .from("activities")
      .select(`${ACTIVITY_SELECT}, leads(id, company_name, primary_first_name, primary_last_name, source, encrypted_payload, company_bio_id)`)
      .eq("status", "pending");
    if (scope.isScoped && scope.companyBioId) q = q.eq("company_bio_id", scope.companyBioId);
    if (wantScope === "mine") q = q.eq("assigned_to", scope.userId);
    const { data } = await q.order("due_at", { ascending: true, nullsFirst: false }).limit(1000);

    const raw = (data ?? []) as Array<Record<string, unknown> & { leads?: LeadEmbed | null }>;

    // Decrypt client-source lead PII once (multi-tenant aware).
    const leadObjs = raw.map(r => r.leads).filter(Boolean) as LeadEmbed[];
    const hydrated = await hydrateClientLeads(leadObjs);
    const byId = new Map<string, LeadEmbed>();
    for (const l of hydrated) if (l.id) byId.set(l.id, l);

    // Campaign per lead — ONE batch query, no N+1. Prefer an active/paused flow.
    const leadIds = Array.from(new Set(raw.map(r => (r.lead_id as string | null)).filter(Boolean))) as string[];
    const campaignByLead = new Map<string, string>();
    if (leadIds.length > 0) {
      const { data: camps } = await svc.from("campaigns").select("lead_id, name, status").in("lead_id", leadIds);
      for (const c of camps ?? []) {
        const lid = (c as { lead_id: string | null }).lead_id;
        if (!lid) continue;
        const name = (c as { name: string | null }).name;
        const status = (c as { status: string | null }).status;
        const existing = campaignByLead.get(lid);
        if (!existing || status === "active" || status === "paused") if (name) campaignByLead.set(lid, name);
      }
    }

    rows = raw.map(r => {
      const leadId = (r.lead_id as string | null) ?? null;
      const l = (r.leads?.id ? byId.get(r.leads.id) : null) ?? r.leads ?? null;
      return {
        id: r.id as string,
        lead_id: leadId,
        type: r.type as ActivityType,
        title: r.title as string,
        description: (r.description as string | null) ?? null,
        assigned_to: (r.assigned_to as string | null) ?? null,
        due_at: (r.due_at as string | null) ?? null,
        due_tz: (r.due_tz as string | null) ?? null,
        status: r.status as ActivityStatus,
        priority: (r.priority as string | null) ?? null,
        source: (r.source as string) ?? "manual",
        leadName: l ? leadDisplayName(l, t("activities.lead")) : t("activities.lead"),
        company: l?.company_name ?? "",
        campaign: leadId ? (campaignByLead.get(leadId) ?? null) : null,
      };
    });
  }

  return (
    <div className="p-6 w-full">
      <AuroraHero eyebrow="Growth Engine" title={t("activities.my.title")} subtitle={t("activities.none.hint")} />
      <ActivitiesWorkspace initial={rows} seesAll={seesAll} currentScope={wantScope} canAssignOthers={seesAll} />
    </div>
  );
}
