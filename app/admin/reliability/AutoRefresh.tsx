"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { RefreshCw, Pause, Play } from "lucide-react";

const STORAGE_KEY = "swl-reliability-autorefresh";
const REFRESH_INTERVAL_MS = 30_000;

export default function AutoRefresh() {
  const router = useRouter();
  const [auto, setAuto] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());

  // Read the persisted preference on mount only (server render starts with auto=false).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "on") setAuto(true);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, auto ? "on" : "off"); } catch {}
  }, [auto]);

  // Drive the auto-refresh loop. router.refresh() re-fetches the RSC payload
  // without a full reload — far smoother than a hard reload for monitoring.
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      router.refresh();
      setLastRefresh(Date.now());
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auto, router]);

  // Tick for the "Xs ago" label so it doesn't sit stale.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageSec = Math.floor((now - lastRefresh) / 1000);
  const ageLabel = ageSec < 5 ? "just now" : ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span style={{ color: C.textDim }}>Updated {ageLabel}</span>
      <button
        onClick={() => { router.refresh(); setLastRefresh(Date.now()); }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors hover:bg-gray-50"
        style={{ borderColor: C.border, color: C.textBody }}
        title="Refresh now">
        <RefreshCw size={12} /> Refresh
      </button>
      <button
        onClick={() => setAuto(a => !a)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors"
        style={{
          borderColor: auto ? C.green + "55" : C.border,
          backgroundColor: auto ? C.greenLight : "transparent",
          color: auto ? C.green : C.textBody,
        }}
        title={auto ? `Auto-refresh every ${REFRESH_INTERVAL_MS / 1000}s — click to pause` : "Click to start auto-refresh"}>
        {auto ? <Pause size={12} /> : <Play size={12} />}
        Auto {auto ? "on" : "off"}
      </button>
    </div>
  );
}
