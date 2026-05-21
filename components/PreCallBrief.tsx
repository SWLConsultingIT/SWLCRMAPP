"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Target, Compass, Quote } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

// Structured talking point. The API stores three of these per lead, one per
// type. Legacy rows persisted as `string[]` are also accepted and shown as
// generic numbered points so old briefs don't disappear after the redesign.
type TalkingPoint = { type: "pain" | "fit" | "opener"; text: string };
type AnyPoint = TalkingPoint | string;

type Props = {
  leadId: string;
  initialPoints: AnyPoint[] | null;
  initialGeneratedAt: string | null;
};

// Per-type visual language. Colors picked for sufficient contrast on light
// theme cards while staying distinct from the global brand gold — pain reads
// as urgency-red, fit as trust-blue, opener as conversation-amber.
const POINT_META: Record<TalkingPoint["type"], {
  label: string;
  icon: typeof Target;
  // Accent color used for the icon disk + label pill + left border.
  accent: string;
  // Background tint behind the entire card (very light wash).
  tint: string;
  // Pill backdrop + text.
  pillBg: string;
  pillFg: string;
}> = {
  pain: {
    label: "Pain",
    icon: Target,
    accent: "#DC2626",
    tint: "linear-gradient(135deg, rgba(254,242,242,0.95) 0%, rgba(255,255,255,0.6) 70%)",
    pillBg: "#FEE2E2",
    pillFg: "#991B1B",
  },
  fit: {
    label: "Why we fit",
    icon: Compass,
    accent: "#2563EB",
    tint: "linear-gradient(135deg, rgba(239,246,255,0.95) 0%, rgba(255,255,255,0.6) 70%)",
    pillBg: "#DBEAFE",
    pillFg: "#1E40AF",
  },
  opener: {
    label: "Opener",
    icon: Quote,
    accent: "#D97706",
    tint: "linear-gradient(135deg, rgba(255,251,235,0.95) 0%, rgba(255,255,255,0.6) 70%)",
    pillBg: "#FEF3C7",
    pillFg: "#92400E",
  },
};

function isStructured(p: AnyPoint): p is TalkingPoint {
  return typeof p === "object" && p !== null && "type" in p && "text" in p;
}

/**
 * Pre-Call Brief — three structured prompts (pain / fit / opener) generated
 * by AI from the lead's enrichment + ICP. Auto-fires on first lead view so
 * the seller never sees an empty state; an explicit Refresh re-runs after
 * enrichment changes.
 */
