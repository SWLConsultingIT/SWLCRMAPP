import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

const KEY = process.env.UNIPILE_API_KEY!;
const DSN = process.env.UNIPILE_DSN!;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

function getBaseUrl(req: NextRequest) {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  const host = req.headers.get("host");
  if (!host) return "http://localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const { name, linkedin_daily_limit = 15, sellerId } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  // Resolve the acting user's company scope so the seller lands under the right tenant.
  const authSupabase = await getSupabaseServer();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("role, company_bio_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const companyBioId: string | null = profile?.company_bio_id ?? null;

  // 1. Resolve the target seller — either reuse an existing orphan (reconnect flow)
  //    or create a fresh one. Reusing avoids leaving zombie rows in Supabase when
  //    a client closes the Unipile popup before completing the login.
  let seller: { id: string; name: string };
  const isReconnect = typeof sellerId === "string" && sellerId.length > 0;

  if (isReconnect) {
    const { data: existing } = await svc
      .from("sellers")
      .select("id, name, unipile_account_id, company_bio_id")
      .eq("id", sellerId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }
    if (companyBioId && existing.company_bio_id && existing.company_bio_id !== companyBioId) {
      return NextResponse.json({ error: "Seller belongs to another tenant" }, { status: 403 });
    }
    if (existing.unipile_account_id) {
      return NextResponse.json({ error: "Seller already has Unipile linked" }, { status: 409 });
    }
    await fetch(`${SB_URL}/rest/v1/sellers?id=eq.${sellerId}`, {
      method: "PATCH",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        name: name.trim(),
        linkedin_daily_limit,
        updated_at: new Date().toISOString(),
      }),
    });
    seller = { id: existing.id, name: name.trim() };
  } else {
    const sellerRes = await fetch(`${SB_URL}/rest/v1/sellers`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        name: name.trim(),
        linkedin_daily_limit,
        active: true,
        company_bio_id: companyBioId,
      }),
    });
    if (!sellerRes.ok) {
      return NextResponse.json({ error: await sellerRes.text() }, { status: 500 });
    }
    [seller] = (await sellerRes.json()) as Array<{ id: string; name: string }>;
  }

  // 2. Ask Unipile for a hosted link
  const baseUrl = getBaseUrl(req);
  const expiresOn = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  const unipileRes = await fetch(`https://${DSN}/api/v1/hosted/accounts/link`, {
    method: "POST",
    headers: {
      "X-API-KEY": KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "create",
      providers: ["LINKEDIN"],
      api_url: `https://${DSN}`,
      expiresOn,
      name: seller.id, // we'll receive this back in the notify_url
      success_redirect_url: `${baseUrl}/accounts?connected=1`,
      failure_redirect_url: `${baseUrl}/accounts?connected=0`,
      notify_url: `${baseUrl}/api/unipile/webhook`,
    }),
  });

  if (!unipileRes.ok) {
    const err = await unipileRes.text();
    // Only roll back if we just created the seller — on reconnect we keep the
    // existing row so the client can retry without losing it again.
    if (!isReconnect) {
      await fetch(`${SB_URL}/rest/v1/sellers?id=eq.${seller.id}`, {
        method: "DELETE",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      });
    }
    return NextResponse.json({ error: `Unipile: ${err}` }, { status: 500 });
  }

  const { url } = (await unipileRes.json()) as { url: string };

  return NextResponse.json({
    sellerId: seller.id,
    authUrl: url,
    expiresOn,
  });
}
