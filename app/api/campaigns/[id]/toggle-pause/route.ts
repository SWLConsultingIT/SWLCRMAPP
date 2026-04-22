import { getSupabaseService } from "@/lib/supabase-service";
import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseService();
  const { id } = await params;
  const { data: campaign } = await supabase.from("campaigns").select("status").eq("id", id).single();
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const newStatus = campaign.status === "paused" ? "active" : "paused";
  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "paused") update.paused_until = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  else update.paused_until = null;

  const { error } = await supabase.from("campaigns").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, newStatus });
}
