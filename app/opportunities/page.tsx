import { redirect } from "next/navigation";

// The standalone Opportunities LIST duplicated the Results "Won" tab (same
// derivation from lead_replies + Odoo transfers). Consolidated into /results
// so there's a single home for lead outcomes. The DETAIL page
// (/opportunities/[id]) stays untouched — it owns the unique Stage / Notes /
// Next-Action editor and the Send-to-Odoo panel.
export const dynamic = "force-dynamic";

export default function OpportunitiesPage() {
  redirect("/results?tab=won");
}
