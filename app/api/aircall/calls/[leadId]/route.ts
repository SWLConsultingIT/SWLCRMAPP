import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uljoengwmmwdqpcxnbjs.supabase.co/rest/v1";
const SB_KEY = "sb_secret_o15e9PpjyvsiXJU77YyTxg_lJg60eXs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const res = await fetch(
    `${SB_URL}/calls?lead_id=eq.${leadId}&order=started_at.desc&select=*`,
    {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
      },
    }
  );
  const calls = await res.json();
  return NextResponse.json(Array.isArray(calls) ? calls : []);
}
