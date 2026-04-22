import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

type UnipileNotify = {
  status?: string;
  account_id?: string;
  name?: string; // the seller.id we sent
};

export async function POST(req: NextRequest) {
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
