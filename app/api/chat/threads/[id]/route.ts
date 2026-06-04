// DELETE a chat thread (conversation). Any participant can delete it; the
// FK cascades remove its messages + participant rows. Used by the trash button
// in the Team Chat panel header.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const svc = getSupabaseService();

  // Only a participant of this thread may delete it.
  const { data: part } = await svc
    .from("chat_participants")
    .select("user_id")
    .eq("thread_id", id)
    .eq("user_id", scope.userId)
    .maybeSingle();
  if (!part) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // chat_messages + chat_participants are ON DELETE CASCADE off chat_threads.
  const { error } = await svc.from("chat_threads").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
