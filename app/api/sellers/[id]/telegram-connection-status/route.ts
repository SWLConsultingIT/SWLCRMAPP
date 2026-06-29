import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(
    `${SB_URL}/rest/v1/sellers?id=eq.${id}&select=id,telegram_account_id&limit=1`,
    { headers: sbHeaders, cache: "no-store" }
  );
  const [seller] = await res.json().catch(() => []);
  if (!seller) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: !!seller.telegram_account_id });
}
