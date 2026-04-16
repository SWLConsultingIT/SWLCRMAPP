import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

// POST — Create new account (seller)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, unipile_account_id, email_account, linkedin_daily_limit, email_daily_limit } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const { data, error } = await supabase.from("sellers").insert({
    name: name.trim(),
    unipile_account_id: unipile_account_id?.trim() || null,
    email_account: email_account?.trim() || null,
    linkedin_daily_limit: linkedin_daily_limit ?? 15,
    email_daily_limit: email_daily_limit ?? 50,
    active: true,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE — Deactivate account (soft delete)
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

  const { error } = await supabase.from("sellers").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
