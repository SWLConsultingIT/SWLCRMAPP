import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_STATUSES = ["not_started", "in_progress", "uploaded", "completed"] as const;
type ExecStatus = typeof ALLOWED_STATUSES[number];

export async function POST(req: NextRequest) {
  const { id, status, leads_uploaded } = await req.json();
  if (!id || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Missing or invalid id/status" }, { status: 400 });
  }
  const patch: Record<string, unknown> = { execution_status: status as ExecStatus };
  if (status === "uploaded" || status === "completed") {
    patch.executed_at = new Date().toISOString();
  }
  if (typeof leads_uploaded === "number" && leads_uploaded >= 0) {
    patch.leads_uploaded = leads_uploaded;
  }
  const supabase = getSupabaseService();
  const { error } = await supabase.from("icp_profiles").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
