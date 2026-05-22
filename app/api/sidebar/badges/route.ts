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

import { NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ calls: 0, pending: 0 });
  }

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
    .select("id, leads!inner(company_bio_id)", { count: "exact", head: true })
    .or("review_status.eq.pending,requires_human_review.eq.true")
    .neq("classification", "autoreply");
  if (scopedBio) pendingRepliesQ = pendingRepliesQ.eq("leads.company_bio_id", scopedBio);

  const [calls, pendingReview, pendingExec, pendingCamps, pendingReplies] = await Promise.all([
    callQ, pendingReviewQ, pendingExecQ, pendingCampsQ, pendingRepliesQ,
  ]);

  return NextResponse.json({
    calls: calls.count ?? 0,
    pending: (pendingReview.count ?? 0) + (pendingExec.count ?? 0) + (pendingCamps.count ?? 0),
    pendingReplies: pendingReplies.count ?? 0,
  });
}
