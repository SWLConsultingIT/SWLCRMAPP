"use client";

// Hero controls for the Reliability page — "Updated Xs ago" label + a
// Refresh button + an Auto on/off toggle. Lives inside the hero (top
// right) instead of floating at the bottom of the page so it's where
// the operator expects mission-control style chrome.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { RefreshCw, Pause, Play } from "lucide-react";

const STORAGE_KEY = "swl-reliability-autorefresh";
const REFRESH_INTERVAL_MS = 30_000;
const gold = "var(--brand, #c9a83a)";

export default function AutoRefresh() {
  const router = useRouter();
  const [auto, setAuto] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "on") setAuto(true);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, auto ? "on" : "off"); } catch {}
  }, [auto]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      router.refresh();
      setLastRefresh(Date.now());
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auto, router]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageSec = Math.floor((now - lastRefresh) / 1000);
  const ageLabel = ageSec < 5 ? "just now" : ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
        style={{
          backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`,
          border: `1px solid color-mix(in srgb, ${gold} 28%, transparent)`,
          color: gold,
        }}>
        <RefreshCw size={11} className={auto ? "animate-spin-slow" : ""} style={{ animationDuration: "6s" }} />
        <span className="text-[11px] font-semibold tabular-nums">Updated {ageLabel}</span>
      </div>
      <button
        onClick={() => { router.refresh(); setLastRefresh(Date.now()); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors hover:opacity-90"
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          color: C.textBody,
        }}
        title="Refresh now">
        <RefreshCw size={11} /> Refresh
      </button>
      <button
        onClick={() => setAuto(a => !a)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors hover:opacity-90"
        style={
          auto
            ? {
                background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                color: "#1A1A2E",
                border: `1px solid color-mix(in srgb, ${gold} 50%, transparent)`,
                boxShadow: `0 2px 6px -2px color-mix(in srgb, ${gold} 40%, transparent)`,
              }
            : {
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                color: C.textBody,
              }
        }
        title={auto ? `Auto-refresh every ${REFRESH_INTERVAL_MS / 1000}s — click to pause` : "Click to start auto-refresh"}>
        {auto ? <Pause size={11} /> : <Play size={11} />}
        Auto {auto ? "on" : "off"}
      </button>
    </div>
  );
}
