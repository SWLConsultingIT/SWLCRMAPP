import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

export async function GET() {
  const res = await fetch(`${SB_URL}/rest/v1/app_settings?select=key,value`, {
    headers,
    cache: "no-store",
  });
  const rows = (await res.json().catch(() => [])) as Array<{ key: string; value: unknown }>;
  const settings: Record<string, unknown> = {};
  for (const r of rows) settings[r.key] = r.value;
  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const entries = Object.entries(body);
  if (entries.length === 0) {
    return NextResponse.json({ error: "No keys provided" }, { status: 400 });
  }

  for (const [key, value] of entries) {
    await fetch(`${SB_URL}/rest/v1/app_settings`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
  }

  return NextResponse.json({ ok: true });
}
