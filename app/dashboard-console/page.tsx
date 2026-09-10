// /dashboard-console — Growth Engine, the approved six-tab design, on LIVE data.
//
// Was a mock with hand-measured constants. The components are unchanged; the
// numbers now come from lib/console-data.ts, which applies the same rules as
// every other surface — cohort replies, business timezone, and calls counted
// by canonical identity with Unknown always visible.
import type { Metadata } from "next";
import { getUserScope } from "@/lib/scope";
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

  const ix = buildIndex(await loadConsoleSource(bioId), filters);
  return <Shell D={buildOverview(ix, filters)} T={buildTabs(ix)} />;
}
