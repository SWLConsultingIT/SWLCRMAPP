import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

// Handles simple status updates for admin approval workflows.
// Campaign request APPROVAL goes through /api/campaigns/approve (creates campaigns).
// Everything else (ICP approve/reject, campaign reject) routes through here.

const ALLOWED_STATUSES = ["approved", "rejected"] as const;
const ALLOWED_TABLES = ["icp_profiles", "campaign_requests"] as const;

export async function POST(req: NextRequest) {
  const { id, table, status } = await req.json();
  if (!id || !ALLOWED_TABLES.includes(table) || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Missing or invalid id/table/status" }, { status: 400 });
  }
  const supabase = getSupabaseService();
  const { error } = await supabase.from(table).update({ status }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
