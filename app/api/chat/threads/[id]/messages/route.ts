// Messages in a chat thread. GET lists them (membership-gated); POST sends one,
// marks the sender read, and notifies the other participants.

import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { createNotifications } from "@/lib/notify";
import { NextRequest, NextResponse } from "next/server";

async function isMember(svc: ReturnType<typeof getSupabaseService>, threadId: string, userId: string) {
  const { data } = await svc.from("chat_participants").select("user_id").eq("thread_id", threadId).eq("user_id", userId).maybeSingle();
  return !!data;
}

async function senderName(): Promise<string> {
  try {
    const sb = await getSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const m = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return (m.full_name as string) ?? (m.display_name as string) ?? (m.name as string)
      ?? (user?.email as string | undefined)?.split("@")[0] ?? "Teammate";
  } catch { return "Teammate"; }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ messages: [] });
  const { id } = await params;
  const svc = getSupabaseService();
  if (!(await isMember(svc, id, scope.userId))) return NextResponse.json({ messages: [] });

  const { data } = await svc.from("chat_messages")
    .select("id, sender_id, sender_name, body, created_at")
    .eq("thread_id", id).order("created_at", { ascending: true }).limit(300);
  return NextResponse.json({ messages: data ?? [], me: scope.userId });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { body } = await req.json().catch(() => ({}));
  if (!body?.trim()) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  if (body.length > 4000) return NextResponse.json({ error: "Too long" }, { status: 400 });

  const svc = getSupabaseService();
  if (!(await isMember(svc, id, scope.userId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const name = await senderName();
  const { data: msg, error } = await svc.from("chat_messages")
    .insert({ thread_id: id, sender_id: scope.userId, sender_name: name, body: body.trim() })
    .select("id, sender_id, sender_name, body, created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sender has implicitly read their own message.
  await svc.from("chat_participants").update({ last_read_at: new Date().toISOString() }).eq("thread_id", id).eq("user_id", scope.userId);

  // Notify the other participants.
  const [{ data: parts }, { data: thread }] = await Promise.all([
    svc.from("chat_participants").select("user_id").eq("thread_id", id),
    svc.from("chat_threads").select("company_bio_id, kind, title").eq("id", id).maybeSingle(),
  ]);
  const recipients = (parts ?? []).map(p => p.user_id).filter(uid => uid !== scope.userId);
  if (recipients.length && thread?.company_bio_id) {
    const where = thread.kind === "channel" && thread.title ? ` in ${thread.title}` : "";
    await createNotifications({
      companyBioId: thread.company_bio_id,
      recipientUserIds: recipients,
      actorUserId: scope.userId,
      actorName: name,
      type: "message",
      body: `messaged you${where}`,
      link: `/queue?tab=chat&thread=${id}`,
    });
  }
  return NextResponse.json({ message: msg });
}
