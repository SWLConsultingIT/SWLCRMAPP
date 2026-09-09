// Web Push helper (P2b). Sends browser push notifications to a user's opted-in
// devices. No-op unless VAPID keys are configured — so the feature is safe to
// ship dark and light up once the keys are set. Dead subscriptions (404/410)
// are pruned automatically.
//
// Generate keys once with:  npx web-push generate-vapid-keys
// then set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (mailto:) env.

import webpush from "web-push";
import { getSupabaseService } from "@/lib/supabase-service";

const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:it@swlconsulting.com";

let configured = false;
function ensureConfigured(): boolean {
  if (!PUBLIC || !PRIVATE) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    configured = true;
  }
  return true;
}

export function pushConfigured(): boolean {
  return !!(PUBLIC && PRIVATE);
}

export function vapidPublicKey(): string {
  return PUBLIC;
}

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
};

/**
 * Fan a push out to every device the given users have subscribed. Silent no-op
 * when VAPID isn't configured. Prunes subscriptions the push service rejects as
 * gone (404/410). Best-effort — never throws to the caller.
 */
export async function sendPushToUsers(userIds: (string | null | undefined)[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const ids = Array.from(new Set(userIds.filter((u): u is string => !!u)));
  if (ids.length === 0) return;

  const svc = getSupabaseService();
  const { data: subs } = await svc
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", ids);
  if (!subs || subs.length === 0) return;

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
      }
    }),
  );
  if (dead.length > 0) {
    await svc.from("push_subscriptions").delete().in("id", dead);
  }
}
