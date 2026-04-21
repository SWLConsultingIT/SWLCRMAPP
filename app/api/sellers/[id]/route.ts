import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const allowed = [
    "name", "active",
    "linkedin_account_id", "linkedin_daily_limit", "linkedin_connections_limit",
    "email_account", "email_daily_limit",
    "whatsapp_account", "whatsapp_daily_limit",
    "instagram_account", "telegram_account",
    "unipile_account_id", "call_daily_limit",
  ];
  const payload: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) payload[k] = body[k];

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  }

  const res = await fetch(`${SB_URL}/sellers?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${SB_URL}/sellers?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...H, Prefer: "return=minimal" },
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }
  return NextResponse.json({ ok: true });
}
