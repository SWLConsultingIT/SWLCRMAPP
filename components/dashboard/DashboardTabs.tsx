"use client";

// Client-side tab switching for the dashboard.
//
// WHY THIS EXISTS
// The dashboard's six analytics tabs (Today · Overview · ICPs · Campaigns ·
// Channels · Sellers) all render from ONE `getDashboardData(filters)` result —
// the tab does not change a single query. But the tab lived in `?tab=`, and
// the page is `dynamic = "force-dynamic"` + `revalidate = 0`, so every tab
// click was a full server re-render: the entire workspace re-fetched and
// re-aggregated just to reveal markup that was already computable from data
// the browser had a second earlier.
//
// Measured on SWL Consulting (2026-08-25): 1860 leads, 1392 campaigns, 10 081
// campaign_messages, 236 replies. Because PostgREST caps every response at
// 1000 rows, `fetchAllRows` walks those sources page by page — ~19 SEQUENTIAL
// PostgREST round-trips per render, the messages source alone taking 11, each
// one a nested `campaign_messages → campaigns → leads` join. Then 196
// encrypted leads get decrypted and several O(n·m) passes run in JS. All of
// that, again, on every tab click.
//
// It also *felt* broken, not just slow: ChapterNav moves its highlight
// optimistically, while DimWhileLoading keys off `filterKey` — which
// deliberately excludes `?tab`. So for the seconds the server took, the new
// tab looked selected while the OLD tab's content stayed on screen, with no
// spinner anywhere.
//
// So: the server renders every panel once, and switching is local state.
// No refetch, no staleness, no loading state to design. Filter changes still
// navigate (they genuinely change the data), and Portfolio still navigates
// because it's the one tab with its own cross-tenant fetch.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** Tabs rendered from the shared `getDashboardData` result — switchable with
 *  zero server work. `portfolio` is deliberately NOT here: it has its own
 *  `getPortfolioComparison()` fetch and stays URL-driven. */
export const CLIENT_TABS = ["today", "overview", "icps", "campaigns", "channels", "sellers"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

export function isClientTab(id: string): id is ClientTab {
  return (CLIENT_TABS as readonly string[]).includes(id);
}

type TabCtxValue = { tab: string; setTab: (id: string) => void };

const TabCtx = createContext<TabCtxValue | null>(null);

/** Consumers outside the provider get an inert fallback rather than a crash —
 *  a dashboard that renders without tab switching still beats a blank page. */
export function useDashboardTab(): TabCtxValue {
  return useContext(TabCtx) ?? { tab: CLIENT_TABS[0], setTab: () => {} };
}

export function DashboardTabsProvider({
  initial,
  children,
}: {
  /** Server-parsed `?tab=` value, so deep links and refreshes land right. */
  initial: string;
  children: React.ReactNode;
}) {
  const [tab, setTabState] = useState(initial);

  // Adopt the server's value whenever it genuinely changes — i.e. a real
  // navigation happened (Portfolio, or a filter change that re-rendered the
  // page). Our own switches use replaceState, which leaves `initial` alone,
  // so this can't fight the local state.
  useEffect(() => { setTabState(initial); }, [initial]);

  const setTab = useCallback((id: string) => {
    setTabState(id);
    // Keep the URL truthful WITHOUT navigating. `router.replace` would re-run
    // the server component and refetch the whole workspace — the exact cost
    // this component exists to remove. replaceState also keeps the back
    // button behaving as it did before (the old code used router.replace,
    // which likewise added no history entry).
    //
    // Next patches pushState/replaceState so they sync with its Router, which
    // matters here: TabFilterBar rebuilds its URL from `useSearchParams()`, so
    // if the router never learned about the tab, changing a filter would drop
    // `?tab=` and bounce the user back to Today. Documented in
    // node_modules/next/dist/docs/01-app/01-getting-started/
    // 04-linking-and-navigating.md § Native History API — which is also where
    // the `replaceState(null, "", …)` signature comes from.
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (id === CLIENT_TABS[0]) params.delete("tab");
      else params.set("tab", id);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    } catch {
      // A malformed location or a sandbox that blocks history is not worth
      // breaking the tab switch over — the UI state already moved.
    }
  }, []);

  const value = useMemo(() => ({ tab, setTab }), [tab, setTab]);
  return <TabCtx.Provider value={value}>{children}</TabCtx.Provider>;
}

/** One tab's content. Mounted on first activation and kept alive after that.
 *
 *  Why lazy-mount instead of rendering all six hidden from the start: a chart
 *  that first lays out inside a `display:none` subtree measures 0px wide and
 *  stays collapsed when revealed (SVG/canvas + ResizeObserver both hit this).
 *  Mounting on first reveal means every panel lays out at its real width, and
 *  keeping it mounted afterwards makes every later switch instant. */
export function TabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  const { tab } = useDashboardTab();
  const on = tab === id;
  const [everOn, setEverOn] = useState(on);
  useEffect(() => { if (on) setEverOn(true); }, [on]);
  if (!everOn) return null;
  return <div style={{ display: on ? undefined : "none" }}>{children}</div>;
}

/** Page chrome that belongs to some tabs but not others (the two hero
 *  variants, the filter bar). Pass `include` OR `exclude`. */
export function TabChrome({
  include,
  exclude,
  children,
}: {
  include?: readonly string[];
  exclude?: readonly string[];
  children: React.ReactNode;
}) {
  const { tab } = useDashboardTab();
  const on = include ? include.includes(tab) : exclude ? !exclude.includes(tab) : true;
  return <div style={{ display: on ? undefined : "none" }}>{children}</div>;
}
