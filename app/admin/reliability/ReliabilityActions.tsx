"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Send, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

// Client-side actions for the reliability dashboard:
//   - Refresh         → router.refresh() to re-run the server fetch
//   - Dispatch next   → POST /api/cron/dispatch-queue to manually advance the
//                        outgoing queue without waiting for the cron tick.
//                        Useful for testing and for clearing a backlog.
export default function ReliabilityActions() {
  const router = useRouter();
  const [dispatching, setDispatching] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function dispatchOne() {
    setDispatching(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/cron/dispatch-queue", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        if (json.processed > 0) {
          setLastResult(`Dispatched ${json.invitation_id ?? "(no invitation_id)"}`);
        } else if (json.reason === "no queued messages") {
          setLastResult("Queue empty.");
        } else {
          setLastResult(json.reason ?? "Done.");
        }
      } else {
        setLastResult(`Failed: ${json.error ?? "unknown"}`);
      }
      router.refresh();
    } catch (e: any) {
      setLastResult(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {lastResult && (
        <span className="text-xs" style={{ color: C.textMuted }}>{lastResult}</span>
      )}
      <button
        onClick={dispatchOne}
        disabled={dispatching}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-[opacity,transform,box-shadow,background-color,border-color]"
        style={{
          color: dispatching ? C.textMuted : C.gold,
          borderColor: C.border,
          backgroundColor: dispatching ? C.surface : `color-mix(in srgb, ${C.gold} 8%, transparent)`,
        }}>
        {dispatching ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        {dispatching ? "Dispatching…" : "Dispatch next"}
      </button>
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
