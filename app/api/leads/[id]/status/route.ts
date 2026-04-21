import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

const VALID = ["new", "contacted", "qualified", "cold", "closed_lost", "closed_won"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status } = await req.json();
  if (!VALID.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const { error } = await supabase.from("leads").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
