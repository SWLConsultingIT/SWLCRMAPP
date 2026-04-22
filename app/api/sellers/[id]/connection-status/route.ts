import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const UNIPILE_KEY = process.env.UNIPILE_API_KEY!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

type Seller = {
  id: string;
  name: string;
  unipile_account_id: string | null;
  created_at: string;
};

type UnipileAccount = {
  id: string;
  name: string;
  type: string;
  created_at: string;
  sources?: Array<{ status: string }>;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Fetch this seller
  const sellerRes = await fetch(
    `${SB_URL}/rest/v1/sellers?id=eq.${id}&select=id,name,unipile_account_id,created_at&limit=1`,
    { headers: sbHeaders, cache: "no-store" }
  );
  const [seller] = (await sellerRes.json().catch(() => [])) as Seller[];
  if (!seller) return NextResponse.json({ connected: false, found: false });

  // 2. Already linked → done
  if (seller.unipile_account_id) {
    return NextResponse.json({
      connected: true,
      accountId: seller.unipile_account_id,
      name: seller.name,
      found: true,
    });
  }

  // 3. Try auto-linking: look at Unipile for an account created after the seller
  //    that isn't linked to any other seller yet.
  const [upRes, linkedRes] = await Promise.all([
    fetch(`https://${UNIPILE_DSN}/api/v1/accounts`, {
      headers: { "X-API-KEY": UNIPILE_KEY },
      cache: "no-store",
    }),
    fetch(`${SB_URL}/rest/v1/sellers?select=unipile_account_id&unipile_account_id=not.is.null`, {
      headers: sbHeaders,
      cache: "no-store",
    }),
  ]);

  if (!upRes.ok) {
    return NextResponse.json({ connected: false, found: true });
  }

  const { items = [] } = (await upRes.json()) as { items: UnipileAccount[] };
  const linked = (await linkedRes.json().catch(() => [])) as Array<{ unipile_account_id: string }>;
  const linkedSet = new Set(linked.map(s => s.unipile_account_id));

  const sellerCreated = new Date(seller.created_at).getTime();
  const candidate = items
    .filter(a => a.type === "LINKEDIN")
    .filter(a => !linkedSet.has(a.id))
    .filter(a => new Date(a.created_at).getTime() >= sellerCreated - 60_000) // small tolerance
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))[0];

  if (!candidate) {
    return NextResponse.json({ connected: false, found: true });
  }

  // 4. Auto-link it
  await fetch(`${SB_URL}/rest/v1/sellers?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ unipile_account_id: candidate.id, updated_at: new Date().toISOString() }),
  });

  return NextResponse.json({
    connected: true,
    accountId: candidate.id,
    name: candidate.name,
    found: true,
    autoLinked: true,
  });
}
