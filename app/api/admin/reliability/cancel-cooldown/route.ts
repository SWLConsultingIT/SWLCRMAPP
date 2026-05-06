import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canViewSwlAdmin } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";

// POST /api/admin/reliability/cancel-cooldown
// Body: one of:
//   { messageId: string }
//   { messageIds: string[] }
//
// Strips `last_rate_limit_at` / `last_rate_limit_reason` / `paused_at` /
// `paused_by_admin` / `eligible_at` from metadata so the row is immediately
// eligible for the next dispatcher tick.
//
// Use cases:
//   - Admin paused a campaign and wants to resume it
//   - Cooldown was cascaded from a sibling 422 but admin knows the seller
//     can send (e.g. they verified manually that LinkedIn unblocked)
//   - Force a retry without waiting 4h
//
// Risk: clears the safety net we put in place for a reason. Don't expose
// this to non-admins.
export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!canViewSwlAdmin(scope.tier)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    messageId?: string;
    messageIds?: string[];
  };

  const ids = body.messageIds ?? (body.messageId ? [body.messageId] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "Provide messageId or messageIds" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { data: rows } = await svc
    .from("campaign_messages")
    .select("id, metadata")
    .in("id", ids);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "No matching messages" }, { status: 404 });
  }

  await Promise.all(rows.map((row: any) => {
    const meta = { ...((row.metadata as Record<string, unknown> | null) ?? {}) };
    delete meta.last_rate_limit_at;
    delete meta.last_rate_limit_reason;
    delete meta.paused_at;
    delete meta.paused_by_admin;
    delete meta.eligible_at;
    meta.cooldown_cancelled_at = new Date().toISOString();
    meta.cooldown_cancelled_by = scope.userId ?? "unknown";
    return svc.from("campaign_messages").update({ metadata: meta }).eq("id", row.id);
  }));

  return NextResponse.json({ ok: true, cleared: rows.length });
}
