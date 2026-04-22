import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leadIds = searchParams.get("leadIds");
  if (!leadIds) return NextResponse.json({ calls: [] });

  const ids = leadIds.split(",").map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ calls: [] });

  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("calls")
    .select("id, aircall_call_id, lead_id, direction, status, duration, phone_number, recording_url, transcript, notes, started_at, ended_at, classification, ai_confidence, ai_summary")
    .in("lead_id", ids)
    .order("started_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: data ?? [] });
}
