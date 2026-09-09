// Exposes the VAPID public key so the browser can subscribe to push. Empty
// string when push isn't configured yet — the client treats that as "unavailable".

import { NextResponse } from "next/server";
import { vapidPublicKey, pushConfigured } from "@/lib/web-push";

export async function GET() {
  return NextResponse.json({ key: vapidPublicKey(), configured: pushConfigured() });
}
