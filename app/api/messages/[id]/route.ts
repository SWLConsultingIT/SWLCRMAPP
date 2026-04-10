import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { content } = await request.json();

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  // Only allow editing pending messages (not sent ones)
  const { data: msg } = await supabase
    .from("campaign_messages")
    .select("id, status")
    .eq("id", id)
    .single();

  if (!msg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  if (msg.status === "sent") {
    return NextResponse.json({ error: "Cannot edit a sent message" }, { status: 403 });
  }

  const { error } = await supabase
    .from("campaign_messages")
    .update({ content: content.trim() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
