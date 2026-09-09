// Consolidated "My Activities" work view (P0). Server-fetches the caller's
// activities (tenant + ownership scoped in code — service client bypasses RLS),
// decrypts lead names once, and hands the enriched rows to the client board.

import AuroraHero from "@/components/AuroraHero";
import ActivitiesBoard, { type BoardActivity } from "@/components/ActivitiesBoard";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { getT } from "@/lib/i18n-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { ACTIVITY_SELECT, bucketActivity, type ActivityType, type ActivityStatus } from "@/lib/activities";

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
    let q = svc
      .from("activities")
      .select(`${ACTIVITY_SELECT}, leads(id, company_name, primary_first_name, primary_last_name, source, encrypted_payload, company_bio_id)`);
    if (scope.isScoped && scope.companyBioId) q = q.eq("company_bio_id", scope.companyBioId);
    if (wantScope === "mine") q = q.eq("assigned_to", scope.userId);
    const { data } = await q.order("due_at", { ascending: true, nullsFirst: false }).limit(1000);

    const raw = (data ?? []) as Array<Record<string, unknown> & { leads?: LeadEmbed | null }>;
    // Decrypt client-source lead PII once (multi-tenant aware).
    const leadObjs = raw.map(r => r.leads).filter(Boolean) as LeadEmbed[];
    const hydrated = await hydrateClientLeads(leadObjs);
    const byId = new Map<string, LeadEmbed>();
    for (const l of hydrated) if (l.id) byId.set(l.id, l);

    rows = raw.map(r => {
      const l = (r.leads?.id ? byId.get(r.leads.id) : null) ?? r.leads ?? null;
      const name = l ? `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() : "";
      const leadName = name || l?.company_name || t("activities.lead");
      return {
        id: r.id as string,
        lead_id: (r.lead_id as string | null) ?? null,
        type: r.type as ActivityType,
        title: r.title as string,
        description: (r.description as string | null) ?? null,
        assigned_to: (r.assigned_to as string | null) ?? null,
        due_at: (r.due_at as string | null) ?? null,
        status: r.status as ActivityStatus,
        priority: (r.priority as string | null) ?? null,
        source: (r.source as string) ?? "manual",
        leadName,
        company: l?.company_name ?? "",
      };
    });
  }

  const now = Date.now();
  const overdue = rows.filter(a => bucketActivity(a, now) === "overdue").length;
  const today = rows.filter(a => bucketActivity(a, now) === "today").length;
  const upcoming = rows.filter(a => bucketActivity(a, now) === "upcoming").length;

  return (
    <div className="p-6 w-full">
      <AuroraHero
        eyebrow="Growth Engine"
        title={t("activities.my.title")}
        subtitle={t("activities.none.hint")}
        kpis={[
          { label: t("activities.group.overdue"), value: String(overdue), tone: overdue > 0 ? "red" : "default" },
          { label: t("activities.group.today"), value: String(today), tone: "gold" },
          { label: t("activities.group.upcoming"), value: String(upcoming) },
        ]}
      />
      <ActivitiesBoard initial={rows} seesAll={seesAll} currentScope={wantScope} />
    </div>
  );
}
