"use client";

// Freshness indicator — shows how stale the rendered dashboard is by ticking
// up from the server-rendered timestamp. Communicates to the user that the
// dashboard is live (force-dynamic, no-cache) without claiming false realtime.
//
// Tick every 5s (cheap enough, perceptually granular enough). After 5min the
// chip turns amber to nudge a refresh.

import { useEffect, useState } from "react";
import { C } from "@/lib/design";

export default function FreshnessChip({ renderedAt }: { renderedAt: string }) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const anchor = new Date(renderedAt).getTime();
    const tick = () => setElapsedSec(Math.max(0, Math.round((Date.now() - anchor) / 1000)));
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [renderedAt]);

  const isStale = elapsedSec > 300; // 5 min
  const dotColor = isStale ? "#D97706" : "#16A34A";
  const label = elapsedSec < 10 ? "ahora" :
                elapsedSec < 60 ? `${elapsedSec}s` :
                elapsedSec < 3600 ? `${Math.floor(elapsedSec / 60)}m` :
                `${Math.floor(elapsedSec / 3600)}h`;

  return (
    <div
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border tabular-nums"
      style={{ borderColor: C.border, color: C.textMuted, background: C.card }}
      title={isStale ? "Refrescá para datos al día" : "Datos en vivo"}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: dotColor,
          boxShadow: `0 0 0 2px color-mix(in srgb, ${dotColor} 18%, transparent)`,
          animation: isStale ? undefined : "pulse 2s infinite",
        }}
        aria-hidden
      />
      <span>{label}</span>
    </div>
  );
}
