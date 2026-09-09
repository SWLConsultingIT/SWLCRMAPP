// Web Push subscription management (P2b).
//   POST   → save/refresh this device's subscription for the current user.
//   DELETE → remove a subscription by endpoint (opt-out on this device).
// user_id + tenant come from the session, never the client.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sub = body?.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { error } = await svc.from("push_subscriptions").upsert(
    {
      company_bio_id: scope.isScoped ? scope.companyBioId : null,
      user_id: scope.userId,
      endpoint,
      p256dh,
      auth,
      ua: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  const svc = getSupabaseService();
  // Scope the delete to the caller so one user can't drop another's device.
  await svc.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", scope.userId);
  return NextResponse.json({ ok: true });
}
