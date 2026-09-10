// /dashboard-console — Growth Engine, the approved six-tab design, on LIVE data.
//
// Was a mock with hand-measured constants. The components are unchanged; the
// numbers now come from lib/console-data.ts, which applies the same rules as
// every other surface — cohort replies, business timezone, and calls counted
// by canonical identity with Unknown always visible.
import type { Metadata } from "next";
import { getUserScope } from "@/lib/scope";
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

  const scope = await getUserScope().catch(() => null);
  const bioId = scope?.isScoped ? scope.companyBioId : null;

  const to = one("to") ?? day(new Date());
  const from = one("from") ?? day(new Date(Date.now() - 29 * 86_400_000));

  const filters = {
    from, to, bioId,
    campaignNames: many("campaigns"),
    icpIds: many("icps"),
    sellerIds: many("sellers"),
  };

  const [t, ix] = await Promise.all([getT(), (async () => buildIndex(await loadConsoleSource(bioId), filters))()]);
  const D = buildOverview(ix, filters);

  // The app's own hero and Download, unchanged — the console replaces the
  // charts below it, not the chrome above it.
  const hero = (
    <AuroraHero
      eyebrow={t("dashx.hero.section")}
      title={t("dashx.hero.title")}
      subtitle={t("dashx.hero.desc")}
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

  return <Shell D={D} T={buildTabs(ix)} hero={hero} />;
}
