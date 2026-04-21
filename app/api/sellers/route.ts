import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function POST(req: NextRequest) {
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

  if (!payload.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const res = await fetch(`${SB_URL}/sellers`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data }, { status: res.status });
  return NextResponse.json({ ok: true, seller: data[0] });
}
