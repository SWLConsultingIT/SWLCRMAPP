// POST /api/unipile/telegram-hosted-link
//
// Generates a Unipile hosted-auth URL for connecting a seller's personal
// Telegram account. Same pattern as /api/unipile/hosted-link (LinkedIn) but:
//   - providers: ["TELEGRAM"] instead of ["LINKEDIN"]
//   - name is signed with signTelegramName (prefix "tg:") so the shared
//     webhook /api/unipile/webhook can route the callback to the correct
//     sellers column (telegram_account_id vs unipile_account_id).
//   - Always requires an existing sellerId (Telegram is an add-on to an
//     existing seller, not a standalone account).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAdminMenu } from "@/lib/scope";
import { signTelegramName } from "@/lib/unipile-name-signing";

const KEY = process.env.UNIPILE_API_KEY!;
const DSN = process.env.UNIPILE_DSN!;

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
  const scope = await getUserScope();
  if (!scope.userId || !canViewAdminMenu(scope.tier)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sellerId, telegramDailyLimit = 20 } = await req.json() as {
    sellerId?: string;
    telegramDailyLimit?: number;
  };

  if (!sellerId?.trim()) {
    return NextResponse.json({ error: "sellerId required" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { data: seller } = await svc
    .from("sellers")
    .select("id, name, telegram_account_id, company_bio_id")
    .eq("id", sellerId)
    .maybeSingle();

  if (!seller) {
    return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  }

  // Scope guard — non-super_admin can only link sellers in their own tenant.
  if (scope.tier !== "super_admin" && seller.company_bio_id !== scope.companyBioId) {
    return NextResponse.json({ error: "Seller belongs to another tenant" }, { status: 403 });
  }

  if (seller.telegram_account_id) {
    return NextResponse.json({ error: "Seller already has Telegram linked" }, { status: 409 });
  }

  // Persist daily limit before the auth flow starts (so even if the popup
  // closes mid-flow the limit is already in place for when they retry).
  await svc
    .from("sellers")
    .update({ telegram_daily_limit: telegramDailyLimit, updated_at: new Date().toISOString() })
    .eq("id", sellerId);

  const baseUrl = getBaseUrl(req);
  const expiresOn = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const unipileRes = await fetch(`https://${DSN}/api/v1/hosted/accounts/link`, {
    method: "POST",
    headers: { "X-API-KEY": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "create",
      providers: ["TELEGRAM"],
      api_url: `https://${DSN}`,
      expiresOn,
      // "tg:<sellerId>:<hmac>" — the webhook routes by this prefix to update
      // telegram_account_id instead of unipile_account_id.
      name: signTelegramName(sellerId),
      success_redirect_url: `${baseUrl}/accounts?tg_connected=1`,
      failure_redirect_url: `${baseUrl}/accounts?tg_connected=0`,
      notify_url: `${baseUrl}/api/unipile/webhook`,
    }),
  });

  if (!unipileRes.ok) {
    const err = await unipileRes.text();
    return NextResponse.json({ error: `Unipile: ${err}` }, { status: 500 });
  }

  const { url } = (await unipileRes.json()) as { url: string };
  return NextResponse.json({ authUrl: url, expiresOn });
}
