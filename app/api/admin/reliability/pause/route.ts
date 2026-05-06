import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// POST /api/admin/reliability/pause
// Body: one of:
//   { campaignId: string }  → pause every queued message of that campaign
//   { campaignName: string } → pause every queued message of every sibling campaign with that name
//   { messageIds: string[] } → pause only those rows
//
// "Pause" stamps a far-future cooldown (10 years) on metadata so the
// dispatcher's existing cooldown filter excludes the row indefinitely.
// We keep status='queued' (instead of inventing a 'paused' status) so the
// row stays in the same dashboard tile and an admin can un-pause via
// /cancel-cooldown without touching status.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    campaignId?: string;
    campaignName?: string;
    messageIds?: string[];
  };

  const svc = getSupabaseService();

  let targetIds: string[] = [];
  if (Array.isArray(body.messageIds) && body.messageIds.length > 0) {
    targetIds = body.messageIds;
  } else if (body.campaignId) {
    const { data } = await svc
      .from("campaign_messages")
      .select("id")
      .eq("campaign_id", body.campaignId)
      .eq("status", "queued");
    targetIds = (data ?? []).map((r: any) => r.id);
  } else if (body.campaignName) {
    const { data: campaigns } = await svc
      .from("campaigns")
      .select("id")
      .eq("name", body.campaignName);
    const cids = (campaigns ?? []).map((c: any) => c.id);
    if (cids.length > 0) {
      const { data } = await svc
        .from("campaign_messages")
        .select("id")
        .in("campaign_id", cids)
        .eq("status", "queued");
      targetIds = (data ?? []).map((r: any) => r.id);
    }
  } else {
    return NextResponse.json({ error: "Provide campaignId, campaignName, or messageIds" }, { status: 400 });
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ ok: true, paused: 0 });
  }

  const farFuture = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

  // Read existing metadata for each row so we don't blow away other fields
  // (rate_limit_count, eligible_at, etc.). Batch into a single round-trip
  // by reading then writing per-row in parallel.
  const { data: rows } = await svc
    .from("campaign_messages")
    .select("id, metadata")
    .in("id", targetIds);

  await Promise.all((rows ?? []).map((row: any) => {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    return svc.from("campaign_messages").update({
      metadata: {
        ...meta,
        paused_at: new Date().toISOString(),
        paused_by_admin: scope.userId ?? "unknown",
        last_rate_limit_at: farFuture,
        last_rate_limit_reason: "manual pause by admin",
      },
    }).eq("id", row.id);
  }));

  return NextResponse.json({ ok: true, paused: targetIds.length });
}
