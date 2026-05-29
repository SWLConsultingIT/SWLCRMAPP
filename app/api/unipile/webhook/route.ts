// Unipile webhook handler — flips `sellers.unipile_account_id` when a seller
// finishes the Unipile-hosted-auth flow.
//
// Pre-2026-05-29 this endpoint was unauthenticated. Unipile sends `name`
// (the value we passed in the hosted-link request) and `account_id`; with
// the webhook URL, anyone could PATCH any seller's unipile_account_id to
// hijack the LinkedIn channel for that tenant.
//
// Auth: Unipile's hosted-auth API doesn't allow custom headers on the
// notification, so we sign the `name` field ourselves before sending — see
// lib/unipile-name-signing.ts. The signature is HMAC-SHA256(seller_id) with
// a shared secret, truncated to 16 hex chars and appended as
// `<seller_id>:<hmac>`. The webhook verifies on receive.
//
// Backwards-compat: when UNIPILE_WEBHOOK_SECRET is unset, both sign and
// verify become no-ops (loud log) so deploying this code doesn't break
// callbacks. Set the env var to activate enforcement.

import { NextRequest, NextResponse } from "next/server";
import { verifySellerName } from "@/lib/unipile-name-signing";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

type UnipileNotify = {
  status?: string;
  account_id?: string;
  name?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as UnipileNotify;
  const verify = verifySellerName(body.name);

  if (!verify.valid) {
    console.warn("[unipile-webhook] rejected:", verify.reason);
    return NextResponse.json({ error: "invalid name" }, { status: 401 });
  }
  if (verify.mode === "no-secret") {
    console.warn("[unipile-webhook] UNIPILE_WEBHOOK_SECRET unset — accepting unsigned name");
  } else if (verify.mode === "legacy") {
    // Unsigned name during the rollout window. Accept but log — after old
    // hosted-link sessions expire (30 min from /api/unipile/hosted-link
    // creation), every legitimate callback should be 'verified'. Anything
    // still arriving as 'legacy' after that is suspicious; flip this branch
    // to reject when ready.
    console.warn("[unipile-webhook] accepted legacy unsigned name (rollout window)");
  }

  const sellerId = verify.sellerId;
  const accountId = body.account_id;
  if (!accountId) {
    return NextResponse.json({ error: "missing account_id" }, { status: 400 });
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
