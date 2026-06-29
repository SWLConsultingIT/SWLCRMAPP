// POST /api/cron/dispatch-telegram
//
// Cron-driven Telegram dispatcher. Called by the n8n Orquestador every 15 min
// (same cadence as dispatch-queue for LinkedIn).
//
// Send logic (per seller with telegram_account_id):
//   1. Count messages sent in the rolling 24h window → skip if at daily cap.
//   2. Claim 1 queued message (same BATCH_SIZE=1 principle as LinkedIn — one
//      per tick to avoid burst patterns that trigger Telegram's anti-spam).
//   3. Skip if lead has no telegram_user_id (unresolved phone).
//   4. Skip if lead has any existing reply (stop condition).
//   5. Find/create a Unipile Telegram chat with the lead, send the message.
//   6. Mark message 'sent' + store chat_id in metadata for follow-ups.
//
// Rate limits:
//   - Telegram: accounts that exceed ~50 msgs/day get soft-restricted. We
//     cap at telegram_daily_limit (default 20) with a hard ceiling of 50.
//   - On 429: set metadata.rate_limited_until = now + 4h, skip seller.
//
// No connection-request step: Telegram DMs are always direct (cold outreach
// to a phone number is valid — the receiver just sees a message from a
// contact not in their phonebook).
//
// Auth: Bearer CRON_SECRET or admin scope.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { renderPlaceholders } from "@/lib/placeholders";

export const runtime = "nodejs";
export const maxDuration = 60;

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const BATCH_SIZE_PER_SELLER = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const MAX_DAILY_HARD_CAP = 50;

type SellerRow = {
  id: string;
  name: string | null;
  telegram_account_id: string | null;
  telegram_daily_limit: number | null;
  telegram_status: string | null;
};

