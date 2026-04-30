import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// POST /api/admin/reliability/retry
// Body: { messageId: string }
// Flips a failed campaign_message back to queued so the dispatcher can retry.
// Used for cases like LinkedIn's "already sent recently" block (Simon Lynch
// 2026-04-30) — the block clears in 2-3 weeks, after which a retry succeeds.
//
// Also clears `metadata.last_rate_limit_at` so the row isn't gated by the
// 4h rate-limit cooldown filter on the next dispatch tick.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (scope.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { messageId } = (await req.json().catch(() => ({}))) as { messageId?: string };
  if (!messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Read current metadata so we preserve any non-cooldown fields.
  const { data: existing, error: readErr } = await svc
    .from("campaign_messages")
    .select("status, metadata")
    .eq("id", messageId)
    .maybeSingle();
  if (readErr || !existing) {
    return NextResponse.json({ error: readErr?.message ?? "Not found" }, { status: 404 });
  }
  if (existing.status !== "failed") {
    return NextResponse.json({ error: `Cannot retry — current status is "${existing.status}"` }, { status: 400 });
  }

  const meta = (existing.metadata as Record<string, unknown> | null) ?? {};
  // Strip cooldown signals so the row is immediately eligible.
  delete meta.last_rate_limit_at;
  delete meta.last_rate_limit_reason;
  delete meta.failed_at;
  meta.retried_at = new Date().toISOString();
  meta.retry_count = ((meta.retry_count as number) ?? 0) + 1;

  const { error } = await svc
    .from("campaign_messages")
    .update({ status: "queued", error_details: null, metadata: meta })
    .eq("id", messageId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, messageId });
}
