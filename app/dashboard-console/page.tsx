// /dashboard-console — Growth Engine, the approved six-tab design, on LIVE data.
//
// Was a mock with hand-measured constants. The components are unchanged; the
// numbers now come from lib/console-data.ts, which applies the same rules as
// every other surface — cohort replies, business timezone, and calls counted
// by canonical identity with Unknown always visible.
import type { Metadata } from "next";
import { getUserScope, getMyAssignedUserId } from "@/lib/scope";
import { getT } from "@/lib/i18n-server";
import AuroraHero from "@/components/AuroraHero";
import FreshnessChip from "@/components/dashboard/FreshnessChip";
import DashboardExportModal from "@/components/dashboard/DashboardExportModal";
import { loadConsoleSource, buildIndex, buildOverview, buildTabs } from "@/lib/console-data";
import Shell from "./Shell";

export const metadata: Metadata = {
  title: "Growth Engine — Dashboard",
  robots: { index: false, follow: false },
};

// A dashboard that can be stale is a dashboard nobody trusts.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const day = (d: Date) => new Date(d.getTime() - 180 * 60_000).toISOString().slice(0, 10);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const many = (k: string) => { const v = sp[k]; return v ? (Array.isArray(v) ? v : v.split(",")).filter(Boolean) : undefined; };

  const [scope, myAssignedUserId] = await Promise.all([
    getUserScope().catch(() => null),
    getMyAssignedUserId().catch(() => null),
  ]);
  const bioId = scope?.isScoped ? scope.companyBioId : null;

  const to = one("to") ?? day(new Date());
  const from = one("from") ?? day(new Date(Date.now() - 29 * 86_400_000));

  const filters = {
    from, to, bioId,
    assignedUserId: myAssignedUserId,
    campaignNames: many("campaigns"),
    icpIds: many("icps"),
    sellerIds: many("sellers"),
  };

  const [t, ix] = await Promise.all([getT(), (async () => buildIndex(await loadConsoleSource(bioId), filters))()]);
  const D = buildOverview(ix, filters);
  const T0 = buildTabs(ix);

  // The app's own hero and Download, unchanged — the console replaces the
  // charts below it, not the chrome above it.
  const nf = new Intl.NumberFormat("en-US");
  const hero = (
    <AuroraHero
      eyebrow={`${t("console.hero.section")} · ${D.period.range}`}
      title={t("console.hero.title")}
      subtitle={t("console.hero.desc")}
      // The four headline numbers, in the hero instead of a decorative
      // gradient. The connect rate is gold because it is the one that moved
      // when calls started being counted by physical identity.
      kpis={[
        { value: nf.format(D.funnel.stages[0].n), label: t("console.kpi.contacted") },
        { value: nf.format(D.funnel.stages[1].n), label: t("console.kpi.replied") },
        { value: nf.format(T0.teamHealth.calls), label: t("console.kpi.calls") },
        { value: `${T0.teamHealth.connectRate}%`, label: t("console.kpi.connect"), tone: "gold" as const },
      ]}
      actions={
        <>
          <FreshnessChip renderedAt={new Date().toISOString()} />
          <DashboardExportModal
            periodLabel={D.period.range}
            searchParams={{
              from: from ?? undefined,
              to: to ?? undefined,
              campaign: filters.campaignNames?.[0],
              seller: filters.sellerIds?.[0],
              icp: filters.icpIds?.[0],
            }}
          />
        </>
      }
    />
  );

  return <Shell D={D} T={T0} hero={hero} />;
}
