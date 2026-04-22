import { NextResponse } from "next/server";

const KEY = process.env.UNIPILE_API_KEY!;
const DSN = process.env.UNIPILE_DSN!;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

type UnipileAccount = {
  id: string;
  name: string;
  type: string;
  created_at: string;
  sources?: Array<{ status: string }>;
};

export async function GET() {
  const [upRes, sbRes] = await Promise.all([
    fetch(`https://${DSN}/api/v1/accounts`, {
      headers: { "X-API-KEY": KEY },
      cache: "no-store",
    }),
    fetch(`${SB_URL}/rest/v1/sellers?select=unipile_account_id&unipile_account_id=not.is.null`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }),
  ]);

  if (!upRes.ok) {
    return NextResponse.json({ error: `Unipile ${upRes.status}` }, { status: 500 });
  }

  const { items = [] } = (await upRes.json()) as { items: UnipileAccount[] };
  const linked = (await sbRes.json().catch(() => [])) as Array<{ unipile_account_id: string }>;
  const linkedSet = new Set(linked.map(s => s.unipile_account_id));

  const unlinked = items
    .filter(a => a.type === "LINKEDIN" && !linkedSet.has(a.id))
    .map(a => ({
      id: a.id,
      name: a.name,
      created_at: a.created_at,
      status: a.sources?.[0]?.status ?? "UNKNOWN",
    }))
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));

  return NextResponse.json({ accounts: unlinked });
}
