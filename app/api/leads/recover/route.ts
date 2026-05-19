import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Recover lost leads: reset status + archive their completed/failed campaigns.
// Uses service key to bypass RLS — necessary because super_admin has no tenant
// binding so browser-side updates are silently blocked by tenant-isolation policy.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.tier) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leadIds } = await req.json();
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds required" }, { status: 400 });
  }

  const [leadUpd, campUpd] = await Promise.all([
    supabase.from("leads").update({ status: "new", responded: false }).in("id", leadIds).select("id"),
    supabase.from("campaigns").update({ status: "archived" }).in("lead_id", leadIds).in("status", ["completed", "failed"]).select("id"),
  ]);

  if (leadUpd.error || campUpd.error) {
    return NextResponse.json({
      error: leadUpd.error?.message ?? campUpd.error?.message ?? "Recover failed",
    }, { status: 500 });
  }

  // Best-effort suppression cleanup
  await supabase.from("lead_suppressions").delete().in("lead_id", leadIds);

  return NextResponse.json({ ok: true, leadsUpdated: leadUpd.data?.length ?? 0, campaignsArchived: campUpd.data?.length ?? 0 });
}
