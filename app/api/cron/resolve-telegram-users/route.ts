// POST /api/cron/resolve-telegram-users
//
// Resolves phone numbers → Telegram user IDs via Unipile, and stores the
// result in leads.telegram_user_id. Runs before campaign approval (via the
// wizard's pre-flight check) and also as a daily cron.
//
// Resolution strategy:
//   For each lead with a primary_phone but no telegram_user_id:
//   1. Pick any active seller with telegram_account_id (we need one to use
//      the Unipile Telegram account for the lookup).
//   2. POST /api/v1/chats with attendees_ids=[normalized_phone] to create/
//      find a Telegram chat. Unipile resolves the phone to a Telegram user
//      and returns the chat_id + the actual telegram_user_id.
//   3. Persist leads.telegram_user_id = resolved_id.
//   4. Delete the trial chat immediately (we don't want ghost chats from the
//      resolution step). If deletion fails we log but don't error — the chat
//      will never receive a message unless the dispatcher explicitly sends one.
//
// Auth: Bearer CRON_SECRET or admin scope.
// Scoping: resolves only leads for the requesting tenant (or all if cron).
// Batch size: 50 leads per invocation to stay well within 60s Vercel timeout.
// Idempotent: leads with telegram_user_id already set are skipped.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const runtime = "nodejs";
export const maxDuration = 60;

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const BATCH_SIZE = 50;

type Lead = {
  id: string;
  primary_phone: string | null;
  company_bio_id: string;
};

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.length < 7) return null;
  // Ensure E.164 format (leading +)
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function authorized(req: NextRequest, scopeRole: string | null): boolean {
  if (scopeRole === "admin") return true;
  if (!CRON_SECRET) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${CRON_SECRET}`;
}

async function unipilePost(path: string, body: unknown) {
  const r = await fetch(`${UNIPILE_BASE}${path}`, {
    method: "POST",
    headers: { "X-API-KEY": UNIPILE_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return r;
}

async function unipileDelete(path: string) {
  await fetch(`${UNIPILE_BASE}${path}`, {
    method: "DELETE",
    headers: { "X-API-KEY": UNIPILE_KEY, Accept: "application/json" },
  }).catch(() => null);
}

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!authorized(req, scope.tier)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = getSupabaseService();

  // Use ?bioId param for targeted resolution (e.g. pre-flight from wizard),
  // or resolve for all tenants when called as a daily cron.
  const url = new URL(req.url);
  const bioId = url.searchParams.get("bioId");
  const leadIdsParam = url.searchParams.get("leadIds"); // comma-separated for targeted pre-flight

  // Find an active seller with a Telegram account to do the resolution.
  // All resolution happens through a single seller account — we just need
  // any Telegram-connected account to query Unipile.
  let sellerQuery = svc
    .from("sellers")
    .select("id, telegram_account_id")
    .not("telegram_account_id", "is", null)
    .eq("active", true)
    .limit(1);
  if (bioId) {
    sellerQuery = sellerQuery.eq("company_bio_id", bioId);
  }
  const { data: sellers } = await sellerQuery;
  const resolverSeller = sellers?.[0];

  if (!resolverSeller?.telegram_account_id) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "No active seller with Telegram connected — connect a Telegram account first",
    });
  }

  const telegramAccountId = resolverSeller.telegram_account_id as string;

  // Find unresolved leads.
  let leadsQuery = svc
    .from("leads")
    .select("id, primary_phone, company_bio_id")
    .is("telegram_user_id", null)
    .not("primary_phone", "is", null)
    .limit(BATCH_SIZE);

  if (leadIdsParam) {
    leadsQuery = leadsQuery.in("id", leadIdsParam.split(",").filter(Boolean));
  } else if (bioId) {
    leadsQuery = leadsQuery.eq("company_bio_id", bioId);
  }

  const { data: leads } = await leadsQuery;
  if (!leads?.length) {
    return NextResponse.json({ ok: true, resolved: 0, skipped: 0, failed: 0 });
  }

  let resolved = 0, skipped = 0, failed = 0;
  const resolvedAt = new Date().toISOString();

  for (const lead of leads as Lead[]) {
    const phone = normalizePhone(lead.primary_phone);
    if (!phone) { skipped++; continue; }

    try {
      // POST /api/v1/chats — Unipile resolves phone → Telegram user and returns
      // the chat object containing the attendees with their provider_id (telegram_user_id).
      const chatRes = await unipilePost("/api/v1/chats", {
        account_id: telegramAccountId,
        attendees_ids: [phone],
      });

      if (!chatRes.ok) {
        const errText = await chatRes.text().catch(() => "");
        // 404 = phone not registered on Telegram. Mark as resolved but no ID.
        // This prevents repeated lookups on every cron tick.
        if (chatRes.status === 404 || chatRes.status === 400) {
          await svc
            .from("leads")
            .update({ telegram_resolved_at: resolvedAt })
            .eq("id", lead.id);
          skipped++;
        } else {
          console.warn(`[resolve-telegram] lead ${lead.id} phone ${phone}: ${chatRes.status} ${errText.slice(0, 100)}`);
          failed++;
        }
        continue;
      }

      const chat = await chatRes.json() as {
        id?: string;
        object?: string;
        attendees?: Array<{ id?: string; provider_id?: string; type?: string }>;
      };

      // Extract the Telegram user ID (provider_id) for the non-self attendee.
      const remoteAttendee = (chat.attendees ?? []).find(
        a => a.type !== "ACCOUNT" && a.provider_id
      );
      const telegramUserId = remoteAttendee?.provider_id ?? null;
      const chatId = chat.id ?? null;

      await svc
        .from("leads")
        .update({
          telegram_user_id: telegramUserId,
          telegram_resolved_at: resolvedAt,
        })
        .eq("id", lead.id);

      // Delete the trial chat — we don't want ghost conversations.
      if (chatId) {
        await unipileDelete(`/api/v1/chats/${chatId}`);
      }

      if (telegramUserId) { resolved++; } else { skipped++; }
    } catch (e) {
      console.error(`[resolve-telegram] lead ${lead.id}:`, e);
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    resolved,
    skipped,
    failed,
    total: leads.length,
  });
}
