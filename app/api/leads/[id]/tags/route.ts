// Tag teammates on a lead (any tenant user, not just sellers). GET lists tagged
// users; POST tags one (and notifies them); DELETE removes a tag. Tenant-scoped
// via the lead's bio.

import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { createNotifications } from "@/lib/notify";
import { prettyDisplayName } from "@/lib/display-name";
import { NextRequest, NextResponse } from "next/server";

async function userName(svc: ReturnType<typeof getSupabaseService>, userId: string): Promise<string> {
  try {
    const { data } = await svc.auth.admin.getUserById(userId);
    return prettyDisplayName(data?.user?.user_metadata, data?.user?.email);
  } catch { return "Teammate"; }
}

async function actorName(): Promise<string> {
  try {
    const sb = await getSupabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const m = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return (m.full_name as string) ?? (m.display_name as string) ?? (m.name as string)
      ?? (user?.email as string | undefined)?.split("@")[0] ?? "A teammate";
  } catch { return "A teammate"; }
}

async function loadLead(svc: ReturnType<typeof getSupabaseService>, id: string) {
  const { data } = await svc.from("leads").select("company_bio_id, primary_first_name, primary_last_name, company_name").eq("id", id).maybeSingle();
  return data as { company_bio_id: string | null; primary_first_name: string | null; primary_last_name: string | null; company_name: string | null } | null;
}

// Find-or-create the single DM thread between two users (one per pair). Repeat
// tags of the same teammate reuse this thread — they just add another message.
async function ensureDm(svc: ReturnType<typeof getSupabaseService>, bioId: string, me: string, other: string): Promise<string | null> {
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ tags: [] });
  const { id } = await params;
  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead) return NextResponse.json({ tags: [] });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ tags: [] });

  const { data } = await svc
    .from("lead_tags")
    .select("user_id, reason, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: true });
  const tags = await Promise.all((data ?? []).map(async t => ({
    userId: t.user_id,
    name: await userName(svc, t.user_id),
    reason: t.reason ?? null,
  })));
  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { userId, reason } = await req.json().catch(() => ({}));
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const reasonText = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 280) : null;

  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead || !lead.company_bio_id) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await svc.from("lead_tags").upsert({
    lead_id: id, user_id: userId, company_bio_id: lead.company_bio_id, tagged_by: scope.userId, reason: reasonText,
  }, { onConflict: "lead_id,user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leadLabel = [lead.primary_first_name, lead.primary_last_name].filter(Boolean).join(" ") || lead.company_name || "a lead";
  const who = await actorName();

  // Open (or reuse) the 1:1 DM with this teammate and drop a message so the
  // tag becomes an actual conversation. Repeat tags reuse the same thread.
  const threadId = await ensureDm(svc, lead.company_bio_id, scope.userId, userId);
  if (threadId) {
    await svc.from("chat_messages").insert({
      thread_id: threadId,
      sender_id: scope.userId,
      sender_name: who,
      body: `🏷️ Tagged you on ${leadLabel}${reasonText ? `: ${reasonText}` : ""}\n→ /leads/${id}`,
    });
    await svc.from("chat_participants").update({ last_read_at: new Date().toISOString() }).eq("thread_id", threadId).eq("user_id", scope.userId);
  }

  // Notification points at the conversation so clicking it opens the DM.
  await createNotifications({
    companyBioId: lead.company_bio_id,
    recipientUserIds: [userId],
    actorUserId: scope.userId,
    actorName: who,
    type: "tag",
    leadId: id,
    body: `tagged you on ${leadLabel}${reasonText ? ` — ${reasonText}` : ""}`,
    link: threadId ? `/queue?tab=chat&thread=${threadId}` : `/leads/${id}`,
  });
  return NextResponse.json({ ok: true, threadId });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const svc = getSupabaseService();
  const lead = await loadLead(svc, id);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (scope.isScoped && lead.company_bio_id !== scope.companyBioId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await svc.from("lead_tags").delete().eq("lead_id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
