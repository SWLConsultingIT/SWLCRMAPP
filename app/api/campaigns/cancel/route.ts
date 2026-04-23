import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

type Action = "pause" | "resume" | "cancel";

export async function POST(req: NextRequest) {
  const { ids, action } = await req.json() as { ids: string[]; action: Action };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (!["pause", "resume", "cancel"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const svc = getSupabaseService();

  if (action === "cancel") {
    await svc.from("campaign_messages").delete().in("campaign_id", ids);
    await svc.from("lead_replies").delete().in("campaign_id", ids);
    const { error } = await svc.from("campaigns").delete().in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const status = action === "pause" ? "paused" : "active";
    const { error } = await svc.from("campaigns").update({ status }).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: ids.length, action });
}
