import { redirect } from "next/navigation";

// `/calls` was an orphaned, broken duplicate of the call workflow that already
// lives in `/queue` (Pending Calls tab + History sub-tab, via QueueClient):
//   - nothing in the app links here (sidebar points at /queue);
//   - its cards rendered blank (query selected primary_* fields the component
//     read as first_name/company/etc — every field was undefined);
//   - its "Complete" button closed the campaign with NO outcome capture, so
//     positive→CRM / negative→closed_lost was silently skipped and dispositions
//     were lost;
//   - it queried call campaigns across ALL tenants with no scoping.
// The real, tenant-scoped, outcome-capturing flow is /queue?tab=calls, so this
// route now just redirects there. (The old CallsClient component is left in the
// tree unused — safe to delete in a separate cleanup.)
export default function CallsPage() {
  redirect("/queue?tab=calls");
}
