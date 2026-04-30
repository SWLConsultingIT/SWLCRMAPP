"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

// Per-row retry button for failed campaign_messages. Calls
// /api/admin/reliability/retry → flips status failed → queued and strips
// cooldown metadata so the row is immediately eligible for the next
// dispatcher tick. Common use: LinkedIn "already sent recently" blocks
// that clear in 2-3 weeks.
export default function RetryButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function retry() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/reliability/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={retry}
        disabled={busy}
        title="Flip back to queued — orquestador retries on next tick"
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 12%, transparent)`, color: C.gold }}
      >
        {busy ? <Loader2 size={9} className="animate-spin" /> : <RotateCcw size={9} />}
        {busy ? "Retrying" : "Retry"}
      </button>
      {err && <span className="text-[10px]" style={{ color: C.red }}>{err}</span>}
    </div>
  );
}
