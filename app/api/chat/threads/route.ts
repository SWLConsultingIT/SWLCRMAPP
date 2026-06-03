// Chat threads for the current user. GET lists my threads (with the other
// party's name for DMs, last message + unread count); POST starts a DM
// (find-or-create) or a named channel. Tenant-scoped.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

async function nameOf(svc: ReturnType<typeof getSupabaseService>, userId: string): Promise<string> {
  try {
    const { data } = await svc.auth.admin.getUserById(userId);
    const m = data?.user?.user_metadata ?? {};
    return (m.full_name as string) ?? (m.display_name as string) ?? (m.name as string)
      ?? (data?.user?.email as string | undefined)?.split("@")[0] ?? "Teammate";
  } catch { return "Teammate"; }
}

export async function GET() {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ threads: [] });
  const svc = getSupabaseService();

  const { data: myParts } = await svc.from("chat_participants").select("thread_id, last_read_at").eq("user_id", scope.userId);
  const threadIds = (myParts ?? []).map(p => p.thread_id);
  if (threadIds.length === 0) return NextResponse.json({ threads: [] });
  const lastReadByThread = new Map((myParts ?? []).map(p => [p.thread_id, p.last_read_at as string | null]));

  const [{ data: threads }, { data: allParts }, { data: msgs }] = await Promise.all([
    svc.from("chat_threads").select("id, kind, title, created_at").in("id", threadIds),
    svc.from("chat_participants").select("thread_id, user_id").in("thread_id", threadIds),
    svc.from("chat_messages").select("thread_id, sender_id, sender_name, body, created_at").in("thread_id", threadIds).order("created_at", { ascending: false }).limit(500),
  ]);

  // Resolve names for all distinct participant users once.
  const userIds = Array.from(new Set((allParts ?? []).map(p => p.user_id)));
  const nameMap = new Map<string, string>();
  await Promise.all(userIds.map(async uid => { nameMap.set(uid, await nameOf(svc, uid)); }));

  const partsByThread = new Map<string, string[]>();
  (allParts ?? []).forEach(p => { const a = partsByThread.get(p.thread_id) ?? []; a.push(p.user_id); partsByThread.set(p.thread_id, a); });

  const lastByThread = new Map<string, { body: string; created_at: string; sender_name: string | null }>();
  const unreadByThread = new Map<string, number>();
  (msgs ?? []).forEach(m => {
    if (!lastByThread.has(m.thread_id)) lastByThread.set(m.thread_id, { body: m.body, created_at: m.created_at, sender_name: m.sender_name });
    const lr = lastReadByThread.get(m.thread_id);
    const unread = m.sender_id !== scope.userId && (!lr || new Date(m.created_at) > new Date(lr));
    if (unread) unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) ?? 0) + 1);
  });

  const out = (threads ?? []).map(t => {
    const members = (partsByThread.get(t.id) ?? []).map(uid => ({ userId: uid, name: nameMap.get(uid) ?? "Teammate" }));
    const others = members.filter(m => m.userId !== scope.userId);
    const title = t.kind === "dm" ? (others[0]?.name ?? "Direct message") : (t.title ?? "Channel");
    return {
      id: t.id, kind: t.kind, title, members,
      lastMessage: lastByThread.get(t.id) ?? null,
      unread: unreadByThread.get(t.id) ?? 0,
    };
  });
  out.sort((a, b) => new Date(b.lastMessage?.created_at ?? 0).getTime() - new Date(a.lastMessage?.created_at ?? 0).getTime());
  return NextResponse.json({ threads: out });
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ error: "No tenant" }, { status: 400 });
  const bioId = scope.companyBioId;

  const { kind, userIds, title } = await req.json().catch(() => ({}));
  const others = Array.isArray(userIds) ? userIds.filter((x: unknown): x is string => typeof x === "string" && x !== scope.userId) : [];
  if (kind !== "dm" && kind !== "channel") return NextResponse.json({ error: "kind must be dm|channel" }, { status: 400 });
  if (others.length === 0) return NextResponse.json({ error: "Pick at least one teammate" }, { status: 400 });

  const svc = getSupabaseService();
  // Validate every target is a member of this tenant.
  const { data: members } = await svc.from("user_company_memberships").select("user_id").eq("company_bio_id", bioId).in("user_id", others);
  const validIds = new Set((members ?? []).map(m => m.user_id));
  const targets = others.filter(id => validIds.has(id));
  if (targets.length === 0) return NextResponse.json({ error: "No valid teammates" }, { status: 400 });

  // DM dedupe: reuse an existing 1:1 thread between me and the target.
  if (kind === "dm") {
    const target = targets[0];
    const { data: mine } = await svc.from("chat_participants").select("thread_id").eq("user_id", scope.userId);
    const myThreadIds = (mine ?? []).map(m => m.thread_id);
    if (myThreadIds.length) {
      const { data: dmThreads } = await svc.from("chat_threads").select("id").eq("kind", "dm").in("id", myThreadIds);
      const dmIds = (dmThreads ?? []).map(t => t.id);
      if (dmIds.length) {
        const { data: targetParts } = await svc.from("chat_participants").select("thread_id").eq("user_id", target).in("thread_id", dmIds);
        const existing = (targetParts ?? [])[0]?.thread_id;
        if (existing) return NextResponse.json({ threadId: existing, existed: true });
      }
    }
  }

  const { data: thread, error: tErr } = await svc.from("chat_threads")
    .insert({ company_bio_id: bioId, kind, title: kind === "channel" ? (title?.trim() || "Channel") : null, created_by: scope.userId })
    .select("id").single();
  if (tErr || !thread) return NextResponse.json({ error: tErr?.message ?? "Failed" }, { status: 500 });

  const participantRows = Array.from(new Set([scope.userId, ...targets])).map(uid => ({ thread_id: thread.id, user_id: uid }));
  const { error: pErr } = await svc.from("chat_participants").insert(participantRows);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  return NextResponse.json({ threadId: thread.id, existed: false });
}
