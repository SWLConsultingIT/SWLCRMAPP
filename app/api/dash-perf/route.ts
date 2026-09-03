import { NextResponse } from "next/server";
import { getDashboardData, __dashPerf } from "@/lib/dashboard-data";
import { getUserScope } from "@/lib/scope";

// TEMPORARY diagnostic (dashboard perf attribution study). Runs getDashboardData
// with the default (no date filter) exactly as the dashboard does on load, and
// returns the per-phase timing breakdown as JSON — so we can read the numbers by
// opening a URL instead of hunting console logs in Vercel.
//
// Two runs: run1 = cold (first hit after deploy pays connection/RPC warmup),
// run2 = warm (what a normal repeat dashboard load actually sees). The breakdown
// reflects run2. This ONLY covers getDashboardData (fetch + JS aggregation +
// todayLists) — it does NOT include React render of the 5 tabs, which is the
// other half of the ~25-30s page. So: if run2_total is small but the page is
// still slow, the cost is the render, not the data layer.
//
// Delete this route once the attribution decision is made.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const scope = await getUserScope();
    if (!scope.userId) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const t1 = performance.now();
    await getDashboardData({ from: null, to: null });
    const run1_total_ms = Math.round(performance.now() - t1);

    const t2 = performance.now();
    await getDashboardData({ from: null, to: null });
    const run2_total_ms = Math.round(performance.now() - t2);
    // __dashPerf is reset at the start of each getDashboardData call, so it now
    // holds the breakdown of run2 (the warm run).
    const breakdown_run2 = [...__dashPerf];

    return NextResponse.json(
      {
        scope: { bioId: scope.isScoped ? scope.companyBioId : null, tier: scope.tier },
        run1_total_ms,
        run2_total_ms,
        note: "breakdown is getDashboardData only (fetch + aggregation) — NOT the React render of the 5 tabs.",
        breakdown_run2,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/dash-perf] failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "dash-perf failed" }, { status: 500 });
  }
}
