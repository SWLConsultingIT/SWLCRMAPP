"use client";

import { useEffect, useState } from "react";
import { Phone, Sparkles, RefreshCw, Target, Compass, MessageSquareQuote } from "lucide-react";
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

const POINT_META: Record<TalkingPoint["type"], { label: string; icon: typeof Target; tone: { tint: string; ring: string; chip: string; chipFg: string } }> = {
  pain: {
    label: "Pain Point",
    icon: Target,
    tone: { tint: "#FEF2F2", ring: "#FECACA", chip: "#FEE2E2", chipFg: "#B91C1C" },
  },
  fit: {
    label: "Why We Fit",
    icon: Compass,
    tone: { tint: "#EFF6FF", ring: "#BFDBFE", chip: "#DBEAFE", chipFg: "#1D4ED8" },
  },
  opener: {
    label: "Recommended Opener",
    icon: MessageSquareQuote,
    tone: { tint: "#FFFBEB", ring: "#FDE68A", chip: "#FEF3C7", chipFg: "#B45309" },
  },
};

function isStructured(p: AnyPoint): p is TalkingPoint {
  return typeof p === "object" && p !== null && "type" in p && "text" in p;
}

/**
 * Pre-Call Brief — three structured prompts (pain / fit / opener) generated
 * by AI from the lead's enrichment + ICP. Auto-fires on first lead view so
 * the seller never sees an empty state; an explicit Refresh re-runs after
 * enrichment changes. Renders one card per point with category-coded
 * iconography so the seller can find the opener in a glance even while
 * dialling.
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
    <div className="rounded-2xl border overflow-hidden mb-6"
      style={{
        background: "linear-gradient(180deg, color-mix(in srgb, var(--brand, #c9a83a) 4%, var(--card)), var(--card) 60%)",
        borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 25%, var(--border))",
        boxShadow: "0 4px 24px rgba(0,0,0,0.05)",
      }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 15%, var(--border))" }}>
        <div className="flex items-center gap-3">
          <div className="rounded-xl flex items-center justify-center shrink-0"
            style={{ width: 36, height: 36, background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 70%, white))` }}>
            <Phone size={16} style={{ color: "#fff" }} />
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-wider" style={{ color: C.textPrimary, letterSpacing: "0.08em" }}>
              Pre-Call Brief
            </p>
            <p className="text-[11px]" style={{ color: C.textMuted }}>
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={10} className="animate-pulse" /> Building call prep from enrichment data…
                </span>
              ) : stamp ? (
                <>AI-generated · {stamp}</>
              ) : (
                "AI-generated pain points, fit reasons, and an opener"
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {points && points.length > 0 ? "Refresh" : "Generate"}
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {error && (
          <p className="text-xs mb-3 px-3 py-2 rounded-md"
            style={{ color: "#B91C1C", backgroundColor: "#FEF2F2", border: "1px solid #FECACA" }}>
            {error}
          </p>
        )}

        {points && points.length > 0 ? (
          <div className="grid gap-2.5">
            {points.map((p, i) => {
              if (isStructured(p)) {
                const meta = POINT_META[p.type];
                const Icon = meta.icon;
                return (
                  <div key={i} className="flex gap-3 rounded-xl p-3.5 border"
                    style={{ backgroundColor: meta.tone.tint, borderColor: meta.tone.ring }}>
                    <div className="rounded-lg flex items-center justify-center shrink-0"
                      style={{ width: 32, height: 32, backgroundColor: meta.tone.chip }}>
                      <Icon size={15} style={{ color: meta.tone.chipFg }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5"
                        style={{ color: meta.tone.chipFg, letterSpacing: "0.08em" }}>
                        {meta.label}
                      </p>
                      <p className="text-sm leading-snug" style={{ color: C.textPrimary }}>{p.text}</p>
                    </div>
                  </div>
                );
              }
              // Legacy string format — keep visible so older briefs don't blank out.
              return (
                <div key={i} className="flex gap-3 rounded-xl p-3.5 border"
                  style={{ backgroundColor: C.surface, borderColor: C.border }}>
                  <span className="flex items-center justify-center rounded-full shrink-0 text-[11px] font-bold"
                    style={{ width: 22, height: 22, backgroundColor: gold, color: "#fff" }}>
                    {i + 1}
                  </span>
                  <p className="text-sm leading-snug" style={{ color: C.textPrimary }}>{p}</p>
                </div>
              );
            })}
          </div>
        ) : loading ? (
          <div className="grid gap-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 rounded-xl p-3.5 border animate-pulse"
                style={{ backgroundColor: C.surface, borderColor: C.border }}>
                <div className="rounded-lg shrink-0" style={{ width: 32, height: 32, backgroundColor: C.border }} />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-24 rounded" style={{ backgroundColor: C.border }} />
                  <div className="h-3.5 rounded" style={{ backgroundColor: C.border }} />
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
