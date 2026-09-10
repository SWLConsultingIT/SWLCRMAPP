// The Growth Engine dashboard.
//
// This is the six-tab console: Overview, ICPs, Campaigns, Channels, Sellers
// and Portfolio, on live data. The previous dashboard is still reachable at
// /dashboard-legacy — nothing was deleted, so reverting is deleting this
// file's body and re-exporting the legacy page instead.
//
// Next cannot re-export the route segment config, so `dynamic` and
// `revalidate` are declared here rather than forwarded.
import type { Metadata } from "next";
import ConsolePage from "./dashboard-console/page";

export const metadata: Metadata = { title: "Growth Engine — Dashboard" };

// A dashboard that can be stale is a dashboard nobody trusts.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default ConsolePage;
