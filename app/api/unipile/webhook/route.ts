// Unipile webhook handler — flips `sellers.unipile_account_id` when a seller
// finishes the Unipile-hosted-auth flow.
//
// Pre-2026-05-29 this endpoint was unauthenticated. Unipile sends `name`
// (which we set to the seller.id) and `account_id` in the body; with the URL,
// anyone could PATCH any seller's unipile_account_id to point at their own
// Unipile account and intercept the entire LinkedIn channel for that tenant.
//
// Auth: require a Bearer token matching UNIPILE_WEBHOOK_SECRET. Unipile lets
// you configure custom webhook headers — set Authorization: Bearer <secret>
// in the Unipile dashboard for every webhook destination.
//
// Backwards-compat: if UNIPILE_WEBHOOK_SECRET is unset we still accept the
// request (matches the Aircall pattern in the sibling route) so deploying
// this code doesn't break Unipile callbacks the moment it ships. Loud log
// so the open channel is obvious in ops dashboards. SET THE ENV VAR + the
// dashboard header to actually close the P0.

import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const WEBHOOK_SECRET = process.env.UNIPILE_WEBHOOK_SECRET ?? "";

type UnipileNotify = {
  status?: string;
  account_id?: string;
  name?: string; // the seller.id we sent
};

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.warn("[unipile-webhook] UNIPILE_WEBHOOK_SECRET unset — accepting unsigned request");
  } else {
    const auth = req.headers.get("authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (presented !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = (await req.json()) as UnipileNotify;

  const sellerId = body.name;
  const accountId = body.account_id;

  if (!sellerId || !accountId) {
    return NextResponse.json({ error: "missing name or account_id" }, { status: 400 });
  }

  // Link the account_id to the seller that's waiting for it.
  const res = await fetch(`${SB_URL}/rest/v1/sellers?id=eq.${sellerId}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ unipile_account_id: accountId, updated_at: new Date().toISOString() }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "unipile-webhook" });
}
