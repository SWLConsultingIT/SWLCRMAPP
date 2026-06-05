"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardList, ChevronDown, RefreshCw, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

// AI pre-call brief: Pain / Fit / Opener points the seller reads before dialing.
//
// Two modes:
//  1. Self-generating (lead detail) — pass `leadId`. The card is ALWAYS
//     rendered and auto-generates the brief on first view when none is cached,
//     so the seller never opens a lead and finds it missing (the points used to
//     silently render nothing because the page passed props the component
//     didn't accept). A Refresh button regenerates on demand.
//  2. Static (the /queue pending-call rows) — pass only `talkingPoints`. No
//     leadId → no auto-generation (we don't want N AI calls when the queue
//     opens); the toggle only appears when points were pre-generated server-side.

type Point = string | { type: "pain" | "fit" | "opener"; text: string };

export default function PreCallBrief({
  leadId,
  initialPoints,
  initialGeneratedAt,
  talkingPoints,
}: {
  leadId?: string;
  initialPoints?: Point[] | null;
  initialGeneratedAt?: string | null;
  /** Legacy/static prop (QueueClient): a pre-loaded list, no auto-generation. */
  talkingPoints?: Point[] | null;
}) {
  const seed = (initialPoints ?? talkingPoints) ?? null;
  const selfGenerating = !!leadId;

  const [points, setPoints] = useState<Point[] | null>(seed && seed.length > 0 ? seed : null);
  const [open, setOpen] = useState(true); // visible by default — the whole point
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranOnce = useRef(false);

  async function generate() {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/talking-points`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(d.points) && d.points.length > 0) {
        setPoints(d.points as Point[]);
        setOpen(true);
      } else {
        setError(d?.error ?? "Couldn't generate the brief");
      }
    } catch {
      setError("Couldn't generate the brief");
    } finally {
      setLoading(false);
    }
  }

  // Auto-generate once on first view when nothing is cached (self-generating
  // mode only). Guarded by a ref so it never loops on re-render.
  useEffect(() => {
    if (!selfGenerating || ranOnce.current) return;
    if (points && points.length > 0) return;
    ranOnce.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfGenerating]);

  // Static mode with no points → render nothing (unchanged /queue behaviour).
  if (!selfGenerating && (!points || points.length === 0)) return null;

  const hasPoints = !!points && points.length > 0;
  const brand = "var(--brand, #c9a83a)";

  return (
    <div className="px-5 pb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => hasPoints && setOpen(v => !v)}
          disabled={!hasPoints}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors"
          style={{
            color: brand,
            borderColor: open && hasPoints ? `color-mix(in srgb, ${brand} 45%, transparent)` : C.border,
            backgroundColor: open && hasPoints ? `color-mix(in srgb, ${brand} 10%, transparent)` : C.card,
            cursor: hasPoints ? "pointer" : "default",
          }}
        >
          <ClipboardList size={12} /> Pre-call brief
          {loading && <Loader2 size={11} className="animate-spin" />}
          {hasPoints && (
            <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          )}
        </button>

        {selfGenerating && !loading && (
          <button
            onClick={generate}
            className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-1 rounded-md transition-colors"
            style={{ color: C.textMuted }}
            title={hasPoints ? "Regenerate the brief" : "Generate the brief"}
          >
            <RefreshCw size={10} /> {hasPoints ? "Refresh" : "Generate"}
          </button>
        )}
      </div>

      {/* Body — always present in self-generating mode so the seller sees a
          state (loading / points / retry), never a blank where the brief
          should be. */}
      {open && (
        <div
          className="mt-2 rounded-xl border p-3.5"
          style={{ backgroundColor: C.bg, borderColor: `color-mix(in srgb, ${brand} 30%, transparent)` }}
        >
          {loading && !hasPoints ? (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textMuted }}>
              <Loader2 size={12} className="animate-spin" /> Generating call brief…
            </div>
          ) : error && !hasPoints ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px]" style={{ color: C.textMuted }}>{error}</span>
              <button
                onClick={generate}
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-md border"
                style={{ color: brand, borderColor: `color-mix(in srgb, ${brand} 35%, transparent)` }}
              >
                <RefreshCw size={10} /> Retry
              </button>
            </div>
          ) : hasPoints ? (
            <ol className="space-y-2">
              {points!.map((p, i) => {
                const structured = typeof p === "object" && p !== null && "type" in p;
                const label = structured ? (p.type === "pain" ? "Pain" : p.type === "fit" ? "Fit" : "Opener") : `${i + 1}.`;
                const labelColor = structured ? (p.type === "pain" ? "#B91C1C" : p.type === "fit" ? "#1D4ED8" : "#B45309") : brand;
                const text = typeof p === "string" ? p : p.text;
                return (
                  <li key={i}>
                    <span className="text-[9px] font-bold uppercase tracking-wider mr-1.5" style={{ color: labelColor, letterSpacing: "0.06em" }}>{label}</span>
                    <span className="text-[11px] leading-snug" style={{ color: C.textPrimary }}>{text}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px]" style={{ color: C.textMuted }}>No brief yet.</span>
              <button
                onClick={generate}
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-md border"
                style={{ color: brand, borderColor: `color-mix(in srgb, ${brand} 35%, transparent)` }}
              >
                <RefreshCw size={10} /> Generate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
