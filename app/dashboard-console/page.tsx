// /dashboard-console — the six-tab Diagnostic Console mock.
//
// TEMPORARY, for review. Delete this folder once a direction is approved.
// No query, no write, no import from the live dashboard: every figure is a
// literal in ./data.ts (Overview) or ./tabs-data.ts (the other five).
import type { Metadata } from "next";
import Shell from "./Shell";

export const metadata: Metadata = {
  title: "Dashboard — Diagnostic Console (mock)",
  robots: { index: false, follow: false },
};

export default function Page() { return <Shell />; }
