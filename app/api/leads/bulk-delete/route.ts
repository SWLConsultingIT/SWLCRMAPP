import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: NextRequest) {
  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }

  await supabase.from("lead_replies").delete().in("lead_id", ids);
  await supabase.from("campaign_messages").delete().in("lead_id", ids);
  await supabase.from("campaigns").delete().in("lead_id", ids);
  await supabase.from("lead_notes").delete().in("lead_id", ids);

  const { error } = await supabase.from("leads").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: ids.length });
}
