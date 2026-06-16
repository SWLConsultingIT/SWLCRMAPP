import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { signSellerName } from "@/lib/unipile-name-signing";

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

  // Resolve the ACTIVE tenant via getUserScope — NOT user_profiles.company_bio_id.
  // For a super_admin that column is permanently pinned to SWL and the tenant
  // switcher never mirrors it, so reading it directly created the seller under
  // SWL even while the user was viewing another tenant (Lucas Ledesma landed in
  // SWL instead of Grupo IEB, Fran 2026-06-16). getUserScope honors the
  // switch-tenant cookie, so companyBioId is the tenant actually on screen.
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyBioId: string | null = scope.companyBioId;
  if (!companyBioId) {
    return NextResponse.json(
      { error: "No active tenant — pick a tenant in the switcher before adding an account" },
      { status: 400 },
    );
  }

  const svc = getSupabaseService();

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
      // HMAC-signed so the webhook can verify the callback came from a link
      // we generated (not an attacker forging a raw seller UUID). Unipile
      // echoes `name` back verbatim. See lib/unipile-name-signing.ts.
      name: signSellerName(seller.id),
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
