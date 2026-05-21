import { redirect } from "next/navigation";

// Legacy /campaigns/new landing was a second page that re-listed the Lead
// Miner profiles + "Custom Campaign" option — duplicating the New Flow tab
// inside /campaigns. Boss flagged it as redundant. Now this route is a
// thin redirect: it sends the seller straight to /campaigns?tab=new so the
// New Flow tab opens with a single navigation, no intermediate page.
//
// The real wizard routes (/campaigns/new/[profileId] and
// /campaigns/new/lead/[leadId]) live as siblings and still resolve
// independently — Next matches the more specific dynamic segment first.

export const dynamic = "force-dynamic";

export default function NewFlowRedirect() {
  redirect("/campaigns?tab=new");
}
