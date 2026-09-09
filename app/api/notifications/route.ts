// In-app notification feed for the current user. GET lists my recent
// notifications (+ unread count); PATCH marks some/all of mine read.
// Recipient-scoped: a user only ever sees their own rows.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function GET(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ notifications: [], unread: 0, nextBefore: null });

  const svc = getSupabaseService();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);
  const before = sp.get("before");           // ISO created_at cursor (pagination)
  const type = sp.get("type");               // optional type filter
  const onlyUnread = sp.get("unread") === "1";

  let q = svc
    .from("notifications")
    .select("id, type, actor_name, lead_id, body, link, read_at, created_at")
    .eq("recipient_user_id", scope.userId);
  // Scope to the tenant the user is currently in: a tag/mention created in
  // Company B must not surface (or count as unread) while they're switched to
  // Company A. super_admin (no active scope) sees everything.
  if (scope.isScoped && scope.companyBioId) q = q.eq("company_bio_id", scope.companyBioId);
  if (type) q = q.eq("type", type);
  if (onlyUnread) q = q.is("read_at", null);
  if (before) q = q.lt("created_at", before);
  const { data } = await q.order("created_at", { ascending: false }).limit(limit + 1);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;
  const nextBefore = hasMore ? notifications[notifications.length - 1].created_at : null;

  // Accurate TOTAL unread (not just this page) for the bell badge + center.
  let uq = svc
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", scope.userId)
    .is("read_at", null);
  if (scope.isScoped && scope.companyBioId) uq = uq.eq("company_bio_id", scope.companyBioId);
  const { count } = await uq;

  return NextResponse.json({ notifications, unread: count ?? 0, nextBefore });
}

export async function PATCH(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const svc = getSupabaseService();
  const nowIso = new Date().toISOString();

  let q = svc.from("notifications").update({ read_at: nowIso }).eq("recipient_user_id", scope.userId).is("read_at", null);
  if (Array.isArray(body?.ids) && body.ids.length > 0) {
    q = q.in("id", body.ids.filter((x: unknown) => typeof x === "string"));
  } else if (!body?.all) {
    return NextResponse.json({ error: "Pass ids[] or all:true" }, { status: 400 });
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
