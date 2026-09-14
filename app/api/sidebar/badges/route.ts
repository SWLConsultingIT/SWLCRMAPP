// Batched counts for the left-rail badges. Previously the Sidebar fired
// 4 independent count queries against Supabase from the browser every 5min
// per user. Batching them into a single server-side endpoint:
//   - cuts request count 4× (4 → 1)
//   - lets us scope by tenant once instead of relying on RLS to filter the
//     4 separate count() calls
//   - returns a stable shape so the client just renders.
//
// Counts returned:
//   - calls:  active call-channel campaigns awaiting a dial
//   - pending: union of ICP profiles awaiting review/execution + campaigns
//              awaiting approval (the "stuff that needs my attention" rollup
//              that drives the Pending sidebar badge)
//   - teamChat: unread internal-chat messages. Team Chat used to live as a tab
//              inside /queue, where QueueClient polled the whole
//              /api/chat/threads payload every 25s just to light a dot. Now
//              that it is its own sidebar section the count rides along here:
//              same signal, one fewer poll, and no name resolution per user.

import { NextResponse } from "next/server";
import { getSupabaseService } from "@/integrations/supabase/service";
import { getUserScope } from "@/shared/auth/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ calls: 0, pending: 0, pendingReplies: 0, teamChat: 0 });
  }
  const userId = scope.userId;

  const svc = getSupabaseService();
  const scopedBio = scope.isScoped ? scope.companyBioId : null;

  // ICP profile IDs owned by this tenant — needed to scope the
  // campaign_requests count, which doesn't have a direct company_bio_id
  // column (joins through icp_profile_id).
  let scopedProfileIds: string[] | null = null;
  if (scopedBio) {
    const { data } = await svc.from("icp_profiles").select("id").eq("company_bio_id", scopedBio);
    scopedProfileIds = (data ?? []).map(r => r.id as string);
  }

  // All 4 counts in parallel. head:true + count:exact returns no rows.
  const callQ = svc.from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("channel", "call");
  if (scopedBio) callQ.eq("company_bio_id", scopedBio);

  const pendingReviewQ = svc.from("icp_profiles")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (scopedBio) pendingReviewQ.eq("company_bio_id", scopedBio);

  const pendingExecQ = svc.from("icp_profiles")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved")
    .in("execution_status", ["not_started", "in_progress"]);
  if (scopedBio) pendingExecQ.eq("company_bio_id", scopedBio);

  const pendingCampsQ = svc.from("campaign_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review");
  if (scopedProfileIds) {
    pendingCampsQ.in(
      "icp_profile_id",
      scopedProfileIds.length > 0 ? scopedProfileIds : ["00000000-0000-0000-0000-000000000000"]
    );
  }

  // Inbox: replies still in pending review (those the Inbox surface highlights
  // under "Unread / Needs review"). Joined through leads so tenant scoping is
  // safe; head-only so no rows download.
  let pendingRepliesQ = svc.from("lead_replies")
    .select("id, leads!inner(company_bio_id, status)", { count: "exact", head: true })
    .or("review_status.eq.pending,requires_human_review.eq.true")
    .neq("classification", "auto_reply")
    .not("leads.status", "in", "(closed_lost,qualified,closed_won)");
  if (scopedBio) pendingRepliesQ = pendingRepliesQ.eq("leads.company_bio_id", scopedBio);

  const [calls, pendingReview, pendingExec, pendingCamps, pendingReplies, teamChat] = await Promise.all([
    callQ, pendingReviewQ, pendingExecQ, pendingCampsQ, pendingRepliesQ, countUnreadChat(svc, userId, scopedBio),
  ]);

  return NextResponse.json({
    calls: calls.count ?? 0,
    pending: (pendingReview.count ?? 0) + (pendingExec.count ?? 0) + (pendingCamps.count ?? 0),
    pendingReplies: pendingReplies.count ?? 0,
    teamChat,
  });
}

// Unread internal-chat messages for this user, in the tenant they are
// currently viewing. Unread is per-thread (messages newer than my
// last_read_at, sent by somebody else), so this can't be a head-only count;
// it mirrors the arithmetic in /api/chat/threads but skips the parts that
// endpoint needs only for rendering (display names, companies, last message).
//
// Tenant scoping matters here for the same reason it does there: a
// super_admin accumulates DMs across tenants, and a badge that summed all of
// them would show Pathway's unread count while viewing SWL.
async function countUnreadChat(
  svc: ReturnType<typeof getSupabaseService>,
  userId: string,
  scopedBio: string | null,
): Promise<number> {
  const { data: myParts } = await svc
    .from("chat_participants")
    .select("thread_id, last_read_at")
    .eq("user_id", userId);
  const threadIds = (myParts ?? []).map(p => p.thread_id as string);
  if (threadIds.length === 0) return 0;

  let threadQ = svc.from("chat_threads").select("id").in("id", threadIds);
  if (scopedBio) threadQ = threadQ.or(`company_bio_id.is.null,company_bio_id.eq.${scopedBio}`);
  const { data: threads } = await threadQ;
  const visible = new Set((threads ?? []).map(t => t.id as string));
  if (visible.size === 0) return 0;

  const lastRead = new Map(
    (myParts ?? []).map(p => [p.thread_id as string, p.last_read_at as string | null]),
  );
  const { data: msgs } = await svc
    .from("chat_messages")
    .select("thread_id, sender_id, created_at")
    .in("thread_id", Array.from(visible))
    .order("created_at", { ascending: false })
    .limit(500);

  let unread = 0;
  for (const m of (msgs ?? []) as { thread_id: string; sender_id: string; created_at: string }[]) {
    if (m.sender_id === userId) continue;
    const lr = lastRead.get(m.thread_id);
    if (!lr || new Date(m.created_at) > new Date(lr)) unread += 1;
  }
  return unread;
}
