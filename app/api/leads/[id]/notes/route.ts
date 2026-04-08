// Requires Supabase table:
// create table lead_notes (
//   id uuid default gen_random_uuid() primary key,
//   lead_id uuid references leads(id) on delete cascade,
//   content text not null,
//   created_at timestamptz default now()
// );

import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { content } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: "Content required" }, { status: 400 });
  const { error } = await supabase.from("lead_notes").insert({ lead_id: id, content: content.trim() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("lead_notes")
    .select("id, content, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ notes: [] });
  return NextResponse.json({ notes: data ?? [] });
}
