"use client";

import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { C } from "@/lib/design";

// Client-side actions for the reliability dashboard.
//
// "Dispatch next" was removed on 2026-04-30: the orquestador (n8n, every 15 min)
// already advances the queue with throttle + rate-limit cooldown handling,
// and the button was risky in production — one click = one real LinkedIn invite,
// with no way to choose which lead. If we ever need a manual advance for
// debugging, do it from the server (curl with CRON_SECRET) where there's no
// accidental-click surface.
export default function ReliabilityActions() {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => router.refresh()}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border"
        style={{ color: C.textBody, borderColor: C.border, backgroundColor: C.card }}>
        <RefreshCw size={12} />
        Refresh
      </button>
    </div>
  );
}
