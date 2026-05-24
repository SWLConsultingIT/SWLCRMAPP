import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// POST /api/admin/reliability/retry-bulk
// Body: { messageIds: string[] }
// Flips every passed-in failed message back to queued. Used by the
// error-grouping panel on /admin/reliability to retry an entire bucket
// in one click instead of clicking 95 individual buttons after a
// dispatcher-side bug is fixed.
//
// Same metadata cleanup as the single-row retry — strip cooldown
// signals, record retried_at + retry_count.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { messageIds?: unknown };
  const messageIds = Array.isArray(body.messageIds)
    ? body.messageIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (messageIds.length === 0) {
    return NextResponse.json({ error: "messageIds[] required" }, { status: 400 });
  }
  // Hard cap to keep one POST from rewriting tens of thousands of rows.
  if (messageIds.length > 500) {
    return NextResponse.json({ error: "Maximum 500 messages per bulk retry" }, { status: 400 });
  }

  const svc = getSupabaseService();

  const { data: rows, error: readErr } = await svc
    .from("campaign_messages")
    .select("id, status, metadata")
    .in("id", messageIds);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const now = new Date().toISOString();
  let retried = 0;
  let skipped = 0;
  for (const row of rows ?? []) {
    if (row.status !== "failed") { skipped++; continue; }
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    delete meta.last_rate_limit_at;
    delete meta.last_rate_limit_reason;
    delete meta.failed_at;
    meta.retried_at = now;
    meta.retry_count = ((meta.retry_count as number) ?? 0) + 1;
    const { error: updErr } = await svc
      .from("campaign_messages")
      .update({ status: "queued", error_details: null, metadata: meta })
      .eq("id", row.id);
    if (!updErr) retried++; else skipped++;
  }

  return NextResponse.json({ ok: true, retried, skipped });
}
