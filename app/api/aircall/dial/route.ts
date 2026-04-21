import { NextRequest, NextResponse } from "next/server";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");
const DEFAULT_NUMBER_ID = Number(process.env.AIRCALL_DEFAULT_NUMBER_ID);
const SB_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

export async function POST(req: NextRequest) {
  const { phone, leadId, sellerId, aircallUserId, numberId } = await req.json();
  if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 });

  const payload: Record<string, unknown> = {
    number_id: numberId ?? DEFAULT_NUMBER_ID,
    to: phone,
  };
  if (aircallUserId) payload.user_id = Number(aircallUserId);

  const res = await fetch("https://api.aircall.io/v1/calls", {
    method: "POST",
    headers: {
      Authorization: `Basic ${AIRCALL_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = await res.json();
  const callId = data.call?.id ?? null;

  if (leadId) {
    await fetch(`${SB_URL}/calls`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        aircall_call_id: callId,
        lead_id: leadId,
        seller_id: sellerId ?? null,
        direction: "outbound",
        status: "initiated",
        phone_number: phone,
        started_at: new Date().toISOString(),
      }),
    });
  }

  return NextResponse.json({ success: true, callId });
}
