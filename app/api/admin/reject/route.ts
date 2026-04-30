import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { NextRequest, NextResponse } from "next/server";

// Handles simple status updates for admin approval workflows.
// Campaign request APPROVAL goes through /api/campaigns/approve (creates campaigns).
// Everything else (ICP approve/reject, campaign reject) routes through here.

const ALLOWED_STATUSES = ["approved", "rejected"] as const;
const ALLOWED_TABLES = ["icp_profiles", "campaign_requests"] as const;

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { id, table, status } = await req.json();
  if (!id || !ALLOWED_TABLES.includes(table) || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Missing or invalid id/table/status" }, { status: 400 });
  }
  const supabase = getSupabaseService();

  // Rejected campaign_requests are HARD-DELETED rather than left as
  // status='rejected'. Reason: the campaign detail UI looks up template
  // prompts via `name` (multiple drafts can share a name), and a stale
  // rejected row was rendering its (rejected) note in place of the
  // approved version. Deleting on reject removes that whole class of
  // ghost-data bugs. ICP profile rejections still soft-flip — those keep
  // their rejection trail because leads/usage may already reference them.
  if (table === "campaign_requests" && status === "rejected") {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const { error } = await supabase.from(table).update({ status }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
