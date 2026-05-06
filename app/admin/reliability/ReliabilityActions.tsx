"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { RefreshCw, Pause, Play } from "lucide-react";
import { C } from "@/lib/design";

// Reliability dashboard header actions.
//
// Auto-refresh ON by default at 30s intervals — the user complained the page
// felt stale (refresh was manual and the timestamp could lag 30+ minutes).
// We pause auto-refresh while the document is hidden to avoid burning Vercel
// requests on background tabs, and resume on visibility change.
const AUTO_REFRESH_MS = 30_000;

export default function ReliabilityActions() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [auto, setAuto] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  // Tick every second so the "next in Xs" countdown updates smoothly.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      startTransition(() => router.refresh());
      setLastRefresh(Date.now());
    };
    const id = setInterval(tick, AUTO_REFRESH_MS);
    const onVis = () => {
      if (!document.hidden && Date.now() - lastRefresh > AUTO_REFRESH_MS) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [auto, lastRefresh, router]);

  const secsUntilNext = Math.max(0, Math.ceil((AUTO_REFRESH_MS - (now - lastRefresh)) / 1000));

  function manualRefresh() {
    startTransition(() => router.refresh());
    setLastRefresh(Date.now());
  }

  return (
    <div className="flex items-center gap-2">
      {auto && !isPending && (
        <span className="text-[10px] tabular-nums" style={{ color: C.textDim }}>
          next in {secsUntilNext}s
        </span>
      )}
      <button
        onClick={() => setAuto((a) => !a)}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-opacity duration-150"
        style={{
          color: auto ? C.green : C.textBody,
          borderColor: auto ? C.green + "40" : C.border,
          backgroundColor: auto ? C.greenLight : C.card,
        }}
        title={auto ? "Auto-refresh ON — click to pause" : "Auto-refresh OFF — click to resume"}
      >
        {auto ? <Pause size={11} /> : <Play size={11} />}
        {auto ? "Auto" : "Paused"}
      </button>
      <button
        onClick={manualRefresh}
        disabled={isPending}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-opacity duration-150 disabled:opacity-60 disabled:cursor-wait"
        style={{ color: C.textBody, borderColor: C.border, backgroundColor: C.card }}>
        <RefreshCw size={12} className={isPending ? "animate-spin" : undefined} />
        {isPending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
