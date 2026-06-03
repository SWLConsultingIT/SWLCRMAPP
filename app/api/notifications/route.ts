// In-app notification feed for the current user. GET lists my recent
// notifications (+ unread count); PATCH marks some/all of mine read.
// Recipient-scoped: a user only ever sees their own rows.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function GET() {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ notifications: [], unread: 0 });

  const svc = getSupabaseService();
  const { data } = await svc
    .from("notifications")
    .select("id, type, actor_name, lead_id, body, link, read_at, created_at")
    .eq("recipient_user_id", scope.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const notifications = data ?? [];
  const unread = notifications.filter(n => !n.read_at).length;
  return NextResponse.json({ notifications, unread });
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