type QueuedMsg = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_number: number;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${CRON_SECRET}`;
}

async function unipilePost(path: string, body: unknown): Promise<Response> {
  return fetch(`${UNIPILE_BASE}${path}`, {
    method: "POST",
    headers: { "X-API-KEY": UNIPILE_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!authorized(req, scope.tier)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();

  // All active sellers with a Telegram account connected.
  const { data: sellers } = await svc
    .from("sellers")
    .select("id, name, telegram_account_id, telegram_daily_limit, telegram_status")
    .not("telegram_account_id", "is", null)
    .eq("active", true);

  if (!sellers?.length) {
    return NextResponse.json({ ok: true, sellers: 0, sent: 0 });
  }

  const since24h = new Date(Date.now() - DAY_MS).toISOString();
  let totalSent = 0;
  const results: Array<{ sellerId: string; sent: number; skipped: string | null }> = [];

  for (const seller of sellers as SellerRow[]) {
    if (!seller.telegram_account_id) continue;
    if (seller.telegram_status === "banned") {
      results.push({ sellerId: seller.id, sent: 0, skipped: "banned" });
      continue;
    }

    // Count messages sent in the last 24h for this seller (via campaign join).
    const { count: sentToday } = await svc
      .from("campaign_messages")
      .select("id", { count: "exact", head: true })
      .eq("channel", "telegram")
      .eq("status", "sent")
      .gte("sent_at", since24h)
      .in("campaign_id", (
        await svc.from("campaigns").select("id").eq("seller_id", seller.id).then(r => r.data?.map(c => c.id) ?? [])
      ));

    const dailyLimit = Math.min(
      seller.telegram_daily_limit ?? 20,
      MAX_DAILY_HARD_CAP,
    );
    if ((sentToday ?? 0) >= dailyLimit) {
      results.push({ sellerId: seller.id, sent: 0, skipped: "daily_cap" });
      continue;
    }

    // Claim up to BATCH_SIZE queued messages for this seller.
    const { data: queued } = await svc
      .from("campaign_messages")
      .select("id, campaign_id, lead_id, step_number, content, metadata")
      .eq("channel", "telegram")
      .eq("status", "queued")
      .in("campaign_id", (
        await svc
          .from("campaigns")
          .select("id")
          .eq("seller_id", seller.id)
          .eq("status", "active")
          .then(r => r.data?.map(c => c.id) ?? [])
      ))
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE_PER_SELLER);

    if (!queued?.length) {
      results.push({ sellerId: seller.id, sent: 0, skipped: "no_queued" });
      continue;
    }

    let sellerSent = 0;

    for (const msg of queued as QueuedMsg[]) {
      // Atomic claim — flip to 'dispatching' to prevent double-dispatch.
      const { data: claimed } = await svc
        .from("campaign_messages")
        .update({ status: "dispatching" })
        .eq("id", msg.id)
        .eq("status", "queued") // only claim if still queued
        .select("id")
        .maybeSingle();

      if (!claimed) continue; // another worker got it

      // Hydrate lead + campaign.
      const [{ data: lead }, { data: campaign }] = await Promise.all([
        svc
          .from("leads")
          .select("id, primary_first_name, company_name, telegram_user_id, primary_phone, company_bio_id")
          .eq("id", msg.lead_id)
          .maybeSingle(),
        svc
          .from("campaigns")
          .select("id, seller_id, status")
          .eq("id", msg.campaign_id)
          .maybeSingle(),
      ]);

      // Guard: campaign still active.
      if (!campaign || campaign.status !== "active") {
        await svc.from("campaign_messages").update({ status: "skipped", error_details: "campaign_inactive" }).eq("id", msg.id);
        continue;
      }

      // Guard: lead has telegram_user_id resolved.
      const telegramUserId = (lead as any)?.telegram_user_id as string | null;
      if (!telegramUserId) {
        await svc.from("campaign_messages").update({ status: "skipped", error_details: "no_telegram_user_id" }).eq("id", msg.id);
        continue;
      }

      // Guard: lead hasn't replied (stop condition — any reply stops all auto-sends).
      const { count: replyCount } = await svc
        .from("lead_replies")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", msg.lead_id);
      if ((replyCount ?? 0) > 0) {
        await svc.from("campaign_messages").update({ status: "skipped", error_details: "lead_replied" }).eq("id", msg.id);
        continue;
      }

      // Personalize content.
      const sellerName = seller.name ?? "";
      const content = renderPlaceholders(
        msg.content ?? "",
        {
          primary_first_name: (lead as any)?.primary_first_name ?? null,
          primary_last_name: (lead as any)?.primary_last_name ?? null,
          company_name: (lead as any)?.company_name ?? null,
          primary_title_role: (lead as any)?.primary_title_role ?? null,
        },
        { name: sellerName },
      );

      // Find or create the Telegram chat via Unipile.
      // First check if we already have a chat_id from a previous step.
      const existingChatId = (msg.metadata?.telegram_chat_id ?? null) as string | null;
      let chatId = existingChatId;

      if (!chatId) {
        const chatRes = await unipilePost("/api/v1/chats", {
          account_id: seller.telegram_account_id,
          attendees_ids: [telegramUserId],
        });

        if (!chatRes.ok) {
          const errText = await chatRes.text().catch(() => "");
          if (chatRes.status === 429) {
            // Rate-limited — cool down the seller.
            const cooldownUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString();
            await svc.from("sellers").update({ telegram_status: "restricted" }).eq("id", seller.id);
            await svc.from("campaign_messages")
              .update({ status: "queued", metadata: { ...msg.metadata, rate_limited_until: cooldownUntil } })
              .eq("id", msg.id);
            console.warn(`[dispatch-telegram] seller ${seller.id} rate-limited until ${cooldownUntil}`);
            break; // stop processing this seller
          }
          await svc.from("campaign_messages")
            .update({ status: "failed", error_details: `create_chat: ${chatRes.status} ${errText.slice(0, 200)}` })
            .eq("id", msg.id);
          continue;
        }

        const chatData = await chatRes.json() as { id?: string };
        chatId = chatData.id ?? null;
      }

      if (!chatId) {
        await svc.from("campaign_messages").update({ status: "failed", error_details: "no_chat_id_from_unipile" }).eq("id", msg.id);
        continue;
      }

      // Send the message.
      const sendRes = await unipilePost(`/api/v1/chats/${chatId}/messages`, {
        account_id: seller.telegram_account_id,
        text: content,
      });

      if (!sendRes.ok) {
        const errText = await sendRes.text().catch(() => "");
        if (sendRes.status === 429) {
          const cooldownUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString();
          await svc.from("sellers").update({ telegram_status: "restricted" }).eq("id", seller.id);
          await svc.from("campaign_messages")
            .update({ status: "queued", metadata: { ...msg.metadata, telegram_chat_id: chatId, rate_limited_until: cooldownUntil } })
            .eq("id", msg.id);
          break;
        }
        await svc.from("campaign_messages")
          .update({ status: "failed", error_details: `send_msg: ${sendRes.status} ${errText.slice(0, 200)}` })
          .eq("id", msg.id);
        continue;
      }

      const sendData = await sendRes.json() as { id?: string };
      const now = new Date().toISOString();

      await svc.from("campaign_messages").update({
        status: "sent",
        sent_at: now,
        provider_message_id: sendData.id ?? null,
        metadata: { ...msg.metadata, telegram_chat_id: chatId },
        error_details: null,
      }).eq("id", msg.id);

      sellerSent++;
      totalSent++;
    }

    results.push({ sellerId: seller.id, sent: sellerSent, skipped: null });
  }

  return NextResponse.json({ ok: true, sellers: sellers.length, sent: totalSent, details: results });
}
