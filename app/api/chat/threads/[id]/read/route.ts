// Mark a chat thread read for the current user (sets last_read_at = now).
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const svc = getSupabaseService();
  await svc.from("chat_participants").update({ last_read_at: new Date().toISOString() }).eq("thread_id", id).eq("user_id", scope.userId);
  return NextResponse.json({ ok: true });
}
