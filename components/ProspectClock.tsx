"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { C } from "@/lib/design";

// Shows the prospect's *local* time + a green/amber dot for "is this a sane hour
// to call?" (08:00–19:00 local = good). Ticks every minute. Pure client clock —
// reads the browser's now and renders it in the prospect's timezone.
export default function ProspectClock({ tz, place }: { tz: string; place?: string | null }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  let time = "";
  let hour = 12;
  try {
    time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
    hour = parseInt(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(now), 10);
  } catch {
    return null;
  }

  const goodToCall = hour >= 8 && hour < 19;
  const dot = goodToCall ? "#0E9F6E" : "#D97706";

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full"
      style={{ backgroundColor: C.bg, color: C.textBody, border: `1px solid ${C.border}` }}
      title={goodToCall ? "Good time to call" : "Off-hours — likely a bad time to call"}
    >
      <Clock size={12} style={{ color: C.textDim }} />
      <span>{time}</span>
      <span style={{ color: C.textMuted }}>local{place ? ` · ${place}` : ""}</span>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} />
    </span>
  );
}
