// Messages in a chat thread. GET lists them (membership-gated); POST sends one,
// marks the sender read, and notifies the other participants.

import { getSupabaseServer } from "@/integrations/supabase/server";
import { getSupabaseService } from "@/integrations/supabase/service";
import { getUserScope } from "@/shared/auth/scope";
import { createNotifications } from "@/lib/notify";
import {
  CHAT_BUCKET, SIGN_TTL_SECONDS,
  messageHasContent, parseStoredAttachments, validateMessageAttachments,
  type ChatAttachment, type SignedChatAttachment,
} from "@/lib/chat-attachments";
import { NextRequest, NextResponse } from "next/server";

// Signs every attachment so the client can render it. The bucket is private:
// without this the image simply doesn't load. Signing happens on READ — a URL
// is never stored — so the link expires on its own and is worthless if pasted
// somewhere else hours later.
async function signAttachments(
  svc: ReturnType<typeof getSupabaseService>,
  rows: Array<{ attachments?: unknown }>,
): Promise<Map<number, SignedChatAttachment[]>> {
  const out = new Map<number, SignedChatAttachment[]>();
  const jobs: Array<{ row: number; att: ChatAttachment }> = [];
  rows.forEach((r, i) => {
    const list = parseStoredAttachments(r.attachments);
    if (list.length) { out.set(i, list.map(a => ({ ...a, url: null }))); list.forEach(att => jobs.push({ row: i, att })); }
  });
  if (!jobs.length) return out;

  const paths = Array.from(new Set(jobs.map(j => j.att.path)));
  const { data } = await svc.storage.from(CHAT_BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS);
  const byPath = new Map<string, string>();
  for (const d of data ?? []) if (d.path && d.signedUrl) byPath.set(d.path, d.signedUrl);

  for (const [i, list] of out) out.set(i, list.map(a => ({ ...a, url: byPath.get(a.path) ?? null })));
  return out;
}

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
    .select("id, sender_id, sender_name, body, created_at, attachments")
    .eq("thread_id", id).order("created_at", { ascending: true }).limit(300);

  const rows = data ?? [];
  const signed = await signAttachments(svc, rows);
  const messages = rows.map((m, i) => ({ ...m, attachments: signed.get(i) ?? [] }));
  return NextResponse.json({ messages, me: scope.userId });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { body, attachments: rawAttachments } = await req.json().catch(() => ({}));

  // The paths come from the client, so they are revalidated here: the tenant
  // guard on the path is what stops a message carrying another workspace's
  // screenshot from being posted and then read back through the signed URL.
  const checked = validateMessageAttachments(rawAttachments, scope.companyBioId);
  if (!checked.ok) return NextResponse.json({ error: checked.message, code: checked.code }, { status: 400 });
  const attachments = checked.attachments;

  // A lone screenshot is a valid message. Completely empty is not.
  if (!messageHasContent(body, attachments)) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  if ((body ?? "").length > 4000) return NextResponse.json({ error: "Too long" }, { status: 400 });

  const svc = getSupabaseService();
  if (!(await isMember(svc, id, scope.userId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const name = await senderName();
  const { data: msg, error } = await svc.from("chat_messages")
    .insert({
      thread_id: id,
      sender_id: scope.userId,
      sender_name: name,
      body: (body ?? "").trim(),
      attachments: attachments.length ? attachments : null,
    })
    .select("id, sender_id, sender_name, body, created_at, attachments").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const signedNew = await signAttachments(svc, [msg]);

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
      link: `/team-chat?thread=${id}`,
    });
  }
  return NextResponse.json({ message: { ...msg, attachments: signedNew.get(0) ?? [] } });
}
