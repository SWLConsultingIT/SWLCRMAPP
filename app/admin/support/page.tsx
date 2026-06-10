import { requireAdminPage } from "@/lib/auth-admin";
import SupportInbox from "./SupportInbox";

export const dynamic = "force-dynamic";

// Support inbox — every help request submitted from the in-app Help menu lands
// here. super_admin only (cross-tenant); the gate redirects everyone else.
export default async function SupportPage() {
  await requireAdminPage();
  return <SupportInbox />;
}
