"use client";

import { useEffect } from "react";
import { pushRecentLead } from "@/lib/recent-leads";
import { useAuthUser } from "@/lib/auth-context";

// Tiny mount-only side effect — records that the user just opened this lead
// so the sidebar's "Recent" list can offer one-click jump-back. Per-user
// scoped, so shared devices don't leak recent lead names between accounts.

export default function RecentLeadTracker({
  leadId,
  name,
  company,
}: {
  leadId: string;
  name: string;
  company: string | null;
}) {
  const authUser = useAuthUser();
  const userId = authUser?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    pushRecentLead(userId, { id: leadId, name, company });
  }, [userId, leadId, name, company]);
  return null;
}
