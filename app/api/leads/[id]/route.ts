import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Delete related data first (cascade manually for safety)
  await supabase.from("lead_replies").delete().eq("lead_id", id);
  await supabase.from("campaign_messages").delete().eq("lead_id", id);
  await supabase.from("campaigns").delete().eq("lead_id", id);
  await supabase.from("lead_notes").delete().eq("lead_id", id);

  const { error } = await supabase.from("leads").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