export default function PreCallBrief({ leadId, initialPoints, initialGeneratedAt }: Props) {
  const [points, setPoints] = useState<AnyPoint[] | null>(initialPoints);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!points && !loading) {
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/talking-points`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setPoints(body.points ?? null);
      setGeneratedAt(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message ?? "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  const stamp = generatedAt
    ? new Date(generatedAt).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="relative rounded-2xl overflow-hidden mb-6"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${gold} 6%, var(--card)) 0%, var(--card) 40%)`,
        border: "1px solid color-mix(in srgb, var(--brand, #c9a83a) 22%, var(--border))",
        boxShadow: "0 8px 30px -8px rgba(201,168,58,0.18), 0 2px 8px rgba(0,0,0,0.04)",
      }}>
      {/* Decorative gold corner accent — subtle premium texture */}
      <div className="absolute top-0 right-0 pointer-events-none"
        style={{
          width: 180,
          height: 180,
          background: `radial-gradient(circle at top right, color-mix(in srgb, ${gold} 18%, transparent), transparent 60%)`,
        }} />

      {/* Header */}
      <div className="relative flex items-center justify-between px-6 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl flex items-center justify-center shrink-0 shadow-sm"
            style={{
              width: 42, height: 42,
              background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 65%, white) 100%)`,
              boxShadow: `0 4px 12px color-mix(in srgb, ${gold} 35%, transparent)`,
            }}>
            <Sparkles size={18} style={{ color: "#fff" }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold tracking-tight" style={{ color: C.textPrimary }}>
                Pre-Call Brief
              </p>
              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                style={{
                  background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`,
                  color: "#fff",
                  letterSpacing: "0.06em",
                }}>
                AI
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={10} className="animate-pulse" /> Reading enrichment data…
                </span>
              ) : stamp ? (
                <>Generated {stamp}</>
              ) : (
                "30-second briefing pulled from this lead's enrichment"
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all hover:shadow-sm hover:-translate-y-px disabled:opacity-50 disabled:translate-y-0"
          style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          {points && points.length > 0 ? "Refresh" : "Generate"}
        </button>
      </div>

      {/* Body */}
      <div className="relative px-6 pb-5">
        {error && (
          <p className="text-xs mb-3 px-3 py-2 rounded-md"
            style={{ color: "#991B1B", backgroundColor: "#FEF2F2", border: "1px solid #FECACA" }}>
            {error}
          </p>
        )}

        {points && points.length > 0 ? (
          <div className="grid gap-3">
            {points.map((p, i) => {
              if (isStructured(p)) {
                const meta = POINT_META[p.type];
                const Icon = meta.icon;
                const isOpener = p.type === "opener";
                return (
                  <div key={i}
                    className="relative rounded-xl overflow-hidden border transition-shadow hover:shadow-sm"
                    style={{
                      background: meta.tint,
                      borderColor: `color-mix(in srgb, ${meta.accent} 18%, ${C.border})`,
                    }}>
                    {/* Accent left bar */}
                    <div className="absolute left-0 top-0 bottom-0" style={{ width: 3, backgroundColor: meta.accent }} />
                    <div className="flex gap-3.5 p-4 pl-5">
                      {/* Icon disk */}
                      <div className="rounded-full flex items-center justify-center shrink-0 shadow-sm"
                        style={{
                          width: 34, height: 34,
                          background: `linear-gradient(135deg, ${meta.accent}, color-mix(in srgb, ${meta.accent} 70%, white))`,
                        }}>
                        <Icon size={15} style={{ color: "#fff" }} strokeWidth={2.4} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md mb-1.5"
                          style={{
                            backgroundColor: meta.pillBg,
                            color: meta.pillFg,
                            letterSpacing: "0.08em",
                          }}>
                          {meta.label}
                        </span>
                        {isOpener ? (
                          <p className="text-[14px] leading-snug italic"
                            style={{ color: C.textPrimary, fontFamily: "Georgia, 'Times New Roman', serif" }}>
                            &ldquo;{p.text}&rdquo;
                          </p>
                        ) : (
                          <p className="text-[13.5px] leading-snug" style={{ color: C.textPrimary }}>
                            {p.text}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              // Legacy string format — keep visible so older briefs don't blank out.
              return (
                <div key={i} className="flex gap-3 rounded-xl p-4 border"
                  style={{ backgroundColor: C.surface, borderColor: C.border }}>
                  <span className="flex items-center justify-center rounded-full shrink-0 text-[11px] font-bold"
                    style={{ width: 24, height: 24, backgroundColor: gold, color: "#fff" }}>
                    {i + 1}
                  </span>
                  <p className="text-[13.5px] leading-snug" style={{ color: C.textPrimary }}>{p}</p>
                </div>
              );
            })}
          </div>
        ) : loading ? (
          <div className="grid gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3.5 rounded-xl p-4 pl-5 border animate-pulse"
                style={{ backgroundColor: C.surface, borderColor: C.border }}>
                <div className="rounded-full shrink-0" style={{ width: 34, height: 34, backgroundColor: C.border }} />
                <div className="flex-1 space-y-2 mt-1">
                  <div className="h-2.5 w-16 rounded" style={{ backgroundColor: C.border }} />
                  <div className="h-3.5 rounded" style={{ backgroundColor: C.border }} />
                  <div className="h-3.5 w-4/5 rounded" style={{ backgroundColor: C.border }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm flex items-center gap-2 py-3" style={{ color: C.textMuted }}>
            <Sparkles size={13} /> Click Generate to build a 30-second pre-call brief from this lead&apos;s enrichment data.
          </p>
        )}
      </div>
    </div>
  );
}
