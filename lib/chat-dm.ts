// Shared team-chat helpers so a lead tag OR an @mention becomes an actual
// conversation in the Team Chat (boss 2026-06-09: "debería llegar… en el team
// chat con la persona que te taggeó"). One DM thread per user-pair — repeat
// tags/mentions reuse it and just append a message.

import { getSupabaseService } from "@/lib/supabase-service";

type Svc = ReturnType<typeof getSupabaseService>;

/** Find-or-create the single 1:1 DM thread between two users. Returns the
 *  thread id, or null if creation failed. */
export async function ensureDm(svc: Svc, bioId: string, me: string, other: string): Promise<string | null> {
  const { data: mine } = await svc.from("chat_participants").select("thread_id").eq("user_id", me);
  const myIds = (mine ?? []).map(m => m.thread_id);
  if (myIds.length) {
    const { data: dmThreads } = await svc.from("chat_threads").select("id").eq("kind", "dm").in("id", myIds);
    const dmIds = (dmThreads ?? []).map(t => t.id);
    if (dmIds.length) {
      const { data: shared } = await svc.from("chat_participants").select("thread_id").eq("user_id", other).in("thread_id", dmIds);
      const existing = (shared ?? [])[0]?.thread_id;
      if (existing) return existing;
    }
  }
  const { data: thread } = await svc.from("chat_threads").insert({ company_bio_id: bioId, kind: "dm", created_by: me }).select("id").single();
  if (!thread) return null;
  await svc.from("chat_participants").insert([{ thread_id: thread.id, user_id: me }, { thread_id: thread.id, user_id: other }]);
  return thread.id;
}

/** Post a message into a thread as `senderId` and mark it read for the sender
 *  (the recipient keeps it unread → drives their Team Chat dot + count). */
export async function postDmFromActor(svc: Svc, threadId: string, senderId: string, senderName: string, body: string): Promise<void> {
  await svc.from("chat_messages").insert({ thread_id: threadId, sender_id: senderId, sender_name: senderName, body });
  await svc.from("chat_participants").update({ last_read_at: new Date().toISOString() }).eq("thread_id", threadId).eq("user_id", senderId);
}
